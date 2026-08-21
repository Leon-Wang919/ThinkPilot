# -*- coding: utf-8 -*-
"""
LangGraph-based Agent Orchestration Framework.

This package provides the infrastructure for building agent workflows
using LangGraph's StateGraph. It bridges the existing BaseAgent system
(LLM calls, prompt management, token tracking) with LangGraph's
graph-based orchestration.

Architecture:
    src/graphs/
    |-- state.py    TypedDict state definitions
    |-- nodes.py    BaseAgent -> Node bridge
    |-- builder.py  Graph construction helpers
    |-- types.py    Shared type definitions
    |
    |-- chat/       Chat graph (Phase 1)
    |-- solve/      Solve graph (Phase 1)
    |-- guide/      Guide graph (Phase 1)
    |-- feynman/    Feynman assessment graph

Usage:
    from src.graphs.builder import GraphBuilder
    from src.graphs.state import ChatState
    from src.graphs.nodes import agent_node, make_llm_node

    # Build a simple chat graph
    builder = GraphBuilder(ChatState, name="chat")
    builder.add_node("respond", respond_node)
    builder.linear("respond")
    graph = builder.compile()
"""

from .builder import GraphBuilder, has_error_condition, should_continue_condition
from .chat.graph import build_chat_graph, run_chat
from .feynman.graph import build_feynman_graph, run_feynman_turn
from .guide.graph import build_guide_graph, run_guide_session
from .nodes import agent_node, make_llm_node, passthrough_node
from .solve.graph import build_solve_graph, run_solve
from .teacher.graph import build_teacher_graph, run_teacher_turn
from .state import (
    BaseGraphState,
    ChatState,
    FeynmanState,
    GuideState,
    SolveState,
    TeacherState,
)
from .types import Citation, Message, MessageRole, NodeStatus, StreamEvent, ToolCallResult

__all__ = [
    # Builder
    "GraphBuilder",
    "should_continue_condition",
    "has_error_condition",
    # Nodes
    "agent_node",
    "make_llm_node",
    "passthrough_node",
    # Graph builders & runners
    "build_chat_graph",
    "run_chat",
    "build_solve_graph",
    "run_solve",
    "build_guide_graph",
    "run_guide_session",
    "build_feynman_graph",
    "run_feynman_turn",
    "build_teacher_graph",
    "run_teacher_turn",
    # States
    "BaseGraphState",
    "ChatState",
    "SolveState",
    "GuideState",
    "FeynmanState",
    "TeacherState",
    # Types
    "Message",
    "MessageRole",
    "Citation",
    "NodeStatus",
    "StreamEvent",
    "ToolCallResult",
]
