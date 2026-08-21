"""
Chat Graph ?LangGraph implementation of the chat workflow.

Flow:
    START ?retrieve_context ?build_and_respond ?END

Reuses the existing ChatAgent for LLM calls and context retrieval.
"""

from __future__ import annotations

from typing import Any

from src.agents.chat.chat_agent import ChatAgent
from src.agents.chat.session_manager import SessionManager
from src.graphs.builder import GraphBuilder
from src.graphs.nodes import agent_node
from src.graphs.state import ChatState
from src.graphs.types import Citation, Message, MessageRole
from src.tlogging import get_logger

logger = get_logger("Graphs.Chat")


def _create_chat_agent(language: str = "zh", **kwargs: Any) -> ChatAgent:
    """Create a ChatAgent instance with the given language."""
    return ChatAgent(language=language, **kwargs)


def build_chat_graph(language: str = "zh", **agent_kwargs: Any) -> Any:
    """
    Build and compile the chat LangGraph.

    The graph has two nodes:
    1. ``retrieve_context``: Fetches RAG and/or web search context.
    2. ``build_and_respond``: Builds the message array and calls the LLM.

    Args:
        language: Language setting for the ChatAgent.
        **agent_kwargs: Extra kwargs forwarded to ChatAgent constructor.

    Returns:
        A compiled LangGraph runnable.
    """
    chat_agent = _create_chat_agent(language=language, **agent_kwargs)

    @agent_node(chat_agent, output_key="rag_context", step_name="retrieve_context")
    async def retrieve_context_node(state: ChatState, agent: ChatAgent) -> dict[str, Any]:
        """Retrieve context from RAG and/or web search."""
        message = state.get("current_query", "")
        kb_name = state.get("kb_name", "")
        enable_rag = state.get("enable_rag", False)
        enable_web_search = state.get("enable_web_search", False)

        if not enable_rag and not enable_web_search:
            return {"rag_context": "", "web_context": ""}

        context_str, sources = await agent.retrieve_context(
            message=message,
            kb_name=kb_name if enable_rag else None,
            enable_rag=enable_rag,
            enable_web_search=enable_web_search,
        )

        citations: list[Citation] = []
        for rag_source in sources.get("rag", []):
            citations.append(
                Citation(
                    source=rag_source.get("kb_name", ""),
                    content=rag_source.get("content", ""),
                )
            )
        for web_source in sources.get("web", []):
            citations.append(
                Citation(
                    source=web_source.get("title", ""),
                    url=web_source.get("url", ""),
                    content=web_source.get("snippet", ""),
                )
            )

        rag_parts = []
        web_parts = []
        for rag_source in sources.get("rag", []):
            rag_parts.append(rag_source.get("content", ""))
        for web_source in sources.get("web", []):
            web_parts.append(web_source.get("snippet", ""))

        return {
            "rag_context": "\n".join(rag_parts) if rag_parts else context_str,
            "web_context": "\n".join(web_parts),
            "citations": citations,
        }

    @agent_node(chat_agent, output_key="final_answer", step_name="build_and_respond")
    async def build_and_respond_node(state: ChatState, agent: ChatAgent) -> dict[str, Any]:
        """Build messages and generate the LLM response."""
        current_query = state.get("current_query", "")

        # Convert state messages to history format
        history: list[dict[str, str]] = []
        for msg in state.get("messages", []):
            if isinstance(msg, Message):
                history.append(msg.to_dict())
            elif isinstance(msg, dict):
                history.append(msg)

        # Truncate history to fit token limits
        truncated_history = agent.truncate_history(history)

        # Combine RAG and web context
        context_parts = []
        rag_ctx = state.get("rag_context", "")
        web_ctx = state.get("web_context", "")
        if rag_ctx:
            context_parts.append(rag_ctx)
        if web_ctx:
            context_parts.append(web_ctx)
        combined_context = "\n\n".join(context_parts)

        # Build messages array
        messages = agent.build_messages(
            message=current_query,
            history=truncated_history,
            context=combined_context,
        )

        # Generate response
        response = await agent.generate(messages)

        # Create assistant message for state
        assistant_message = Message(
            role=MessageRole.ASSISTANT,
            content=response,
        )

        return {
            "final_answer": response,
            "messages": [
                Message(role=MessageRole.USER, content=current_query),
                assistant_message,
            ],
        }

    # Build the graph
    builder = GraphBuilder(ChatState, name="chat")
    builder.add_node("retrieve_context", retrieve_context_node)
    builder.add_node("build_and_respond", build_and_respond_node)
    builder.linear("retrieve_context", "build_and_respond")

    return builder.compile()


async def run_chat(
    message: str,
    history: list[dict[str, str]] | None = None,
    kb_name: str = "",
    enable_rag: bool = False,
    enable_web_search: bool = False,
    language: str = "zh",
    session_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Convenience function to run the chat graph.

    Args:
        message: User message.
        history: Previous conversation history.
        kb_name: Knowledge base name for RAG.
        enable_rag: Whether to enable RAG retrieval.
        enable_web_search: Whether to enable web search.
        language: Language setting.
        session_id: Optional session ID.
        **kwargs: Extra kwargs for ChatAgent.

    Returns:
        Dict with ``final_answer``, ``citations``, and ``messages``.
    """
    graph = build_chat_graph(language=language, **kwargs)

    # Convert history to Message objects
    initial_messages: list[Message] = []
    for msg in (history or []):
        role_str = msg.get("role", "user")
        role = MessageRole.USER if role_str == "user" else MessageRole.ASSISTANT
        initial_messages.append(Message(role=role, content=msg.get("content", "")))

    initial_state: ChatState = {
        "current_query": message,
        "messages": initial_messages,
        "kb_name": kb_name,
        "enable_rag": enable_rag,
        "enable_web_search": enable_web_search,
        "language": language,
        "session_id": session_id,
        "should_continue": True,
        "stream_tokens": False,
    }

    result = await graph.ainvoke(initial_state)

    return {
        "response": result.get("final_answer", ""),
        "citations": result.get("citations", []),
        "messages": result.get("messages", []),
    }

