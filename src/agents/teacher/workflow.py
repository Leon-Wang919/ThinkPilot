from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.config.schema import SubjectConfig
from src.graphs.teacher.graph import run_teacher_turn


@dataclass
class TeacherWorkflow:
    subject: str
    language: str
    subject_config: SubjectConfig

    async def run_turn(
        self,
        question: str,
        preferred_mode: str,
        kb_name: str | None = None,
        messages: list[dict[str, str]] | None = None,
        teacher_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await run_teacher_turn(
            question=question,
            subject=self.subject,
            kb_name=kb_name or self.subject_config.kb_name,
            preferred_mode=preferred_mode,
            messages=messages or [],
            teacher_state=teacher_state or {},
            language=self.language,
        )

    async def run_chat(
        self,
        message: str,
        kb_name: str | None = None,
        messages: list[dict[str, str]] | None = None,
        teacher_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.run_turn(
            question=message,
            preferred_mode="explain-first",
            kb_name=kb_name,
            messages=messages,
            teacher_state=teacher_state,
        )

    async def run_solve(
        self,
        question: str,
        kb_name: str | None = None,
        messages: list[dict[str, str]] | None = None,
        teacher_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.run_turn(
            question=question,
            preferred_mode="solve-first",
            kb_name=kb_name,
            messages=messages,
            teacher_state=teacher_state,
        )
