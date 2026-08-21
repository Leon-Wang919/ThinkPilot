from __future__ import annotations

from typing import Any

from src.agents.router import Mode, SubjectRouter
from src.agents.teacher.session_manager import (
    TeacherSessionManager,
    build_default_teacher_state,
)
from src.config.accessors import normalize_subject


class TeacherTurnService:
    def __init__(
        self,
        *,
        subject_router: SubjectRouter,
        session_manager: TeacherSessionManager,
    ):
        self.subject_router = subject_router
        self.session_manager = session_manager

    async def run_turn(
        self,
        *,
        input_text: str,
        subject: str,
        kb_name: str,
        preferred_mode: str,
        language: str,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        subject_name = normalize_subject(subject)
        session = self._resolve_session(
            session_id=session_id,
            subject=subject_name,
            kb_name=kb_name,
            preferred_mode=preferred_mode,
            title=input_text,
        )
        settings = session.get("settings", {}) if isinstance(session.get("settings"), dict) else {}
        active_subject = normalize_subject(settings.get("subject", subject_name))
        active_kb_name = kb_name or settings.get("kb_name", "")
        active_mode = preferred_mode or settings.get("preferred_mode", "explain-first")

        persisted_teacher_state = dict(settings.get("teacher_state", {}) or {})
        if (
            persisted_teacher_state.get("turn_kind") == "summary"
            and not persisted_teacher_state.get("awaiting_student_response", False)
        ) or settings.get("preferred_mode") not in {None, active_mode}:
            persisted_teacher_state = build_default_teacher_state(
                preferred_mode=active_mode,
                topic=input_text,
            )

        history = [
            {"role": item.get("role", "user"), "content": item.get("content", "")}
            for item in session.get("messages", [])
        ]
        history.append({"role": "user", "content": input_text})

        workflow = self.subject_router.route(
            active_subject,
            Mode.TEACHER,
            input_text,
            language=language,
        )
        result = await workflow.run_turn(
            question=input_text,
            preferred_mode=active_mode,
            kb_name=active_kb_name,
            messages=history,
            teacher_state=persisted_teacher_state,
        )
        teacher_state = dict(result.get("teacher_state", {}) or {})
        topic = str(result.get("topic") or teacher_state.get("topic") or input_text)[:120]
        metadata = {
            "subject": active_subject,
            "kb_name": active_kb_name,
            "teaching_mode": result.get("teaching_mode", "teach"),
            "step_plan": result.get("step_plan", []),
            "current_step": result.get("current_step", 0),
            "awaiting_student_response": result.get("awaiting_student_response", False),
            "socratic_questions": result.get("socratic_questions", []),
        }
        self.session_manager.save_turn(
            session["session_id"],
            user_message=input_text,
            assistant_message=result.get("response", ""),
            subject=active_subject,
            kb_name=active_kb_name,
            preferred_mode=active_mode,
            topic=topic,
            teacher_state=teacher_state,
            metadata=metadata,
        )
        return {
            "success": True,
            "session_id": session["session_id"],
            "subject": active_subject,
            "kb_name": active_kb_name,
            **result,
        }

    def _resolve_session(
        self,
        *,
        session_id: str | None,
        subject: str,
        kb_name: str,
        preferred_mode: str,
        title: str,
    ) -> dict[str, Any]:
        if session_id:
            session = self.session_manager.get_session(session_id)
            if session:
                return session
        return self.session_manager.create_session(
            title=title,
            subject=subject,
            kb_name=kb_name,
            preferred_mode=preferred_mode,
            topic=title,
        )
