"""
Shared type definitions for the LangGraph-based agent system.

Provides common enums, type aliases, and data structures used across
all graph modules.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class NodeStatus(str, Enum):
    """Status of a graph node execution."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class MessageRole(str, Enum):
    """Role of a message in conversation."""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class Message(BaseModel):
    """A single message in a conversation."""

    role: MessageRole
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role.value, "content": self.content}


class Citation(BaseModel):
    """A citation reference from RAG or web search."""

    source: str = ""
    content: str = ""
    url: str = ""
    relevance_score: float = 0.0


class ToolCallResult(BaseModel):
    """Result from a tool invocation within a graph node."""

    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    error: str | None = None
    duration_seconds: float = 0.0


class StreamEvent(BaseModel):
    """An event emitted during graph execution for streaming to frontend."""

    event_type: str
    node_name: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    partial_text: str = ""

