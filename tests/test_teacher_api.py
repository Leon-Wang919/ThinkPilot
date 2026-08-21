from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import teacher as teacher_router

client = TestClient(app)


class _FakeTurnService:
    async def run_turn(
        self,
        *,
        input_text: str,
        subject: str,
        kb_name: str,
        preferred_mode: str,
        language: str,
        session_id: str | None = None,
    ):
        return {
            "success": True,
            "session_id": session_id or "teacher_session_1",
            "subject": subject,
            "kb_name": kb_name or "数理统计",
            "response": f"### Teacher Response\n\n{input_text}",
            "topic": input_text[:40],
            "teaching_mode": "solve" if preferred_mode == "solve-first" else "teach",
            "step_plan": ["Step A", "Step B"] if preferred_mode == "solve-first" else ["Core idea"],
            "socratic_questions": ["What changes if an assumption fails?"],
            "current_step": 1,
            "awaiting_student_response": True,
            "session_state": {
                "topic": input_text[:40],
                "preferred_mode": preferred_mode,
                "subject": subject,
            },
            "teacher_state": {
                "teaching_mode": "solve" if preferred_mode == "solve-first" else "teach",
                "step_plan": (
                    ["Step A", "Step B"] if preferred_mode == "solve-first" else ["Core idea"]
                ),
                "current_step": 1,
                "active_step_index": 0,
                "awaiting_student_response": True,
                "pending_prompt": "What changes if an assumption fails?",
                "socratic_questions": ["What changes if an assumption fails?"],
                "student_responses": [],
                "turn_kind": "initial",
                "mastery_signals": {},
                "topic": input_text[:40],
            },
        }


class _FakeSessions:
    def __init__(self):
        self.session = {
            "session_id": "teacher_session_1",
            "title": "Conditional probability",
            "subject": "science",
            "kb_name": "数理统计",
            "preferred_mode": "explain-first",
            "topic": "Conditional probability",
            "teacher_state": {
                "teaching_mode": "teach",
                "step_plan": ["Core idea"],
                "current_step": 1,
                "active_step_index": 0,
                "awaiting_student_response": True,
                "pending_prompt": "What changes if the condition is impossible?",
                "socratic_questions": ["What changes if the condition is impossible?"],
                "student_responses": [],
                "turn_kind": "initial",
                "mastery_signals": {},
                "topic": "Conditional probability",
            },
            "settings": {
                "subject": "science",
                "kb_name": "数理统计",
                "preferred_mode": "explain-first",
                "topic": "Conditional probability",
                "teacher_state": {},
            },
            "messages": [
                {
                    "role": "user",
                    "content": "Explain conditional probability",
                    "created_at": 1700000000.0,
                    "metadata": {},
                }
            ],
            "message_count": 1,
            "last_message": "Explain conditional probability",
            "created_at": 1700000000.0,
            "updated_at": 1700000000.0,
        }

    def get_session(self, session_id):
        if self.session and self.session["session_id"] == session_id:
            return self.session
        return None

    def list_sessions(self, subject=None, limit=20):
        if subject and self.session["subject"] != subject:
            return []
        return [self.session][:limit]

    def delete_session(self, session_id):
        if self.session and self.session["session_id"] == session_id:
            self.session = None
            return True
        return False


class _FakeKbManager:
    def get_default_for_subject(self, subject):
        return "数理统计" if subject == "science" else "算法设计"

    def list_subject_knowledge_bases(self, subject):
        return [
            {
                "name": self.get_default_for_subject(subject),
                "subject": subject,
                "is_default": True,
                "statistics": {"rag_initialized": True},
            }
        ]


def test_teacher_chat_endpoint(monkeypatch):
    monkeypatch.setattr(teacher_router, "_get_turn_service", lambda: _FakeTurnService())
    monkeypatch.setattr(teacher_router, "kb_manager", _FakeKbManager())
    monkeypatch.setattr(teacher_router, "get_ui_language", lambda default="en": "en")

    response = client.post(
        "/api/v1/teacher/chat",
        json={"subject": "science", "message": "Explain conditional probability"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "teacher_session_1"
    assert payload["teaching_mode"] == "teach"
    assert payload["awaiting_student_response"] is True


def test_teacher_solve_endpoint(monkeypatch):
    monkeypatch.setattr(teacher_router, "_get_turn_service", lambda: _FakeTurnService())
    monkeypatch.setattr(teacher_router, "kb_manager", _FakeKbManager())
    monkeypatch.setattr(teacher_router, "get_ui_language", lambda default="en": "en")

    response = client.post(
        "/api/v1/teacher/solve",
        json={"subject": "engineering", "question": "Solve a shortest path example"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["teaching_mode"] == "solve"
    assert payload["step_plan"] == ["Step A", "Step B"]


def test_teacher_knowledge_base_endpoint(monkeypatch):
    monkeypatch.setattr(teacher_router, "kb_manager", _FakeKbManager())

    response = client.get("/api/v1/teacher/knowledge-bases", params={"subject": "science"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_kb"] == "数理统计"
    assert payload["knowledge_bases"][0]["subject"] == "science"


def test_teacher_session_endpoints(monkeypatch):
    monkeypatch.setattr(teacher_router, "teacher_sessions", _FakeSessions())

    list_response = client.get("/api/v1/teacher/sessions", params={"subject": "science"})
    assert list_response.status_code == 200
    assert list_response.json()[0]["session_id"] == "teacher_session_1"

    detail_response = client.get("/api/v1/teacher/sessions/teacher_session_1")
    assert detail_response.status_code == 200
    assert detail_response.json()["topic"] == "Conditional probability"

    delete_response = client.delete("/api/v1/teacher/sessions/teacher_session_1")
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"
