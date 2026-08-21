import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import knowledge as knowledge_router

client = TestClient(app)


class _FakeKbManager:
    def __init__(self):
        self.base_dir = Path(tempfile.mkdtemp(prefix="thinkpilot_fake_kb_"))
        self.entries = {
            "stats_kb": {
                "subject": "science",
                "statistics": {
                    "raw_documents": 2,
                    "images": 0,
                    "content_lists": 0,
                    "rag_initialized": True,
                    "status": "ready",
                    "rag_provider": "llamaindex",
                },
            },
            "algo_kb": {
                "subject": "engineering",
                "statistics": {
                    "raw_documents": 3,
                    "images": 1,
                    "content_lists": 0,
                    "rag_initialized": True,
                    "status": "ready",
                    "rag_provider": "lightrag",
                },
            },
        }
        self.defaults = {"science": "stats_kb", "engineering": "algo_kb", "liberal_arts": None}
        self.config = {"knowledge_bases": {}}

    def list_knowledge_bases(self, subject=None):
        items = sorted(self.entries.keys())
        if subject:
            return [name for name in items if self.entries[name]["subject"] == subject]
        return items

    def get_subject(self, name):
        return self.entries[name]["subject"]

    def get_default_for_subject(self, subject):
        return self.defaults.get(subject)

    def set_default_for_subject(self, subject, kb_name):
        if kb_name not in self.entries or self.entries[kb_name]["subject"] != subject:
            raise ValueError("invalid kb")
        self.defaults[subject] = kb_name

    def set_subject(self, name, subject):
        self.entries[name]["subject"] = subject
        if self.defaults.get(subject) is None:
            self.defaults[subject] = name
        for key, default_name in list(self.defaults.items()):
            if key != subject and default_name == name:
                replacement = next(
                    (
                        kb_name
                        for kb_name, entry in sorted(self.entries.items())
                        if entry["subject"] == key and kb_name != name
                    ),
                    None,
                )
                self.defaults[key] = replacement

    def get_info(self, name):
        subject = self.entries[name]["subject"]
        return {
            "name": name,
            "subject": subject,
            "is_default": self.defaults.get(subject) == name,
            "statistics": self.entries[name]["statistics"],
        }

    def update_kb_status(self, name, status, progress=None, subject=None):
        subject_name = subject or "science"
        self.entries[name] = {
            "subject": subject_name,
            "statistics": {
                "raw_documents": 0,
                "images": 0,
                "content_lists": 0,
                "rag_initialized": False,
                "status": status,
                "progress": progress,
                "rag_provider": None,
            },
        }
        self.config["knowledge_bases"][name] = {"subject": subject_name}

    def _load_config(self):
        return self.config

    def _save_config(self):
        return None


class _FakeLLMConfig:
    api_key = "test-key"
    base_url = "https://example.invalid"


class _FakeInitializer:
    created_subject = None

    def __init__(
        self,
        *,
        kb_name: str,
        base_dir: str,
        api_key: str | None = None,
        base_url: str | None = None,
        progress_tracker=None,
        rag_provider: str | None = None,
        subject: str | None = None,
    ):
        type(self).created_subject = subject
        self.kb_name = kb_name
        self.base_dir = Path(base_dir)
        self.kb_dir = self.base_dir / kb_name
        self.raw_dir = self.kb_dir / "raw"
        self.progress_tracker = progress_tracker

    def create_directory_structure(self):
        self.raw_dir.mkdir(parents=True, exist_ok=True)

    def _register_to_config(self):
        return None


async def _noop_initialization_task(initializer):
    return None


def test_knowledge_list_filters_by_subject(monkeypatch):
    manager = _FakeKbManager()
    monkeypatch.setattr(knowledge_router, "get_kb_manager", lambda: manager)

    response = client.get("/api/v1/knowledge/list", params={"subject": "engineering"})

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload] == ["algo_kb"]
    assert payload[0]["subject"] == "engineering"
    assert payload[0]["is_default"] is True


def test_knowledge_default_is_subject_scoped(monkeypatch):
    manager = _FakeKbManager()
    monkeypatch.setattr(knowledge_router, "get_kb_manager", lambda: manager)

    set_response = client.put(
        "/api/v1/knowledge/default/stats_kb",
        params={"subject": "science"},
    )
    assert set_response.status_code == 200

    engineering_response = client.get(
        "/api/v1/knowledge/default", params={"subject": "engineering"}
    )
    assert engineering_response.status_code == 200
    assert engineering_response.json()["default_kb"] == "algo_kb"


def test_knowledge_subject_update_moves_kb(monkeypatch):
    manager = _FakeKbManager()
    monkeypatch.setattr(knowledge_router, "get_kb_manager", lambda: manager)

    update_response = client.put(
        "/api/v1/knowledge/stats_kb/subject",
        json={"subject": "engineering"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["subject"] == "engineering"

    list_response = client.get("/api/v1/knowledge/list", params={"subject": "engineering"})
    names = [item["name"] for item in list_response.json()]
    assert "stats_kb" in names


def test_knowledge_create_accepts_subject(monkeypatch, tmp_path):
    manager = _FakeKbManager()
    monkeypatch.setattr(knowledge_router, "get_kb_manager", lambda: manager)
    monkeypatch.setattr(knowledge_router, "get_llm_config", lambda: _FakeLLMConfig())
    monkeypatch.setattr(knowledge_router, "KnowledgeBaseInitializer", _FakeInitializer)
    monkeypatch.setattr(knowledge_router, "run_initialization_task", _noop_initialization_task)
    monkeypatch.setattr(knowledge_router, "_kb_base_dir", tmp_path)

    response = client.post(
        "/api/v1/knowledge/create",
        data={"name": "literature_kb", "rag_provider": "llamaindex", "subject": "liberal_arts"},
        files={"files": ("notes.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["subject"] == "liberal_arts"
    assert _FakeInitializer.created_subject == "liberal_arts"
    assert manager.entries["literature_kb"]["subject"] == "liberal_arts"
