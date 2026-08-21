# -*- coding: utf-8 -*-
"""
DatabaseManager - SQLite connection and schema management.

Handles:
- Connection pooling (thread-safe singleton)
- Schema creation and migration
- Transaction helpers
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

from src.db.schema import SCHEMA_VERSION, get_migration_sql

_lock = threading.Lock()
_instance: DatabaseManager | None = None


def get_db(db_path: str | None = None) -> DatabaseManager:
    """
    Get the singleton DatabaseManager instance.

    Args:
        db_path: Optional path to the SQLite database file.
                 Defaults to ``data/thinkpilot.db`` relative to project root.

    Returns:
        The shared DatabaseManager instance.
    """
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                _instance = DatabaseManager(db_path=db_path)
    return _instance


class DatabaseManager:
    """
    Central SQLite database manager.

    Thread-safe: each thread gets its own connection via ``threading.local()``.
    All tables are created on first access.
    """

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            project_root = Path(__file__).resolve().parents[2]
            db_dir = project_root / "data"
            db_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(db_dir / "thinkpilot.db")

        self._db_path = db_path
        self._local = threading.local()

        # Ensure schema is up-to-date on first init
        self._init_schema()

        # Lazy-loaded repository instances
        self._session_repo: Any = None

    @property
    def connection(self) -> sqlite3.Connection:
        """Get a thread-local database connection."""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            self._local.conn = conn
        return conn

    def execute(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> sqlite3.Cursor:
        """Execute a single SQL statement."""
        return self.connection.execute(sql, params)

    def executemany(self, sql: str, params_seq: list[tuple[Any, ...]]) -> sqlite3.Cursor:
        """Execute a SQL statement against all parameter sequences."""
        return self.connection.executemany(sql, params_seq)

    def fetchone(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> dict[str, Any] | None:
        """Execute and fetch one row as a dict."""
        cursor = self.execute(sql, params)
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def fetchall(self, sql: str, params: tuple[Any, ...] | dict[str, Any] = ()) -> list[dict[str, Any]]:
        """Execute and fetch all rows as dicts."""
        cursor = self.execute(sql, params)
        return [dict(r) for r in cursor.fetchall()]

    def commit(self):
        """Commit the current transaction."""
        self.connection.commit()

    def rollback(self):
        """Rollback the current transaction."""
        self.connection.rollback()

    def close(self):
        """Close the thread-local connection."""
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    def _init_schema(self):
        """Create or migrate the database schema."""
        conn = self.connection
        # Check current schema version
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            "  id INTEGER PRIMARY KEY CHECK (id = 1),"
            "  version INTEGER NOT NULL,"
            "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
            ")"
        )
        row = conn.execute("SELECT version FROM schema_version WHERE id = 1").fetchone()
        current_version = row["version"] if row else 0

        if current_version < SCHEMA_VERSION:
            migration_sql = get_migration_sql(from_version=current_version)
            conn.executescript(migration_sql)
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (id, version, updated_at) "
                "VALUES (1, ?, datetime('now'))",
                (SCHEMA_VERSION,),
            )
            conn.commit()

    # Repository Properties

    @property
    def session(self):
        """Session repository for chat/guide/solve session history."""
        if self._session_repo is None:
            from src.db.repos.session_repo import SessionRepository
            self._session_repo = SessionRepository(self)
        return self._session_repo
