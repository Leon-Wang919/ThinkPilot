from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import guide as guide_router

client = TestClient(app)


class _FakeKbManager:
    def __init__(self, status="ready", rag_initialized=True, rag_provider="llamaindex"):
        self._status = status
        self._rag_initialized = rag_initialized
        self._rag_provider = rag_provider

    def list_knowledge_bases(self):
        return ["stats_kb"]

    def get_info(self, name: str):
        return {
            "name": name,
            "status": self._status,
            "progress": {"message": "indexing failed" if self._status == "error" else "Ready"},
            "statistics": {
                "status": self._status,
                "progress": {"message": "indexing failed" if self._status == "error" else "Ready"},
                "rag_initialized": self._rag_initialized,
                "rag_provider": self._rag_provider,
            },
        }


class _FakeGuideManager:
    async def create_session(self, kb_name: str, mode: str, topic: str | None = None):
        return {
            "success": True,
            "session_id": "guide1234",
            "kb_name": kb_name,
            "mode": mode,
            "topic": topic,
            "knowledge_points": [
                {
                    "knowledge_title": "Maximum Likelihood Estimation",
                    "knowledge_summary": "Estimate parameters by maximizing likelihood.",
                    "user_difficulty": "Connecting the formula to intuition.",
                }
            ],
            "total_points": 1,
        }


def test_guide_create_session_requires_kb():
    response = client.post(
        "/api/v1/guide/create_session",
        json={"kb_name": "", "mode": "topic", "topic": "MLE"},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "knowledge_base_required"


def test_guide_create_session_blocks_unready_kb(monkeypatch):
    monkeypatch.setattr(guide_router, "get_kb_manager", lambda: _FakeKbManager(status="error"))

    response = client.post(
        "/api/v1/guide/create_session",
        json={"kb_name": "stats_kb", "mode": "topic", "topic": "MLE"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "knowledge_base_unavailable"


def test_guide_create_session_topic_mode(monkeypatch):
    monkeypatch.setattr(guide_router, "get_kb_manager", lambda: _FakeKbManager())
    monkeypatch.setattr(guide_router, "get_guide_manager", lambda: _FakeGuideManager())

    response = client.post(
        "/api/v1/guide/create_session",
        json={"kb_name": "stats_kb", "mode": "topic", "topic": "MLE"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["kb_name"] == "stats_kb"
    assert payload["mode"] == "topic"
    assert payload["topic"] == "MLE"
    assert payload["knowledge_points"]


def test_guide_create_session_curriculum_mode(monkeypatch):
    monkeypatch.setattr(guide_router, "get_kb_manager", lambda: _FakeKbManager())
    monkeypatch.setattr(guide_router, "get_guide_manager", lambda: _FakeGuideManager())

    response = client.post(
        "/api/v1/guide/create_session",
        json={"kb_name": "stats_kb", "mode": "curriculum"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["mode"] == "curriculum"
    assert payload["topic"] is None
