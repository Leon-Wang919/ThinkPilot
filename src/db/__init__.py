"""
SQLite Database Layer for ThinkPilot.

Provides unified persistence for the currently supported tutoring flows:
- Chat sessions and message history
- Guide session history
- Solve session history

Usage:
    from src.db import get_db, DatabaseManager

    db = get_db()  # singleton
    sessions = db.session.list_sessions(session_type="chat")
"""

from .manager import DatabaseManager, get_db

__all__ = ["DatabaseManager", "get_db"]

