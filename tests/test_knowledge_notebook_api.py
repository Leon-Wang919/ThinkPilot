from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import knowledge as knowledge_router
from src.api.routers import notebook as notebook_router
from src.api.utils.knowledge_notebook_service import KnowledgeNotebookService
from src.api.utils.notebook_manager import NotebookManager
from src.knowledge.manager import KnowledgeBaseManager

client = TestClient(app)

try:
    import fitz
except ImportError:
    fitz = None

try:
    import docx
except ImportError:
    docx = None


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
        del api_key, base_url, progress_tracker, rag_provider
        type(self).created_subject = subject
        self.kb_name = kb_name
        self.base_dir = Path(base_dir)
        self.kb_dir = self.base_dir / kb_name
        self.raw_dir = self.kb_dir / "raw"

    def create_directory_structure(self):
        self.raw_dir.mkdir(parents=True, exist_ok=True)

    def _register_to_config(self):
        return None


async def _noop_initialization_task(initializer):
    del initializer
    return None


def _wire_test_services(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    kb_root = tmp_path / "knowledge_bases"
    kb_root.mkdir(parents=True, exist_ok=True)
    user_root = tmp_path / "user"
    notebook_root = user_root / "notebook"

    kb_manager = KnowledgeBaseManager(base_dir=str(kb_root))
    notebook_manager = NotebookManager(base_dir=str(notebook_root), user_root=str(user_root))
    kb_notebooks = KnowledgeNotebookService(kb_manager, notebook_manager)

    monkeypatch.setattr(knowledge_router, "_kb_base_dir", kb_root)
    monkeypatch.setattr(knowledge_router, "get_kb_manager", lambda: kb_manager)
    monkeypatch.setattr(knowledge_router, "notebook_manager", notebook_manager)
    monkeypatch.setattr(
        knowledge_router,
        "get_knowledge_notebook_service",
        lambda: kb_notebooks,
    )
    monkeypatch.setattr(notebook_router, "notebook_manager", notebook_manager)

    return kb_root, user_root, kb_manager, notebook_manager, kb_notebooks


def _register_ready_kb(kb_root: Path, kb_manager: KnowledgeBaseManager, name: str, subject: str):
    kb_dir = kb_root / name
    (kb_dir / "raw").mkdir(parents=True, exist_ok=True)
    metadata = {
        "name": name,
        "description": f"Knowledge base: {name}",
        "subject": subject,
    }
    (kb_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    kb_manager.update_kb_status(
        name=name,
        status="ready",
        subject=subject,
        progress={
            "stage": "completed",
            "message": "Ready",
            "percent": 100,
            "current": 1,
            "total": 1,
        },
    )


def test_existing_knowledge_base_gets_one_dedicated_notebook(monkeypatch, tmp_path):
    kb_root, user_root, kb_manager, _, _ = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    first = client.get("/api/v1/knowledge/list")
    second = client.get("/api/v1/knowledge/list")
    detail = client.get("/api/v1/knowledge/stats_kb")

    assert first.status_code == 200
    assert second.status_code == 200
    assert detail.status_code == 200

    first_notebook_id = first.json()[0]["notebook"]["id"]
    second_notebook_id = second.json()[0]["notebook"]["id"]
    detail_notebook_id = detail.json()["notebook"]["id"]

    assert first_notebook_id == second_notebook_id == detail_notebook_id

    index_payload = json.loads((user_root / "notebook" / "notebooks_index.json").read_text())
    assert len(index_payload["notebooks"]) == 1

    metadata = json.loads((kb_root / "stats_kb" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["notebook_id"] == first_notebook_id


def test_kb_list_does_not_rewrite_binding_when_unchanged(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, kb_notebooks = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    first = client.get("/api/v1/knowledge/list")
    assert first.status_code == 200

    config_saves = 0
    metadata_saves = 0
    original_save_config = kb_manager._save_config
    original_save_metadata = kb_notebooks._save_metadata

    def tracked_save_config():
        nonlocal config_saves
        config_saves += 1
        return original_save_config()

    def tracked_save_metadata(kb_name: str, metadata: dict):
        nonlocal metadata_saves
        metadata_saves += 1
        return original_save_metadata(kb_name, metadata)

    monkeypatch.setattr(kb_manager, "_save_config", tracked_save_config)
    monkeypatch.setattr(kb_notebooks, "_save_metadata", tracked_save_metadata)

    second = client.get("/api/v1/knowledge/list")

    assert second.status_code == 200
    assert config_saves == 0
    assert metadata_saves == 0


def test_create_knowledge_base_returns_dedicated_notebook(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, _ = _wire_test_services(monkeypatch, tmp_path)
    monkeypatch.setattr(knowledge_router, "get_llm_config", lambda: _FakeLLMConfig())
    monkeypatch.setattr(knowledge_router, "KnowledgeBaseInitializer", _FakeInitializer)
    monkeypatch.setattr(knowledge_router, "run_initialization_task", _noop_initialization_task)

    response = client.post(
        "/api/v1/knowledge/create",
        data={"name": "literature_kb", "rag_provider": "llamaindex", "subject": "liberal_arts"},
        files={"files": ("notes.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["subject"] == "liberal_arts"
    assert payload["notebook"]["id"]

    config_payload = kb_manager._load_config()
    assert (
        config_payload["knowledge_bases"]["literature_kb"]["notebook_id"]
        == payload["notebook"]["id"]
    )

    metadata = json.loads((kb_root / "literature_kb" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["notebook_id"] == payload["notebook"]["id"]


def test_kb_scoped_conversation_save_is_idempotent(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, kb_notebooks = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    payload = {
        "record_type": "chat",
        "title": "Chat: likelihood",
        "user_query": "What is likelihood?",
        "output": "Likelihood measures fit.",
        "module": "chat",
        "session_id": "chat_123",
        "message_count": 2,
        "metadata": {"enable_rag": True},
    }

    first = client.post("/api/v1/knowledge/stats_kb/notebook/records", json=payload)
    second = client.post("/api/v1/knowledge/stats_kb/notebook/records", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["created"] is True
    assert second.json()["created"] is False

    notebook = kb_notebooks.get_notebook("stats_kb")
    assert len(notebook["records"]) == 1
    source = notebook["records"][0]["metadata"]["source"]
    assert source["source_key"].startswith("chat:chat_123:2:")
    assert source["module"] == "chat"
    assert source["message_count"] == 2
    assert source["content_hash"]


def test_kb_scoped_conversation_save_creates_new_record_when_content_changes(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, kb_notebooks = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    base_payload = {
        "record_type": "chat",
        "title": "Chat: likelihood",
        "user_query": "What is likelihood?",
        "output": "Likelihood measures fit.",
        "module": "chat",
        "session_id": "chat_123",
        "message_count": 2,
        "metadata": {"enable_rag": True},
    }

    first = client.post("/api/v1/knowledge/stats_kb/notebook/records", json=base_payload)
    second = client.post(
        "/api/v1/knowledge/stats_kb/notebook/records",
        json={**base_payload, "output": "Likelihood scores model fit differently."},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["created"] is True
    assert second.json()["created"] is True

    notebook = kb_notebooks.get_notebook("stats_kb")
    assert len(notebook["records"]) == 2


def test_kb_scoped_conversation_save_reuses_legacy_source_key_when_content_matches(
    monkeypatch,
    tmp_path,
):
    kb_root, _, kb_manager, notebook_manager, kb_notebooks = _wire_test_services(
        monkeypatch, tmp_path
    )
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    notebook = kb_notebooks.ensure_notebook("stats_kb")
    notebook_manager.add_record_to_notebook(
        notebook_id=notebook["id"],
        record_type="chat",
        title="Chat: likelihood",
        user_query="What is likelihood?",
        output="Likelihood measures fit.",
        metadata={
            "source": {
                "module": "chat",
                "session_id": "chat_legacy",
                "source_key": "chat:chat_legacy:2",
            }
        },
        kb_name="stats_kb",
    )

    payload = {
        "record_type": "chat",
        "title": "Chat: likelihood",
        "user_query": "What is likelihood?",
        "output": "Likelihood measures fit.",
        "module": "chat",
        "session_id": "chat_legacy",
        "message_count": 2,
        "metadata": {"enable_rag": True},
    }

    response = client.post("/api/v1/knowledge/stats_kb/notebook/records", json=payload)

    assert response.status_code == 200
    assert response.json()["created"] is False
    notebook_after = kb_notebooks.get_notebook("stats_kb")
    assert len(notebook_after["records"]) == 1


def _build_pdf_bytes(text: str) -> bytes:
    if fitz is None:
        pytest.skip("PyMuPDF is not installed")
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def _build_docx_bytes(text: str) -> bytes:
    if docx is None:
        pytest.skip("python-docx is not installed")
    document = docx.Document()
    document.add_paragraph(text)
    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("filename", "content_factory", "content_type", "expected_snippet"),
    [
        ("note.txt", lambda: b"text notebook content", "text/plain", "text notebook content"),
        ("note.md", lambda: b"# Heading\n\nmarkdown body", "text/markdown", "markdown body"),
        (
            "note.docx",
            lambda: _build_docx_bytes("docx notebook content"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx notebook content",
        ),
        (
            "note.pdf",
            lambda: _build_pdf_bytes("pdf notebook content"),
            "application/pdf",
            "pdf notebook content",
        ),
    ],
)
def test_kb_notebook_uploads_create_records(
    monkeypatch,
    tmp_path,
    filename,
    content_factory,
    content_type,
    expected_snippet,
):
    kb_root, user_root, kb_manager, _, kb_notebooks = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")
    content = content_factory()

    response = client.post(
        "/api/v1/knowledge/stats_kb/notebook/upload",
        files={"files": (filename, content, content_type)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success_count"] == 1
    assert payload["partial_count"] == 0
    assert payload["failure_count"] == 0
    assert payload["results"][0]["status"] == "success"

    notebook = kb_notebooks.get_notebook("stats_kb")
    assert len(notebook["records"]) == 1
    record = notebook["records"][0]
    assert record["type"] == "upload"
    assert expected_snippet in record["output"]
    relative_path = record["metadata"]["attachment"]["relative_path"]
    assert (user_root / relative_path).exists()


def test_kb_notebook_uploads_report_partial_when_extraction_fails(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, kb_notebooks = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    def fake_extract_text(file_path: Path):
        if file_path.suffix.lower() == ".pdf":
            return "", "error", "missing parser"
        return "plain note", "success", None

    monkeypatch.setattr(kb_notebooks, "_extract_text", fake_extract_text)

    response = client.post(
        "/api/v1/knowledge/stats_kb/notebook/upload",
        files=[
            ("files", ("note.txt", b"plain note", "text/plain")),
            ("files", ("scan.pdf", b"%PDF-1.4 partial", "application/pdf")),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success_count"] == 1
    assert payload["partial_count"] == 1
    assert payload["failure_count"] == 0
    assert [item["status"] for item in payload["results"]] == ["success", "partial"]

    notebook = kb_notebooks.get_notebook("stats_kb")
    assert len(notebook["records"]) == 2
    partial_record = next(
        record
        for record in notebook["records"]
        if record["metadata"]["attachment"]["original_filename"] == "scan.pdf"
    )
    assert partial_record["metadata"]["attachment"]["extract_status"] == "error"
    assert partial_record["output"] == ""


def test_kb_notebook_upload_rejects_unsupported_type(monkeypatch, tmp_path):
    kb_root, _, kb_manager, _, _ = _wire_test_services(monkeypatch, tmp_path)
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    response = client.post(
        "/api/v1/knowledge/stats_kb/notebook/upload",
        files={"files": ("note.csv", b"a,b,c", "text/csv")},
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "results" in detail
    assert "Unsupported file type" in detail["results"][0]["error"]


def test_managed_notebook_delete_is_blocked_but_legacy_is_allowed(monkeypatch, tmp_path):
    kb_root, _, kb_manager, notebook_manager, kb_notebooks = _wire_test_services(
        monkeypatch, tmp_path
    )
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    managed_summary = kb_notebooks.ensure_notebook("stats_kb")
    managed_delete = client.delete(f"/api/v1/notebook/{managed_summary['id']}")
    assert managed_delete.status_code == 409

    legacy = notebook_manager.create_notebook("legacy-notebook")
    legacy_delete = client.delete(f"/api/v1/notebook/{legacy['id']}")
    assert legacy_delete.status_code == 200


def test_delete_knowledge_base_cascades_notebook_and_uploads(monkeypatch, tmp_path):
    kb_root, _, kb_manager, notebook_manager, kb_notebooks = _wire_test_services(
        monkeypatch, tmp_path
    )
    _register_ready_kb(kb_root, kb_manager, "stats_kb", "science")

    notebook = kb_notebooks.ensure_notebook("stats_kb")
    record_id = "upload001"
    upload_dir = notebook_manager._get_upload_dir(notebook["id"], record_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_file = upload_dir / "note.txt"
    upload_file.write_text("attached upload", encoding="utf-8")
    relative_path = upload_file.relative_to(notebook_manager.user_root).as_posix()

    notebook_manager.add_record_to_notebook(
        notebook_id=notebook["id"],
        record_type="upload",
        title="note.txt",
        user_query="",
        output="attached upload",
        metadata={"attachment": {"relative_path": relative_path}},
        kb_name="stats_kb",
        record_id=record_id,
    )

    response = client.delete("/api/v1/knowledge/stats_kb")

    assert response.status_code == 200
    assert not (kb_root / "stats_kb").exists()
    assert notebook_manager.get_notebook(notebook["id"]) is None
    assert not notebook_manager._get_upload_dir(notebook["id"]).exists()
