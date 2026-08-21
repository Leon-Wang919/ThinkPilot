from typing import Any, Dict, List

from pydantic import BaseModel, Field, field_validator


class LLMConfig(BaseModel):
    model: str
    provider: str = "openai"


class PathsConfig(BaseModel):
    user_data_dir: str
    knowledge_bases_dir: str
    user_log_dir: str


class SubjectConfig(BaseModel):
    temperature: float = 0.5
    max_tokens: int = 4096
    system_prompt_prefix: str = ""
    kb_name: str = ""
    knowledge_base_paths: List[str] = Field(default_factory=list)
    valid_tools: List[str] = Field(default_factory=list)
    default_behavior: str = "explain-first"

    @field_validator("default_behavior")
    @classmethod
    def validate_default_behavior(cls, value: str) -> str:
        if value not in {"explain-first", "solve-first"}:
            raise ValueError("default_behavior must be 'explain-first' or 'solve-first'")
        return value


class AppConfig(BaseModel):
    llm: LLMConfig
    paths: PathsConfig
    subjects: Dict[str, SubjectConfig] = Field(default_factory=dict)

    @field_validator("llm", mode="before")
    @classmethod
    def ensure_llm(cls, v: Any) -> Dict[str, Any]:
        if not isinstance(v, dict):
            raise ValueError("llm section must be a mapping")
        if "model" not in v:
            raise ValueError("llm.model is required")
        return v


CURRENT_SCHEMA_VERSION = 1


def migrate_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    No-op migration for now; placeholder for future versioned changes.
    """
    return cfg

