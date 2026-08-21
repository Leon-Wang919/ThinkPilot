"""
Database schema definitions and migration SQL.

All tables use TEXT primary keys (UUIDs) for portability.
Timestamps are stored as ISO-8601 TEXT via datetime('now').
"""

SCHEMA_VERSION = 1


def get_migration_sql(from_version: int = 0) -> str:
    """
    Get the SQL needed to migrate from ``from_version`` to ``SCHEMA_VERSION``.

    Args:
        from_version: Current schema version (0 = fresh database).

    Returns:
        SQL script string to execute.
    """
    statements: list[str] = []

    if from_version < 1:
        statements.append(_V1_SCHEMA)

    return "\n".join(statements)


_V1_SCHEMA = """
-- ============================================================
-- V1: Initial schema
-- ============================================================

-- ── Sessions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL DEFAULT 'default',
    session_type TEXT NOT NULL DEFAULT 'chat',
    title        TEXT NOT NULL DEFAULT 'New Session',
    settings     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_type
    ON sessions (user_id, session_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_messages (
    message_id  TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON session_messages (session_id, created_at);

-- ── Flashcards (FSRS) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS flashcards (
    card_id         TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'default',
    deck_id         TEXT NOT NULL DEFAULT 'default',
    front           TEXT NOT NULL,
    back            TEXT NOT NULL,
    tags            TEXT NOT NULL DEFAULT '[]',
    source_type     TEXT,
    source_id       TEXT,
    -- FSRS scheduling fields
    stability       REAL NOT NULL DEFAULT 0.0,
    difficulty      REAL NOT NULL DEFAULT 0.0,
    elapsed_days    INTEGER NOT NULL DEFAULT 0,
    scheduled_days  INTEGER NOT NULL DEFAULT 0,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    state           INTEGER NOT NULL DEFAULT 0,
    due             TEXT NOT NULL DEFAULT (datetime('now')),
    last_review     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flashcards_user_due
    ON flashcards (user_id, state, due);

CREATE INDEX IF NOT EXISTS idx_flashcards_deck
    ON flashcards (user_id, deck_id);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
    review_id   TEXT PRIMARY KEY,
    card_id     TEXT NOT NULL REFERENCES flashcards(card_id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL DEFAULT 'default',
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    elapsed_ms  INTEGER,
    scheduled_days  INTEGER,
    stability   REAL,
    difficulty  REAL,
    state       INTEGER,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_card
    ON flashcard_reviews (card_id, reviewed_at DESC);

-- ── Error Book ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_entries (
    entry_id        TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'default',
    question_text   TEXT NOT NULL,
    question_image  TEXT,
    correct_answer  TEXT,
    user_answer     TEXT,
    explanation     TEXT,
    subject         TEXT NOT NULL DEFAULT 'general',
    tags            TEXT NOT NULL DEFAULT '[]',
    knowledge_points TEXT NOT NULL DEFAULT '[]',
    source_type     TEXT,
    source_id       TEXT,
    mastered        INTEGER NOT NULL DEFAULT 0,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    last_retry_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_errors_user_subject
    ON error_entries (user_id, subject, mastered);

CREATE INDEX IF NOT EXISTS idx_errors_knowledge
    ON error_entries (user_id, mastered);

-- ── Memory Bank (Knowledge Proficiency) ────────────────────

CREATE TABLE IF NOT EXISTS knowledge_nodes (
    node_id     TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'default',
    parent_id   TEXT REFERENCES knowledge_nodes(node_id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT 'general',
    level       INTEGER NOT NULL DEFAULT 0,
    proficiency REAL NOT NULL DEFAULT 0.0,
    total_attempts  INTEGER NOT NULL DEFAULT 0,
    correct_attempts INTEGER NOT NULL DEFAULT 0,
    last_practiced  TEXT,
    decay_rate  REAL NOT NULL DEFAULT 0.05,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_user_subject
    ON knowledge_nodes (user_id, subject);

CREATE INDEX IF NOT EXISTS idx_knowledge_parent
    ON knowledge_nodes (parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_user_name
    ON knowledge_nodes (user_id, name, subject);

CREATE TABLE IF NOT EXISTS knowledge_events (
    event_id    TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL DEFAULT 'default',
    event_type  TEXT NOT NULL CHECK (event_type IN ('practice', 'review', 'exam', 'decay')),
    is_correct  INTEGER,
    delta       REAL NOT NULL DEFAULT 0.0,
    source_type TEXT,
    source_id   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_node
    ON knowledge_events (node_id, created_at DESC);

-- ── Mock Exams ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exams (
    exam_id         TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'default',
    title           TEXT NOT NULL,
    subject         TEXT NOT NULL DEFAULT 'general',
    strategy        TEXT NOT NULL DEFAULT 'random'
                    CHECK (strategy IN ('random', 'weak', 'error_redo')),
    total_questions INTEGER NOT NULL DEFAULT 0,
    time_limit_sec  INTEGER,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'submitted', 'graded')),
    score           REAL,
    max_score       REAL,
    started_at      TEXT,
    submitted_at    TEXT,
    graded_at       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exams_user
    ON exams (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS exam_questions (
    eq_id           TEXT PRIMARY KEY,
    exam_id         TEXT NOT NULL REFERENCES exams(exam_id) ON DELETE CASCADE,
    question_index  INTEGER NOT NULL,
    question_type   TEXT NOT NULL DEFAULT 'choice'
                    CHECK (question_type IN ('choice', 'fill', 'short_answer', 'essay')),
    question_text   TEXT NOT NULL,
    options         TEXT,
    correct_answer  TEXT,
    user_answer     TEXT,
    score           REAL,
    max_score       REAL NOT NULL DEFAULT 1.0,
    ai_feedback     TEXT,
    knowledge_points TEXT NOT NULL DEFAULT '[]',
    source_entry_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_eq_exam
    ON exam_questions (exam_id, question_index);

-- ── Classroom Transcripts ──────────────────────────────────

CREATE TABLE IF NOT EXISTS classroom_sessions (
    cs_id       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'default',
    title       TEXT NOT NULL DEFAULT 'Untitled Class',
    subject     TEXT,
    status      TEXT NOT NULL DEFAULT 'recording'
                CHECK (status IN ('recording', 'paused', 'completed')),
    summary     TEXT,
    key_terms   TEXT NOT NULL DEFAULT '[]',
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cs_user
    ON classroom_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_segments (
    segment_id  TEXT PRIMARY KEY,
    cs_id       TEXT NOT NULL REFERENCES classroom_sessions(cs_id) ON DELETE CASCADE,
    start_sec   REAL NOT NULL DEFAULT 0.0,
    end_sec     REAL,
    transcript  TEXT NOT NULL,
    summary     TEXT,
    key_terms   TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_cs
    ON classroom_segments (cs_id, start_sec);

-- ── Generated Content ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS generated_content (
    content_id      TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'default',
    content_type    TEXT NOT NULL CHECK (content_type IN ('ppt', 'video_script', 'narration')),
    title           TEXT NOT NULL,
    source_query    TEXT,
    outline         TEXT,
    full_content    TEXT,
    file_path       TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'generating', 'completed', 'failed')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gc_user_type
    ON generated_content (user_id, content_type, created_at DESC);
"""

