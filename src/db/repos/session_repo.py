"""
SessionRepository - Chat/Guide/Solve session persistence.

Replaces the JSON-file-based SessionManager with SQLite storage.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.db.manager import DatabaseManager


class SessionRepository:
    """Repository for session and message persistence."""

    def __init__(self, db: DatabaseManager):
        self._db = db

    # Session CRUD

    def create_session(
        self,
        session_type: str = "chat",
        title: str = "New Session",
        user_id: str = "default",
        settings: dict[str, Any] | None = None,
        session_id: str | None = None,
        created_at: str | datetime | int | float | None = None,
        updated_at: str | datetime | int | float | None = None,
    ) -> dict[str, Any]:
        """
        Create a new session.

        Args:
            session_type: Type of session ('chat', 'solve', 'guide', 'research', 'feynman').
            title: Session title.
            user_id: Owner user ID.
            settings: Optional settings dict (kb_name, enable_rag, etc.).

        Returns:
            The created session dict.
        """
        session_id = session_id or f"{session_type}_{uuid.uuid4().hex[:12]}"
        created_value = self._normalize_timestamp(created_at)
        updated_value = (
            self._normalize_timestamp(updated_at)
            if updated_at is not None
            else created_value
        )
        settings_json = json.dumps(settings or {}, ensure_ascii=False)

        self._db.execute(
            """
            INSERT INTO sessions
                (session_id, user_id, session_type, title, settings, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                user_id,
                session_type,
                title[:200],
                settings_json,
                created_value,
                updated_value,
            ),
        )
        self._db.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Get a session by ID (without messages)."""
        row = self._db.fetchone("SELECT * FROM sessions WHERE session_id = ?", (session_id,))
        if row:
            row["settings"] = json.loads(row.get("settings", "{}"))
        return row

    def get_session_with_messages(self, session_id: str) -> dict[str, Any] | None:
        """Get a session with all its messages."""
        session = self.get_session(session_id)
        if not session:
            return None
        session["messages"] = self.get_messages(session_id)
        return session

    def list_sessions(
        self,
        user_id: str = "default",
        session_type: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List sessions for a user, newest first."""
        conditions = ["user_id = ?"]
        params: list[Any] = [user_id]
        if session_type:
            conditions.append("session_type = ?")
            params.append(session_type)
        where = " AND ".join(conditions)
        params.extend([limit, offset])

        rows = self._db.fetchall(
            f"""
            SELECT * FROM sessions
            WHERE {where}
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params),
        )
        for row in rows:
            row["settings"] = json.loads(row.get("settings", "{}"))
        return rows

    def update_session(
        self,
        session_id: str,
        title: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Update session title and/or settings."""
        updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if title is not None:
            updates["title"] = title[:200]
        if settings is not None:
            updates["settings"] = json.dumps(settings, ensure_ascii=False)

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [session_id]

        self._db.execute(
            f"UPDATE sessions SET {set_clause} WHERE session_id = ?",
            tuple(values),
        )
        self._db.commit()
        return self.get_session(session_id)

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its messages (CASCADE)."""
        cursor = self._db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        self._db.commit()
        return cursor.rowcount > 0

    # Message CRUD

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        message_id: str | None = None,
        created_at: str | datetime | int | float | None = None,
        touch_session: bool = True,
    ) -> dict[str, Any]:
        """
        Add a message to a session.

        Args:
            session_id: Session ID.
            role: Message role ('user', 'assistant', 'system').
            content: Message content.
            metadata: Optional metadata (citations, sources, etc.).

        Returns:
            The created message dict.
        """
        message_id = message_id or f"msg_{uuid.uuid4().hex[:12]}"
        now = self._normalize_timestamp(created_at)
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

        self._db.execute(
            """
            INSERT INTO session_messages
                (message_id, session_id, role, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (message_id, session_id, role, content, metadata_json, now),
        )

        # Update session's updated_at
        if touch_session:
            self._db.execute(
                "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                (now, session_id),
            )
        self._db.commit()

        return self._db.fetchone(
            "SELECT * FROM session_messages WHERE message_id = ?", (message_id,)
        )

    def get_messages(
        self,
        session_id: str,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Get all messages for a session, ordered chronologically."""
        rows = self._db.fetchall(
            """
            SELECT * FROM session_messages
            WHERE session_id = ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (session_id, limit),
        )
        for row in rows:
            row["metadata"] = json.loads(row.get("metadata", "{}"))
        return rows

    def get_recent_messages(
        self,
        session_id: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Get the most recent messages for a session."""
        rows = self._db.fetchall(
            """
            SELECT * FROM session_messages
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (session_id, limit),
        )
        rows.reverse()  # Return in chronological order
        for row in rows:
            row["metadata"] = json.loads(row.get("metadata", "{}"))
        return rows

    def delete_message(self, message_id: str) -> bool:
        """Delete a single message."""
        cursor = self._db.execute(
            "DELETE FROM session_messages WHERE message_id = ?", (message_id,)
        )
        self._db.commit()
        return cursor.rowcount > 0

    # Utility

    def get_session_count(self, user_id: str = "default", session_type: str | None = None) -> int:
        """Get total session count for a user."""
        if session_type:
            row = self._db.fetchone(
                "SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ? AND session_type = ?",
                (user_id, session_type),
            )
        else:
            row = self._db.fetchone(
                "SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?", (user_id,)
            )
        return row["cnt"] if row else 0

    def auto_title_from_first_message(self, session_id: str) -> str | None:
        """
        Set the session title from the first user message content.

        Returns the new title or None if no user message exists.
        """
        first_msg = self._db.fetchone(
            """
            SELECT content FROM session_messages
            WHERE session_id = ? AND role = 'user'
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (session_id,),
        )
        if not first_msg:
            return None

        content = first_msg["content"]
        title = content[:80].strip()
        if len(content) > 80:
            title += "..."

        self.update_session(session_id, title=title)
        return title

    def _normalize_timestamp(
        self,
        value: str | datetime | int | float | None = None,
    ) -> str:
        if value is None:
            return datetime.now(timezone.utc).isoformat()
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc).isoformat()
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        text = str(value).strip()
        if not text:
            return datetime.now(timezone.utc).isoformat()
        return text

