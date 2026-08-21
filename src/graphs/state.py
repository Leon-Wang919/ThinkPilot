"""
Unified State definitions for the LangGraph-based agent system.

All graph modules share a common base state structure. Module-specific
states extend BaseGraphState with additional fields.

Design principles:
- BaseGraphState holds fields common to every workflow (messages, config, etc.)
- Module states (SolveState, ResearchState, ...) add domain-specific fields.
- Reducer annotations (Annotated[list, operator.add]) let LangGraph merge
  updates from parallel branches automatically.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any

from typing_extensions import TypedDict

from .types import Citation, Message, ToolCallResult


# ---------------------------------------------------------------------------
# Base state ?shared by all graphs
# ---------------------------------------------------------------------------

class BaseGraphState(TypedDict, total=False):
    """
    Base state shared across all LangGraph workflows.

    Fields use LangGraph reducer annotations where appropriate so that
    parallel node outputs are merged correctly.
    """

    # --- Conversation ---
    messages: Annotated[list[Message], operator.add]
    current_query: str
    language: str  # "zh" | "en"

    # --- Knowledge / RAG ---
    kb_name: str
    rag_context: str
    web_context: str
    citations: Annotated[list[Citation], operator.add]

    # --- Control flow ---
    current_node: str
    iteration_count: int
    max_iterations: int
    should_continue: bool
    error: str | None

    # --- Tool calls ---
    tool_results: Annotated[list[ToolCallResult], operator.add]

    # --- Output ---
    final_answer: str
    intermediate_steps: Annotated[list[dict[str, Any]], operator.add]

    # --- Streaming ---
    stream_tokens: bool


# ---------------------------------------------------------------------------
# Module-specific states
# ---------------------------------------------------------------------------

class ChatState(BaseGraphState, total=False):
    """State for the lightweight chat graph."""

    session_id: str
    enable_rag: bool
    enable_web_search: bool


class SolveState(BaseGraphState, total=False):
    """State for the problem-solving dual-loop graph."""

    # Analysis loop
    investigation_notes: Annotated[list[str], operator.add]
    analysis_complete: bool

    # Solve loop
    solve_plan: str
    solve_steps: Annotated[list[dict[str, Any]], operator.add]
    needs_tool_call: bool
    precision_mode: bool

    # Memory
    solve_memory: dict[str, Any]
    citation_memory: dict[str, Any]
    investigate_memory: dict[str, Any]


class ResearchState(BaseGraphState, total=False):
    """State for the deep research pipeline graph."""

    research_topic: str
    sub_questions: Annotated[list[str], operator.add]
    research_notes: Annotated[list[dict[str, Any]], operator.add]
    report_sections: Annotated[list[str], operator.add]
    final_report: str


class GuideState(BaseGraphState, total=False):
    """State for the guided learning graph."""

    topic: str
    located_content: str
    summary: str
    interactive_elements: list[dict[str, Any]]


class IdeaGenState(BaseGraphState, total=False):
    """State for the idea generation workflow graph."""

    knowledge_points: list[dict[str, Any]]
    filtered_points: list[dict[str, Any]]
    research_ideas: Annotated[list[dict[str, Any]], operator.add]
    filtered_ideas: list[dict[str, Any]]
    final_ideas: list[dict[str, Any]]


class CoWriterState(BaseGraphState, total=False):
    """State for the co-writer graph."""

    document_content: str
    edit_instructions: str
    edited_content: str
    narration_script: str


# ---------------------------------------------------------------------------
# New feature states (Phase 3)
# ---------------------------------------------------------------------------

class FeynmanState(BaseGraphState, total=False):
    """State for the reverse classroom (Feynman method) graph."""

    persona: str  # AI persona name
    persona_prompt: str  # Full persona system prompt
    subject: str
    topic: str
    user_explanation: str
    follow_up_questions: Annotated[list[str], operator.add]
    evaluation_report: dict[str, Any]
    logic_gaps: Annotated[list[str], operator.add]
    reference_notes: str
    reference_source_label: str


class TeacherState(BaseGraphState, total=False):
    """State for the subject-routed teacher workflow."""

    subject: str
    preferred_mode: str
    teaching_mode: str
    topic: str
    step_plan: list[str]
    current_step: int
    active_step_index: int
    awaiting_student_response: bool
    pending_prompt: str
    turn_kind: str
    mastery_signals: dict[str, Any]
    socratic_questions: list[str]
    student_responses: list[str]
    solve_explanation: str


class FlashcardState(BaseGraphState, total=False):
    """State for the flashcard review system graph."""

    user_id: str
    cards_due: list[dict[str, Any]]
    current_card: dict[str, Any] | None
    user_rating: int | None  # 1=forgot, 2=hard, 3=ok, 4=easy
    scheduling_result: dict[str, Any]


class ErrorBookState(BaseGraphState, total=False):
    """State for the automatic error collection graph."""

    detected_errors: Annotated[list[dict[str, Any]], operator.add]
    error_analysis: dict[str, Any]
    tags: list[str]


class MockExamState(BaseGraphState, total=False):
    """State for the mock exam system graph."""

    exam_config: dict[str, Any]  # subject, count, duration, mode
    exam_questions: list[dict[str, Any]]
    user_answers: list[dict[str, Any]]
    grading_results: list[dict[str, Any]]
    total_score: float
    exam_mode: str  # "random" | "weakness" | "error_review"


class ClassroomAssistantState(BaseGraphState, total=False):
    """State for the real-time classroom assistant graph."""

    transcript_chunks: Annotated[list[str], operator.add]
    section_summaries: Annotated[list[dict[str, Any]], operator.add]
    glossary_terms: Annotated[list[dict[str, Any]], operator.add]
    full_notes: str


class VideoExplanationState(BaseGraphState, total=False):
    """State for the AI video explanation graph."""

    problem: str
    solution_steps: list[dict[str, Any]]
    manim_code: str
    video_url: str
    audio_script: str


class MemoryBankState(BaseGraphState, total=False):
    """State for the knowledge graph / memory bank graph."""

    knowledge_nodes: list[dict[str, Any]]
    mastery_updates: Annotated[list[dict[str, Any]], operator.add]
    knowledge_tree: dict[str, Any]


class PptState(BaseGraphState, total=False):
    """State for the AI PPT generation graph."""

    topic: str
    outline: list[dict[str, Any]]
    slide_contents: list[dict[str, Any]]
    template_name: str
    output_path: str

class PaperWritingState(BaseGraphState, total=False):
    """State for the academic paper writing assistant graph (OpenPrism integration)."""

    task: str  # "outline" | "write_section" | "polish" | "review" | "cite" | "translate"
    paper_title: str
    paper_content: str  # Current LaTeX or markdown content
    target_section: str  # Which section to work on
    template: str  # LaTeX template name (acl, cvpr, neurips, icml)
    search_query: str  # For arXiv/paper search
    search_results: list[dict[str, Any]]  # arXiv search results
    generated_outline: list[dict[str, Any]]  # Paper outline sections
    generated_content: str  # LLM-generated content
    review_report: dict[str, Any]  # Peer review report
    bibtex_entries: Annotated[list[str], operator.add]  # BibTeX entries
    translation_target: str  # Target language for translation

