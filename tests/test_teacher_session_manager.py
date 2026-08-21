import json

from src.agents.teacher.session_manager import (
    TeacherSessionManager,
    build_default_teacher_state,
)
from src.db.manager import DatabaseManager


def test_teacher_session_manager_round_trip(tmp_path):
    db = DatabaseManager(str(tmp_path / "teacher.db"))
    legacy_dir = tmp_path / "legacy"
    legacy_dir.mkdir()
    manager = TeacherSessionManager(db=db, legacy_base_dir=str(legacy_dir))

    session = manager.create_session(
        title="Conditional probability",
        subject="science",
        kb_name="数理统计",
        preferred_mode="explain-first",
    )
    teacher_state = build_default_teacher_state("explain-first", "Conditional probability")
    teacher_state.update(
        {
            "current_step": 1,
            "awaiting_student_response": True,
            "pending_prompt": "What changes if the condition is impossible?",
            "socratic_questions": ["What changes if the condition is impossible?"],
        }
    )
    manager.save_turn(
        session["session_id"],
        user_message="Explain conditional probability",
        assistant_message="Here is the first explanation.",
        subject="science",
        kb_name="数理统计",
        preferred_mode="explain-first",
        topic="Conditional probability",
        teacher_state=teacher_state,
        metadata={
            "teaching_mode": "teach",
            "step_plan": [],
            "current_step": 1,
            "awaiting_student_response": True,
            "socratic_questions": ["What changes if the condition is impossible?"],
        },
    )

    summaries = manager.list_sessions(subject="science", limit=10)
    detail = manager.get_session(session["session_id"])

    assert summaries[0]["message_count"] == 2
    assert summaries[0]["kb_name"] == "数理统计"
    assert detail is not None
    assert detail["teacher_state"]["awaiting_student_response"] is True
    assert detail["messages"][-1]["content"] == "Here is the first explanation."
    assert manager.delete_session(session["session_id"]) is True

    db.close()


def test_teacher_session_manager_imports_legacy_json_idempotently(tmp_path):
    db = DatabaseManager(str(tmp_path / "teacher_import.db"))
    legacy_dir = tmp_path / "legacy"
    legacy_dir.mkdir()
    payload = {
        "version": "1.0",
        "sessions": [
            {
                "session_id": "teacher_legacy_1",
                "title": "Legacy teacher session",
                "subject": "science",
                "kb_name": "数理统计",
                "preferred_mode": "solve-first",
                "created_at": 1700000000,
                "updated_at": 1700000005,
                "messages": [
                    {"role": "user", "content": "Solve Bayes rule", "timestamp": 1700000001},
                    {
                        "role": "assistant",
                        "content": "Let's start with the events.",
                        "timestamp": 1700000002,
                        "metadata": {
                            "teaching_mode": "solve",
                            "step_plan": ["Define the events", "Apply Bayes' rule"],
                            "current_step": 1,
                            "socratic_questions": ["Which event is observed?"],
                        },
                    },
                ],
            }
        ],
    }
    (legacy_dir / "teacher_sessions.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )

    manager = TeacherSessionManager(db=db, legacy_base_dir=str(legacy_dir))
    first = manager.list_sessions(limit=10)
    second = manager.list_sessions(limit=10)
    detail = manager.get_session("teacher_legacy_1")

    assert len(first) == 1
    assert len(second) == 1
    assert detail is not None
    assert detail["message_count"] == 2
    assert detail["teacher_state"]["awaiting_student_response"] is True
    assert detail["messages"][0]["content"] == "Solve Bayes rule"

    db.close()
