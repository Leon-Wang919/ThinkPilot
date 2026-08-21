"""
Guide Graph â?LangGraph implementation of the guided learning workflow.

Architecture (mirrors GuideManager):
    START â?locate_content â?interactive_teach â?[user_asks?]
        ââ question â?answer_question â?interactive_teach (loop)
        ââ done     â?summarize â?END

Reuses existing Agent classes from src/agents/guide/.
"""

from __future__ import annotations

from typing import Any

from src.graphs.builder import GraphBuilder
from src.graphs.nodes import agent_node
from src.graphs.state import GuideState
from src.tlogging import get_logger

logger = get_logger("Graphs.Guide")


def build_guide_graph(
    api_key: str = "",
    base_url: str = "",
    language: str = "zh",
    api_version: str | None = None,
    binding: str = "openai",
) -> Any:
    """
    Build and compile the guide LangGraph.

    Args:
        api_key: LLM API key.
        base_url: LLM API endpoint.
        language: Language setting.
        api_version: API version for Azure.
        binding: LLM provider binding.

    Returns:
        A compiled LangGraph runnable.
    """
    from src.agents.guide.agents import ChatAgent, InteractiveAgent, LocateAgent, SummaryAgent

    locate_agent = LocateAgent(
        api_key, base_url, language=language, api_version=api_version, binding=binding
    )
    interactive_agent = InteractiveAgent(
        api_key, base_url, language=language, api_version=api_version, binding=binding
    )
    chat_agent = ChatAgent(
        api_key, base_url, language=language, api_version=api_version, binding=binding
    )
    summary_agent = SummaryAgent(
        api_key, base_url, language=language, api_version=api_version, binding=binding
    )

    # ââ Nodes ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    @agent_node(locate_agent, output_key="located_content", step_name="locate_content")
    async def locate_content_node(state: GuideState, agent: Any) -> dict[str, Any]:
        """Locate relevant content for the learning topic."""
        topic = state.get("topic", state.get("current_query", ""))
        kb_name = state.get("kb_name", "")
        mode = "topic" if topic else "curriculum"

        result = await agent.process(kb_name=kb_name, mode=mode, topic=topic)
        knowledge_points = result.get("knowledge_points", [])

        return {
            "located_content": "\n\n".join(
                point.get("knowledge_summary", "") for point in knowledge_points
            ),
            "topic": topic,
            "knowledge_points": knowledge_points,
        }

    @agent_node(interactive_agent, output_key="final_answer", step_name="interactive_teach")
    async def interactive_teach_node(state: GuideState, agent: Any) -> dict[str, Any]:
        """Generate interactive teaching content."""
        knowledge_points = state.get("knowledge_points", [])
        knowledge = knowledge_points[0] if knowledge_points else {}

        result = await agent.process(knowledge=knowledge)

        return {
            "final_answer": result.get("html", ""),
            "interactive_elements": result.get("interactive_elements", []),
        }

    @agent_node(chat_agent, output_key="final_answer", step_name="answer_question")
    async def answer_question_node(state: GuideState, agent: Any) -> dict[str, Any]:
        """Answer a user question during the learning session."""
        question = state.get("current_query", "")
        topic = state.get("topic", "")
        content = state.get("located_content", "")

        # Build knowledge dict for the guide chat agent
        knowledge = {
            "knowledge_title": topic,
            "knowledge_summary": content,
            "user_difficulty": "",
        }

        # Get chat history from messages
        chat_history: list[dict[str, str]] = []
        for msg in state.get("messages", []):
            if isinstance(msg, dict):
                chat_history.append(msg)
            elif hasattr(msg, "to_dict"):
                chat_history.append(msg.to_dict())

        result = await agent.process(
            knowledge=knowledge,
            chat_history=chat_history,
            user_question=question,
        )

        return {"final_answer": result.get("answer", "")}

    @agent_node(summary_agent, output_key="summary", step_name="summarize")
    async def summarize_node(state: GuideState, agent: Any) -> dict[str, Any]:
        """Generate a learning session summary."""
        topic = state.get("topic", "")
        content = state.get("located_content", "")

        result = await agent.process(
            source_label=state.get("kb_name", "") or topic,
            knowledge_points=state.get("knowledge_points", []),
            chat_history=[],
        )

        return {
            "summary": result.get("summary", ""),
            "final_answer": result.get("summary", ""),
        }

    # ââ Condition ââââââââââââââââââââââââââââââââââââââââââââââââââââ

    def guide_flow_condition(state: GuideState) -> str:
        """Determine next step: answer a question or summarize."""
        if state.get("error"):
            return "summarize"
        # If there's a pending user query, answer it
        if state.get("current_query", ""):
            return "question"
        return "summarize"

    # ââ Build Graph ââââââââââââââââââââââââââââââââââââââââââââââââââ

    builder = GraphBuilder(GuideState, name="guide")

    builder.add_node("locate_content", locate_content_node)
    builder.add_node("interactive_teach", interactive_teach_node)
    builder.add_node("answer_question", answer_question_node)
    builder.add_node("summarize", summarize_node)

    builder.set_entry("locate_content")
    builder.add_edge("locate_content", "interactive_teach")
    builder.add_conditional_edge(
        "interactive_teach",
        guide_flow_condition,
        {"question": "answer_question", "summarize": "summarize"},
    )
    builder.add_edge("answer_question", "interactive_teach")
    builder.set_finish("summarize")

    return builder.compile()


async def run_guide_session(
    topic: str,
    kb_name: str = "",
    language: str = "zh",
    api_key: str = "",
    base_url: str = "",
) -> dict[str, Any]:
    """
    Convenience function to run the guide graph for initial session setup.

    Args:
        topic: Learning topic.
        kb_name: Knowledge base name.
        language: Language setting.
        api_key: LLM API key.
        base_url: LLM API endpoint.

    Returns:
        Dict with ``teaching_content``, ``interactive_elements``, and ``summary``.
    """
    graph = build_guide_graph(api_key=api_key, base_url=base_url, language=language)

    initial_state: GuideState = {
        "topic": topic,
        "current_query": "",
        "kb_name": kb_name,
        "language": language,
        "messages": [],
        "citations": [],
        "tool_results": [],
        "intermediate_steps": [],
        "should_continue": True,
        "stream_tokens": False,
    }

    result = await graph.ainvoke(initial_state)

    return {
        "teaching_content": result.get("final_answer", ""),
        "interactive_elements": result.get("interactive_elements", []),
        "summary": result.get("summary", ""),
    }

