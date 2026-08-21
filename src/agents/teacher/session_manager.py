from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.db.manager import DatabaseManager, get_db

TEACHER_SESSION_TYPE = "teacher"


def build_default_teacher_state(
    preferred_mode: str = "explain-first",
    topic: str = "",
) -> dict[str, Any]:
    teaching_mode = "solve" if preferred_mode == "solve-first" else "teach"
    return {
        "teaching_mode": teaching_mode,
        "step_plan": [],
        "current_step": 0,
        "active_step_index": 0,
        "awaiting_student_response": False,
        "pending_prompt": "",
        "socratic_questions": [],
        "student_responses": [],
        "turn_kind": "initial",
        "mastery_signals": {},
        "topic": topic[:120],
    }


class TeacherSessionManager:
    def __init__(
        self,
        db: DatabaseManager | None = None,
        legacy_base_dir: str | None = None,
    ):
        self._db = db or get_db()
        self._repo = self._db.session
        if legacy_base_dir is None:
            project_root = Path(__file__).resolve().parents[3]
            legacy_root = project_root / "data" / "user" / "teacher"
        else:
            legacy_root = Path(legacy_base_dir)
        self.legacy_root = legacy_root
        self.legacy_sessions_file = legacy_root / "teacher_sessions.json"
        self._legacy_import_complete = False

    def create_session(
        self,
        title: str,
        subject: str,
        kb_name: str = "",
        preferred_mode: str = "explain-first",
        topic: str | None = None,
        teacher_state: dict[str, Any] | None = None,
        session_id: str | None = None,
        created_at: str | datetime | int | float | None = None,
        updated_at: str | datetime | int | float | None = None,
    ) -> dict[str, Any]:
        self._ensure_legacy_import()
        settings = {
            "subject": subject,
            "kb_name": kb_name,
            "preferred_mode": preferred_mode,
            "topic": (topic or title).strip()[:120],
            "teacher_state": teacher_state
            or build_default_teacher_state(preferred_mode=preferred_mode, topic=topic or title),
        }
        session = self._repo.create_session(
            session_type=TEACHER_SESSION_TYPE,
            title=title[:100] or "New Teacher Session",
            settings=settings,
            session_id=session_id,
            created_at=created_at,
            updated_at=updated_at,
        )
        return self.get_session(session["session_id"]) or self._serialize_session(session)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        self._ensure_legacy_import()
        session = self._repo.get_session_with_messages(session_id)
        if not session or session.get("session_type") != TEACHER_SESSION_TYPE:
            return None
        return self._serialize_session(session)

    def list_sessions(self, subject: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        self._ensure_legacy_import()
        fetch_limit = max(limit * 5, 100) if subject else limit
        sessions = self._repo.list_sessions(
            session_type=TEACHER_SESSION_TYPE,
            limit=fetch_limit,
        )
        summaries: list[dict[str, Any]] = []
        for session in sessions:
            serialized = self._serialize_summary(session)
            if subject and serialized.get("subject") != subject:
                continue
            summaries.append(serialized)
            if len(summaries) >= limit:
                break
        return summaries

    def delete_session(self, session_id: str) -> bool:
        self._ensure_legacy_import()
        session = self._repo.get_session(session_id)
        if not session or session.get("session_type") != TEACHER_SESSION_TYPE:
            return False
        return self._repo.delete_session(session_id)

    def save_turn(
        self,
        session_id: str,
        user_message: str,
        assistant_message: str,
        *,
        subject: str,
        kb_name: str,
        preferred_mode: str,
        topic: str,
        teacher_state: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        self._ensure_legacy_import()
        session = self._repo.get_session(session_id)
        if not session or session.get("session_type") != TEACHER_SESSION_TYPE:
            return None

        current_settings = session.get("settings") or {}
        merged_settings = {
            **current_settings,
            "subject": subject,
            "kb_name": kb_name,
            "preferred_mode": preferred_mode,
            "topic": topic[:120],
            "teacher_state": teacher_state,
        }

        self._repo.add_message(
            session_id,
            role="user",
            content=user_message,
            metadata={"subject": subject, "preferred_mode": preferred_mode},
            touch_session=False,
        )
        self._repo.add_message(
            session_id,
            role="assistant",
            content=assistant_message,
            metadata=metadata or {},
        )
        self._repo.update_session(session_id, settings=merged_settings)
        return self.get_session(session_id)

    def _ensure_legacy_import(self) -> None:
        if self._legacy_import_complete:
            return
        self._legacy_import_complete = True
        self._import_legacy_sessions()

    def _import_legacy_sessions(self) -> None:
        if not self.legacy_sessions_file.exists():
            return
        try:
            payload = json.loads(self.legacy_sessions_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return

        for legacy_session in payload.get("sessions", []):
            session_id = str(legacy_session.get("session_id", "")).strip()
            if not session_id or self._repo.get_session(session_id):
                continue
            imported = self._import_single_session(legacy_session)
            if imported is None:
                continue

    def _import_single_session(self, legacy_session: dict[str, Any]) -> dict[str, Any] | None:
        messages = legacy_session.get("messages", [])
        title = str(legacy_session.get("title") or "New Teacher Session").strip()
        subject = str(legacy_session.get("subject") or "science").strip() or "science"
        kb_name = str(legacy_session.get("kb_name") or "").strip()
        preferred_mode = str(legacy_session.get("preferred_mode") or "explain-first").strip()
        topic = self._infer_topic(legacy_session)
        teacher_state = self._build_imported_teacher_state(
            preferred_mode=preferred_mode,
            topic=topic,
            messages=messages,
        )
        session = self.create_session(
            title=title,
            subject=subject,
            kb_name=kb_name,
            preferred_mode=preferred_mode,
            topic=topic,
            teacher_state=teacher_state,
            session_id=str(legacy_session.get("session_id")),
            created_at=legacy_session.get("created_at"),
            updated_at=legacy_session.get("updated_at"),
        )

        for index, message in enumerate(messages):
            created_at = self._offset_timestamp(message.get("timestamp"), index)
            self._repo.add_message(
                session["session_id"],
                role=str(message.get("role") or "user"),
                content=str(message.get("content") or ""),
                metadata=message.get("metadata") if isinstance(message.get("metadata"), dict) else {},
                created_at=created_at,
                touch_session=False,
            )

        raw_updated_at = legacy_session.get("updated_at")
        if raw_updated_at is not None:
            hydrated = self._repo.get_session(session["session_id"])
            if hydrated:
                settings = hydrated.get("settings") or {}
                self._repo.update_session(
                    session["session_id"],
                    settings=settings,
                )
                self._db.execute(
                    "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                    (self._to_iso(raw_updated_at), session["session_id"]),
                )
                self._db.commit()

        return self.get_session(session["session_id"])

    def _serialize_summary(self, session: dict[str, Any]) -> dict[str, Any]:
        settings = self._normalize_settings(session.get("settings"))
        messages = self._repo.get_recent_messages(session["session_id"], limit=1)
        last_message = messages[-1]["content"][:100] if messages else ""
        message_count_row = self._db.fetchone(
            "SELECT COUNT(*) AS cnt FROM session_messages WHERE session_id = ?",
            (session["session_id"],),
        )
        return {
            "session_id": session["session_id"],
            "title": session.get("title", ""),
            "subject": settings.get("subject", "science"),
            "kb_name": settings.get("kb_name", ""),
            "preferred_mode": settings.get("preferred_mode", "explain-first"),
            "message_count": int(message_count_row["cnt"]) if message_count_row else 0,
            "last_message": last_message,
            "created_at": self._to_unix(session.get("created_at")),
            "updated_at": self._to_unix(session.get("updated_at")),
        }

    def _serialize_session(self, session: dict[str, Any]) -> dict[str, Any]:
        settings = self._normalize_settings(session.get("settings"))
        messages = []
        for message in session.get("messages", []):
            messages.append(
                {
                    **message,
                    "metadata": message.get("metadata", {}) or {},
                    "created_at": self._to_unix(message.get("created_at")),
                }
            )
        return {
            "session_id": session["session_id"],
            "session_type": session.get("session_type", TEACHER_SESSION_TYPE),
            "title": session.get("title", ""),
            "subject": settings.get("subject", "science"),
            "kb_name": settings.get("kb_name", ""),
            "preferred_mode": settings.get("preferred_mode", "explain-first"),
            "topic": settings.get("topic", ""),
            "teacher_state": settings.get("teacher_state")
            or build_default_teacher_state(settings.get("preferred_mode", "explain-first")),
            "settings": settings,
            "messages": messages,
            "message_count": len(messages),
            "last_message": messages[-1]["content"][:100] if messages else "",
            "created_at": self._to_unix(session.get("created_at")),
            "updated_at": self._to_unix(session.get("updated_at")),
        }

    def _build_imported_teacher_state(
        self,
        *,
        preferred_mode: str,
        topic: str,
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        state = build_default_teacher_state(preferred_mode=preferred_mode, topic=topic)
        assistant_messages = [item for item in messages if item.get("role") == "assistant"]
        user_messages = [item for item in messages if item.get("role") == "user"]
        state["student_responses"] = [
            str(item.get("content", "")).strip()
            for item in user_messages[1:]
            if str(item.get("content", "")).strip()
        ]
        if not assistant_messages:
            return state

        metadata = assistant_messages[-1].get("metadata")
        if isinstance(metadata, dict):
            step_plan = metadata.get("step_plan") or []
            socratic_questions = metadata.get("socratic_questions") or []
            state.update(
                {
                    "teaching_mode": metadata.get("teaching_mode", state["teaching_mode"]),
                    "step_plan": list(step_plan),
                    "current_step": int(metadata.get("current_step") or (1 if step_plan else 0)),
                    "active_step_index": max(int(metadata.get("current_step") or 1) - 1, 0)
                    if step_plan
                    else 0,
                    "socratic_questions": list(socratic_questions),
                    "pending_prompt": str(socratic_questions[-1] if socratic_questions else ""),
                    "awaiting_student_response": bool(
                        socratic_questions and messages and messages[-1].get("role") == "assistant"
                    ),
                    "turn_kind": "follow_up" if len(messages) > 2 else "initial",
                    "topic": topic[:120],
                }
            )
        return state

    def _infer_topic(self, legacy_session: dict[str, Any]) -> str:
        topic = str(legacy_session.get("topic") or "").strip()
        if topic:
            return topic[:120]
        for message in legacy_session.get("messages", []):
            if message.get("role") == "user":
                return str(message.get("content") or legacy_session.get("title") or "").strip()[:120]
        return str(legacy_session.get("title") or "Teacher Session").strip()[:120]

    def _normalize_settings(self, settings: Any) -> dict[str, Any]:
        if isinstance(settings, dict):
            return settings
        if isinstance(settings, str):
            try:
                parsed = json.loads(settings)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _offset_timestamp(self, value: Any, offset_index: int) -> str:
        base = self._to_unix(value)
        return self._to_iso(base + (offset_index * 0.001))

    def _to_iso(self, value: Any) -> str:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return datetime.now(timezone.utc).isoformat()
            return text
        if isinstance(value, datetime):
            dt_value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            return dt_value.astimezone(timezone.utc).isoformat()
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        return datetime.now(timezone.utc).isoformat()

    def _to_unix(self, value: Any) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return 0.0
            try:
                return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        if isinstance(value, datetime):
            dt_value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            return dt_value.timestamp()
        return 0.0


__all__ = [
    "TEACHER_SESSION_TYPE",
    "TeacherSessionManager",
    "build_default_teacher_state",
]
