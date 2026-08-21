"""
Solve Graph â?LangGraph implementation of the dual-loop problem-solving workflow.

Architecture (mirrors MainSolver):
    START â?investigate â?take_notes â?[analysis_complete?]
        ââ continue â?investigate (loop)
        ââ exit â?plan_steps â?solve_step â?[needs_tool?]
                                    ââ yes â?execute_tools â?solve_step (loop)
                                    ââ no â?generate_response â?[more_steps?]
                                                    ââ yes â?solve_step (loop)
                                                    ââ no â?precision_answer â?END

Reuses existing Agent classes from src/agents/solve/ as node executors.
"""

from __future__ import annotations

from typing import Any

from src.graphs.builder import GraphBuilder
from src.graphs.nodes import agent_node
from src.graphs.state import SolveState
from src.tlogging import get_logger

logger = get_logger("Graphs.Solve")


def build_solve_graph(config: dict[str, Any] | None = None) -> Any:
    """
    Build and compile the solve LangGraph.

    The graph implements the dual-loop architecture:
    - **Analysis Loop**: investigate â?take_notes â?(loop until analysis_complete)
    - **Solve Loop**: plan â?solve_step â?tool_calls â?response â?(loop per step)

    Args:
        config: Solver configuration dict (loaded from main.yaml / solve_config.yaml).

    Returns:
        A compiled LangGraph runnable.
    """
    from src.agents.solve.analysis_loop import InvestigateAgent, NoteAgent
    from src.agents.solve.solve_loop import (
        ManagerAgent,
        PrecisionAnswerAgent,
        ResponseAgent,
        SolveAgent,
        ToolAgent,
    )

    config = config or {}
    language = config.get("system", {}).get("language", "zh")
    api_key = config.get("llm", {}).get("api_key", "")
    base_url = config.get("llm", {}).get("base_url", "")
    api_version = config.get("llm", {}).get("api_version")

    # Lazy-init agents â?they are created once when the graph is built
    investigate_agent = InvestigateAgent(
        config, api_key, base_url, api_version=api_version
    )
    note_agent = NoteAgent(
        config=config, api_key=api_key, base_url=base_url, api_version=api_version
    )
    manager_agent = ManagerAgent(config, api_key, base_url, api_version=api_version)
    solve_agent = SolveAgent(config, api_key, base_url, api_version=api_version)
    tool_agent = ToolAgent(config, api_key, base_url, api_version=api_version)
    response_agent = ResponseAgent(config, api_key, base_url, api_version=api_version)
    precision_agent = PrecisionAnswerAgent(config, api_key, base_url, api_version=api_version)

    # ââ Analysis Loop Nodes ââââââââââââââââââââââââââââââââââââââââââ

    @agent_node(investigate_agent, output_key="rag_context", step_name="investigate")
    async def investigate_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Run investigation to gather knowledge about the problem."""
        question = state.get("current_query", "")
        kb_name = state.get("kb_name", "")
        iteration = state.get("iteration_count", 0)

        result = await agent.process(
            question=question,
            kb_name=kb_name,
            iteration=iteration,
        )

        knowledge = result.get("knowledge", "")
        is_complete = result.get("analysis_complete", False)

        return {
            "rag_context": knowledge,
            "investigation_notes": [knowledge] if knowledge else [],
            "analysis_complete": is_complete,
            "iteration_count": iteration + 1,
        }

    @agent_node(note_agent, output_key="rag_context", step_name="take_notes")
    async def take_notes_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Consolidate investigation findings into structured notes."""
        question = state.get("current_query", "")
        notes = state.get("investigation_notes", [])

        result = await agent.process(
            question=question,
            knowledge_items=notes,
        )

        return {
            "rag_context": result.get("consolidated_notes", ""),
        }

    # ââ Solve Loop Nodes âââââââââââââââââââââââââââââââââââââââââââââ

    @agent_node(manager_agent, output_key="solve_plan", step_name="plan_steps")
    async def plan_steps_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Plan the solution steps based on investigation results."""
        question = state.get("current_query", "")
        context = state.get("rag_context", "")

        result = await agent.process(
            question=question,
            knowledge_context=context,
        )

        steps = result.get("steps", [])
        return {
            "solve_plan": str(result),
            "solve_steps": [{"step": s, "status": "pending"} for s in steps],
            "iteration_count": 0,
        }

    @agent_node(solve_agent, output_key="final_answer", step_name="solve_step")
    async def solve_step_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Execute a single solve step â?may request tool calls."""
        question = state.get("current_query", "")
        steps = state.get("solve_steps", [])
        iteration = state.get("iteration_count", 0)

        current_step = steps[iteration] if iteration < len(steps) else {}

        result = await agent.process(
            question=question,
            current_step=current_step,
        )

        needs_tool = result.get("needs_tool_call", False)
        return {
            "needs_tool_call": needs_tool,
            "final_answer": result.get("response", ""),
        }

    @agent_node(tool_agent, output_key="rag_context", step_name="execute_tools")
    async def execute_tools_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Execute tool calls requested by the solve step."""
        result = await agent.process(
            tool_requests=state.get("tool_results", []),
            kb_name=state.get("kb_name", ""),
        )

        return {
            "rag_context": result.get("tool_output", ""),
            "needs_tool_call": False,
        }

    @agent_node(response_agent, output_key="final_answer", step_name="generate_response")
    async def generate_response_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Generate a formal response for the current solve step."""
        question = state.get("current_query", "")
        context = state.get("rag_context", "")

        result = await agent.process(
            question=question,
            context=context,
        )

        iteration = state.get("iteration_count", 0)
        steps = state.get("solve_steps", [])
        has_more = iteration + 1 < len(steps)

        return {
            "final_answer": result.get("response", ""),
            "should_continue": has_more,
            "iteration_count": iteration + 1,
        }

    @agent_node(precision_agent, output_key="final_answer", step_name="precision_answer")
    async def precision_answer_node(state: SolveState, agent: Any) -> dict[str, Any]:
        """Generate the final precision answer combining all step results."""
        question = state.get("current_query", "")
        steps = state.get("solve_steps", [])
        answer = state.get("final_answer", "")

        result = await agent.process(
            question=question,
            draft_answer=answer,
            solve_steps=steps,
        )

        return {"final_answer": result.get("precision_answer", answer)}

    # ââ Condition Functions ââââââââââââââââââââââââââââââââââââââââââ

    def analysis_loop_condition(state: SolveState) -> str:
        if state.get("error"):
            return "exit"
        if state.get("analysis_complete", False):
            return "exit"
        iteration = state.get("iteration_count", 0)
        max_iter = state.get("max_iterations", 5)
        if iteration >= max_iter:
            return "exit"
        return "continue"

    def tool_call_condition(state: SolveState) -> str:
        if state.get("needs_tool_call", False):
            return "needs_tools"
        return "no_tools"

    def solve_loop_condition(state: SolveState) -> str:
        if state.get("error"):
            return "done"
        if not state.get("should_continue", True):
            return "done"
        return "next_step"

    # ââ Build Graph ââââââââââââââââââââââââââââââââââââââââââââââââââ

    builder = GraphBuilder(SolveState, name="solve")

    # Add all nodes
    builder.add_node("investigate", investigate_node)
    builder.add_node("take_notes", take_notes_node)
    builder.add_node("plan_steps", plan_steps_node)
    builder.add_node("solve_step", solve_step_node)
    builder.add_node("execute_tools", execute_tools_node)
    builder.add_node("generate_response", generate_response_node)
    builder.add_node("precision_answer", precision_answer_node)

    # Entry: start with investigation
    builder.set_entry("investigate")

    # Analysis loop: investigate â?take_notes â?condition
    builder.add_edge("investigate", "take_notes")
    builder.add_conditional_edge(
        "take_notes",
        analysis_loop_condition,
        {"continue": "investigate", "exit": "plan_steps"},
    )

    # Solve loop: plan â?solve_step â?condition
    builder.add_edge("plan_steps", "solve_step")
    builder.add_conditional_edge(
        "solve_step",
        tool_call_condition,
        {"needs_tools": "execute_tools", "no_tools": "generate_response"},
    )
    builder.add_edge("execute_tools", "solve_step")
    builder.add_conditional_edge(
        "generate_response",
        solve_loop_condition,
        {"next_step": "solve_step", "done": "precision_answer"},
    )

    # Terminal
    builder.set_finish("precision_answer")

    return builder.compile()


async def run_solve(
    question: str,
    kb_name: str = "",
    language: str = "zh",
    config: dict[str, Any] | None = None,
    max_iterations: int = 5,
) -> dict[str, Any]:
    """
    Convenience function to run the solve graph.

    Args:
        question: The problem to solve.
        kb_name: Knowledge base name for RAG.
        language: Language setting.
        config: Solver configuration.
        max_iterations: Maximum analysis loop iterations.

    Returns:
        Dict with ``final_answer``, ``solve_steps``, and ``citations``.
    """
    graph = build_solve_graph(config=config)

    initial_state: SolveState = {
        "current_query": question,
        "kb_name": kb_name,
        "language": language,
        "messages": [],
        "citations": [],
        "investigation_notes": [],
        "solve_steps": [],
        "tool_results": [],
        "intermediate_steps": [],
        "analysis_complete": False,
        "needs_tool_call": False,
        "should_continue": True,
        "iteration_count": 0,
        "max_iterations": max_iterations,
        "stream_tokens": False,
    }

    result = await graph.ainvoke(initial_state)

    return {
        "answer": result.get("final_answer", ""),
        "solve_steps": result.get("solve_steps", []),
        "citations": result.get("citations", []),
        "investigation_notes": result.get("investigation_notes", []),
    }

