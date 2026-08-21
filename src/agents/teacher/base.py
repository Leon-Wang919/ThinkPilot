from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from src.agents.solve.utils.json_utils import extract_json_from_text
from src.config.accessors import get_subject_config, normalize_subject
from src.services.config import PROJECT_ROOT, parse_language
from src.services.llm import complete, get_llm_config, get_token_limit_kwargs


@lru_cache(maxsize=32)
def _load_teacher_prompt(language: str, name: str) -> str:
    prompt_root = PROJECT_ROOT / "src" / "services" / "prompts" / "teacher"
    lang = parse_language(language)
    candidates = [prompt_root / lang / f"{name}.md", prompt_root / "en" / f"{name}.md"]
    for path in candidates:
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    return ""


class TeacherBaseAgent:
    def __init__(self, agent_name: str, language: str = "zh"):
        self.agent_name = agent_name
        self.language = parse_language(language)
        self.project_root = Path(PROJECT_ROOT)

    def prompt(self, name: str) -> str:
        return _load_teacher_prompt(self.language, name)

    def compose_system_prompt(self, subject: str, *extra_prompt_names: str) -> str:
        subject_name = normalize_subject(subject)
        parts = [self.prompt("system"), self.prompt(subject_name)]
        for name in extra_prompt_names:
            parts.append(self.prompt(name))
        return "\n\n".join(part for part in parts if part)

    async def call_completion(
        self,
        subject: str,
        user_prompt: str,
        *extra_prompt_names: str,
        max_tokens: int | None = None,
        **kwargs: Any,
    ) -> str:
        subject_name = normalize_subject(subject)
        subject_config = get_subject_config(subject_name)
        llm_config = get_llm_config()
        token_limit = subject_config.max_tokens
        if max_tokens is not None:
            token_limit = min(token_limit, max_tokens)

        try:
            return await complete(
                prompt=user_prompt,
                system_prompt=self.compose_system_prompt(subject_name, *extra_prompt_names),
                model=llm_config.model,
                api_key=llm_config.api_key,
                base_url=llm_config.base_url,
                api_version=getattr(llm_config, "api_version", None),
                binding=getattr(llm_config, "binding", "openai"),
                temperature=subject_config.temperature,
                **get_token_limit_kwargs(token_limit),
                **kwargs,
            )
        except Exception:
            return ""

    def parse_json(self, text: str) -> dict[str, Any]:
        parsed = extract_json_from_text(text)
        return parsed if isinstance(parsed, dict) else {}

