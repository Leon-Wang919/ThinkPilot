# -*- coding: utf-8 -*-
"""
Graph builder utilities for constructing LangGraph StateGraphs.

Provides helper functions to reduce boilerplate when defining graphs
for each agent module.

Usage:
    from src.graphs.builder import GraphBuilder
    from src.graphs.state import ChatState

    builder = GraphBuilder(ChatState)
    builder.add_node("retrieve", retrieve_node)
    builder.add_node("respond", respond_node)
    builder.add_edge("retrieve", "respond")
    builder.set_entry("retrieve")
    builder.set_finish("respond")
    graph = builder.compile()
    result = await graph.ainvoke(initial_state)
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Hashable
from typing import Any, TypeVar

from langgraph.graph import END, START, StateGraph

from src.tlogging import get_logger

logger = get_logger("Graphs.Builder")

StateT = TypeVar("StateT", bound=dict)


class GraphBuilder:
    """
    Convenience wrapper around ``langgraph.graph.StateGraph``.

    Simplifies the common patterns:
    - Linear pipelines (A -> B -> C -> END)
    - Loops with a condition (A -> B -> should_continue? -> A / END)
    - Parallel fan-out / fan-in
    """

    def __init__(self, state_schema: type[StateT], name: str = ""):
        self.name = name
        self._graph = StateGraph(state_schema)
        self._nodes: list[str] = []

    # ------------------------------------------------------------------
    # Node management
    # ------------------------------------------------------------------

    def add_node(
        self,
        name: str,
        func: Callable[[dict[str, Any]], Awaitable[dict[str, Any]] | dict[str, Any]],
    ) -> "GraphBuilder":
        """Add a node to the graph."""
        self._graph.add_node(name, func)
        self._nodes.append(name)
        logger.debug(f"[{self.name}] Added node: {name}")
        return self

    # ------------------------------------------------------------------
    # Edge management
    # ------------------------------------------------------------------

    def add_edge(self, source: str, target: str) -> "GraphBuilder":
        """Add a direct edge between two nodes."""
        self._graph.add_edge(source, target)
        return self

    def add_conditional_edge(
        self,
        source: str,
        condition: Callable[[dict[str, Any]], Hashable],
        mapping: dict[Hashable, str] | None = None,
    ) -> "GraphBuilder":
        """
        Add a conditional edge from *source*.

        Args:
            source: Source node name.
            condition: Function that receives state and returns a key.
            mapping: Maps condition return values to target node names.
                     Use ``"__end__"`` to map to the graph END.
        """
        if mapping:
            resolved = {
                key: END if val == "__end__" else val
                for key, val in mapping.items()
            }
            self._graph.add_conditional_edges(source, condition, resolved)
        else:
            self._graph.add_conditional_edges(source, condition)
        return self

    def set_entry(self, node: str) -> "GraphBuilder":
        """Set the entry point of the graph."""
        self._graph.add_edge(START, node)
        return self

    def set_finish(self, node: str) -> "GraphBuilder":
        """Set a node as a terminal node (edge to END)."""
        self._graph.add_edge(node, END)
        return self

    # ------------------------------------------------------------------
    # Convenience patterns
    # ------------------------------------------------------------------

    def linear(self, *node_names: str) -> "GraphBuilder":
        """
        Wire nodes in a linear pipeline: A -> B -> C -> ... -> END.

        All nodes must already be added via ``add_node()``.
        The first node becomes the entry point and the last gets an
        edge to END.
        """
        if len(node_names) < 1:
            raise ValueError("linear() requires at least one node name")

        self.set_entry(node_names[0])
        for i in range(len(node_names) - 1):
            self.add_edge(node_names[i], node_names[i + 1])
        self.set_finish(node_names[-1])
        return self

    def loop(
        self,
        body_node: str,
        condition: Callable[[dict[str, Any]], Hashable],
        continue_key: Hashable = "continue",
        exit_key: Hashable = "exit",
        exit_node: str | None = None,
    ) -> "GraphBuilder":
        """
        Create a loop: body_node -> condition -> body_node (continue) or exit.

        Args:
            body_node: The node to loop.
            condition: Returns *continue_key* to loop or *exit_key* to exit.
            continue_key: Key returned by condition to continue looping.
            exit_key: Key returned by condition to exit the loop.
            exit_node: Node to go to on exit. If None, goes to END.
        """
        target = exit_node or "__end__"
        self.add_conditional_edge(
            body_node,
            condition,
            {continue_key: body_node, exit_key: target},
        )
        return self

    # ------------------------------------------------------------------
    # Compile
    # ------------------------------------------------------------------

    def compile(self, **kwargs: Any) -> Any:
        """Compile the graph into a runnable."""
        graph_name = self.name or "unnamed"
        logger.info(
            f"Compiling graph '{graph_name}' with {len(self._nodes)} nodes: "
            f"{', '.join(self._nodes)}"
        )
        return self._graph.compile(**kwargs)


# ---------------------------------------------------------------------------
# Condition helpers
# ---------------------------------------------------------------------------

def should_continue_condition(state: dict[str, Any]) -> str:
    """
    Generic loop condition based on ``should_continue`` and ``max_iterations``.

    Returns ``"continue"`` or ``"exit"``.
    """
    if state.get("error"):
        return "exit"
    if not state.get("should_continue", True):
        return "exit"

    iteration = state.get("iteration_count", 0)
    max_iter = state.get("max_iterations", 5)
    if iteration >= max_iter:
        logger.info(f"Max iterations ({max_iter}) reached, exiting loop")
        return "exit"

    return "continue"


def has_error_condition(state: dict[str, Any]) -> str:
    """Returns ``"error"`` if state has an error, else ``"ok"``."""
    return "error" if state.get("error") else "ok"
