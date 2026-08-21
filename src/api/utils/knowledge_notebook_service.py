"""
Knowledge base scoped notebook helpers.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from src.api.utils.notebook_manager import NotebookManager, RecordType
from src.knowledge.manager import KnowledgeBaseManager
from src.utils.document_validator import DocumentValidator


class KnowledgeNotebookService:
    """Bridge service for knowledge-base-owned notebooks."""

    SUPPORTED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}
    DEFAULT_NOTEBOOK_COLOR = "#2563EB"
    DEFAULT_NOTEBOOK_ICON = "database"

    def __init__(self, kb_manager: KnowledgeBaseManager, notebook_manager: NotebookManager):
        self.kb_manager = kb_manager
        self.notebook_manager = notebook_manager
        kb_root = getattr(kb_manager, "base_dir", None)
        self.kb_root = Path(kb_root) if kb_root else Path.cwd() / "data" / "knowledge_bases"

    def _kb_entry(self, kb_name: str) -> dict[str, Any]:
        self.kb_manager.config = self.kb_manager._load_config()
        return dict(self.kb_manager.config.get("knowledge_bases", {}).get(kb_name, {}))

    def _metadata_path(self, kb_name: str) -> Path:
        return self.kb_root / kb_name / "metadata.json"

    def _load_metadata(self, kb_name: str) -> dict[str, Any]:
        metadata_file = self._metadata_path(kb_name)
        if metadata_file.exists():
            try:
                with open(metadata_file, encoding="utf-8") as f:
                    payload = json.load(f)
                    return payload if isinstance(payload, dict) else {}
            except Exception:
                return {}
        return {}

    def _save_metadata(self, kb_name: str, metadata: dict[str, Any]):
        metadata_file = self._metadata_path(kb_name)
        kb_dir = metadata_file.parent
        if not kb_dir.exists():
            return
        with open(metadata_file, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)

    def _persist_binding(self, kb_name: str, notebook_id: str) -> bool:
        wrote_config = False
        self.kb_manager.config = self.kb_manager._load_config()
        current_entry = dict(self.kb_manager.config.get("knowledge_bases", {}).get(kb_name, {}))
        entry = dict(current_entry)
        entry["path"] = kb_name
        entry.setdefault("description", f"Knowledge base: {kb_name}")
        entry["subject"] = self.kb_manager.get_subject(kb_name)
        entry["notebook_id"] = notebook_id
        if entry != current_entry:
            self.kb_manager.config.setdefault("knowledge_bases", {})[kb_name] = entry
            self.kb_manager._save_config()
            wrote_config = True

        wrote_metadata = False
        metadata = self._load_metadata(kb_name)
        next_metadata = dict(metadata)
        next_metadata["notebook_id"] = notebook_id
        next_metadata.setdefault("name", kb_name)
        next_metadata.setdefault("description", f"Knowledge base: {kb_name}")
        if next_metadata != metadata:
            self._save_metadata(kb_name, next_metadata)
            wrote_metadata = True

        return wrote_config or wrote_metadata

    def _clear_binding(self, kb_name: str):
        self.kb_manager.config = self.kb_manager._load_config()
        entry = dict(self.kb_manager.config.get("knowledge_bases", {}).get(kb_name, {}))
        if entry.pop("notebook_id", None) is not None:
            self.kb_manager.config.setdefault("knowledge_bases", {})[kb_name] = entry
            self.kb_manager._save_config()

        metadata = self._load_metadata(kb_name)
        if "notebook_id" in metadata:
            metadata.pop("notebook_id", None)
            self._save_metadata(kb_name, metadata)

    def _default_notebook_name(self, kb_name: str) -> str:
        return kb_name

    def _default_notebook_description(self, kb_name: str) -> str:
        return f"Notebook for knowledge base: {kb_name}"

    def _build_content_hash(
        self,
        *,
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
    ) -> str:
        payload = json.dumps(
            {
                "record_type": self.notebook_manager._normalize_record_type(record_type),
                "title": title,
                "user_query": user_query,
                "output": output,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    def _build_conversation_source_key(
        self,
        *,
        module: str,
        session_id: str,
        message_count: int,
        content_hash: str | None = None,
    ) -> str:
        base = f"{module}:{session_id}:{message_count}"
        return f"{base}:{content_hash}" if content_hash else base

    def _conversation_record_matches(
        self,
        record: dict[str, Any] | None,
        *,
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
    ) -> bool:
        if not isinstance(record, dict):
            return False
        resolved_title = self.notebook_manager._distill_title(title, user_query)  # noqa: SLF001
        return (
            self.notebook_manager._normalize_record_type(record.get("type"))  # noqa: SLF001
            == self.notebook_manager._normalize_record_type(record_type)  # noqa: SLF001
            and str(record.get("title") or "") == resolved_title
            and str(record.get("user_query") or "") == user_query
            and str(record.get("output") or "") == output
        )

    def _needs_binding_update(self, notebook: dict[str, Any], kb_name: str) -> bool:
        desired_binding = {"kind": "knowledge_base", "kb_name": kb_name}
        if notebook.get("binding") != desired_binding:
            return True
        if not bool(notebook.get("managed")):
            return True
        if notebook.get("name") != self._default_notebook_name(kb_name):
            return True
        if not notebook.get("description"):
            return True
        if not notebook.get("icon"):
            return True
        return False

    def ensure_notebook(self, kb_name: str) -> dict[str, Any]:
        if kb_name not in self.kb_manager.list_knowledge_bases():
            raise ValueError(f"Knowledge base '{kb_name}' not found")

        kb_entry = self._kb_entry(kb_name)
        metadata = self._load_metadata(kb_name)
        notebook_id = str(kb_entry.get("notebook_id") or metadata.get("notebook_id") or "").strip()
        notebook = self.notebook_manager.get_notebook(notebook_id) if notebook_id else None

        if notebook is None:
            notebook = self.notebook_manager.find_notebook_by_binding(
                "knowledge_base",
                kb_name=kb_name,
            )

        if notebook is None:
            notebook = self.notebook_manager.create_notebook(
                name=self._default_notebook_name(kb_name),
                description=self._default_notebook_description(kb_name),
                color=self.DEFAULT_NOTEBOOK_COLOR,
                icon=self.DEFAULT_NOTEBOOK_ICON,
                binding={"kind": "knowledge_base", "kb_name": kb_name},
                managed=True,
            )
        elif self._needs_binding_update(notebook, kb_name):
            notebook = self.notebook_manager.set_binding(
                notebook["id"],
                {"kind": "knowledge_base", "kb_name": kb_name},
                managed=True,
                name=self._default_notebook_name(kb_name),
                description=notebook.get("description")
                or self._default_notebook_description(kb_name),
                icon=notebook.get("icon") or self.DEFAULT_NOTEBOOK_ICON,
            ) or notebook

        self._persist_binding(kb_name, notebook["id"])
        summary = self.notebook_manager.get_notebook_summary(notebook["id"])
        if summary is None:
            raise ValueError(f"Failed to load notebook for knowledge base '{kb_name}'")
        return summary

    def get_notebook(self, kb_name: str) -> dict[str, Any]:
        summary = self.ensure_notebook(kb_name)
        notebook = self.notebook_manager.get_notebook(summary["id"])
        if notebook is None:
            raise ValueError(f"Notebook not found for knowledge base '{kb_name}'")
        return notebook

    def attach_notebook_summary(self, kb_info: dict[str, Any]) -> dict[str, Any]:
        payload = dict(kb_info)
        payload["notebook"] = self.ensure_notebook(payload["name"])
        return payload

    def save_conversation_record(
        self,
        kb_name: str,
        *,
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
        module: str,
        session_id: str,
        message_count: int,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        summary = self.ensure_notebook(kb_name)
        content_hash = self._build_content_hash(
            record_type=record_type,
            title=title,
            user_query=user_query,
            output=output,
        )
        source_key = self._build_conversation_source_key(
            module=module,
            session_id=session_id,
            message_count=message_count,
            content_hash=content_hash,
        )
        legacy_source_key = self._build_conversation_source_key(
            module=module,
            session_id=session_id,
            message_count=message_count,
        )
        merged_metadata = deepcopy(metadata or {})
        source_payload = dict(merged_metadata.get("source") or {})
        source_payload.update(
            {
                "module": module,
                "session_id": session_id,
                "message_count": message_count,
                "content_hash": content_hash,
                "source_key": source_key,
                "saved_at": time.time(),
            }
        )
        merged_metadata["source"] = source_payload

        existing = self.notebook_manager.find_record_by_source_key(summary["id"], source_key)
        if existing:
            return {
                "notebook": summary,
                "record": existing,
                "created": False,
            }

        if legacy_source_key != source_key:
            legacy = self.notebook_manager.find_record_by_source_key(summary["id"], legacy_source_key)
            if self._conversation_record_matches(
                legacy,
                record_type=record_type,
                title=title,
                user_query=user_query,
                output=output,
            ):
                return {
                    "notebook": summary,
                    "record": legacy,
                    "created": False,
                }

        record = self.notebook_manager.add_record_to_notebook(
            notebook_id=summary["id"],
            record_type=record_type,
            title=title,
            user_query=user_query,
            output=output,
            metadata=merged_metadata,
            kb_name=kb_name,
        )
        if record is None:
            raise ValueError(f"Notebook not found for knowledge base '{kb_name}'")
        refreshed_summary = self.notebook_manager.get_notebook_summary(summary["id"]) or summary
        return {
            "notebook": refreshed_summary,
            "record": record,
            "created": True,
        }

    def delete_bound_notebook(self, kb_name: str):
        notebook_id = self.get_bound_notebook_id(kb_name)
        if notebook_id:
            self.notebook_manager.delete_notebook(notebook_id, force=True)
        self._clear_binding(kb_name)

    def get_bound_notebook_id(self, kb_name: str) -> str | None:
        kb_entry = self._kb_entry(kb_name)
        metadata = self._load_metadata(kb_name)
        notebook_id = str(kb_entry.get("notebook_id") or metadata.get("notebook_id") or "").strip()
        return notebook_id or None

    def _extract_text(self, file_path: Path) -> tuple[str, str, str | None]:
        suffix = file_path.suffix.lower()
        try:
            if suffix == ".pdf":
                try:
                    import fitz  # PyMuPDF
                except ImportError as exc:
                    return "", "error", f"PyMuPDF not installed: {exc}"
                doc = fitz.open(file_path)
                texts = []
                for page in doc:
                    texts.append(page.get_text())
                doc.close()
                content = "\n\n".join(texts).strip()
                return content, "success" if content else "empty", None

            if suffix == ".docx":
                try:
                    from docx import Document
                except ImportError as exc:
                    return "", "error", f"python-docx not installed: {exc}"
                document = Document(str(file_path))
                content = "\n".join(
                    paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()
                ).strip()
                return content, "success" if content else "empty", None

            for encoding in ("utf-8", "utf-8-sig", "latin-1"):
                try:
                    with open(file_path, encoding=encoding) as f:
                        content = f.read().strip()
                    return content, "success" if content else "empty", None
                except UnicodeDecodeError:
                    continue
            return "", "error", "Could not decode file content"
        except Exception as exc:
            return "", "error", str(exc)

    def upload_files(self, kb_name: str, files: list[UploadFile]) -> dict[str, Any]:
        summary = self.ensure_notebook(kb_name)
        notebook_id = summary["id"]
        results: list[dict[str, Any]] = []

        for file in files:
            record_id = self.notebook_manager.generate_record_id()
            record_dir = self.notebook_manager._get_upload_dir(notebook_id, record_id)
            record_dir.mkdir(parents=True, exist_ok=True)
            raw_name = file.filename or "untitled"
            safe_name = raw_name

            try:
                safe_name = DocumentValidator.validate_upload_safety(
                    raw_name,
                    None,
                    allowed_extensions=self.SUPPORTED_UPLOAD_EXTENSIONS,
                )
                target_file = record_dir / safe_name

                written_bytes = 0
                with open(target_file, "wb") as output_file:
                    while True:
                        chunk = file.file.read(8192)
                        if not chunk:
                            break
                        written_bytes += len(chunk)
                        if written_bytes > DocumentValidator.MAX_FILE_SIZE:
                            raise ValueError(
                                f"File too large: {raw_name}. Maximum allowed: {DocumentValidator.MAX_FILE_SIZE} bytes"
                            )
                        output_file.write(chunk)

                DocumentValidator.validate_upload_safety(
                    safe_name,
                    written_bytes,
                    allowed_extensions=self.SUPPORTED_UPLOAD_EXTENSIONS,
                )

                extracted_text, extract_status, extract_error = self._extract_text(target_file)
                item_status = "partial" if extract_status == "error" else "success"
                relative_path = target_file.relative_to(self.notebook_manager.user_root).as_posix()
                attachment = {
                    "filename": safe_name,
                    "original_filename": raw_name,
                    "mime_type": file.content_type
                    or mimetypes.guess_type(safe_name)[0]
                    or "application/octet-stream",
                    "size_bytes": written_bytes,
                    "relative_path": relative_path,
                    "url": f"/api/outputs/{relative_path}",
                    "extract_status": extract_status,
                }
                if extract_error:
                    attachment["extract_error"] = extract_error

                metadata = {
                    "source": {
                        "module": "upload",
                        "session_id": None,
                        "source_key": f"upload:{kb_name}:{record_id}",
                        "saved_at": time.time(),
                    },
                    "attachment": attachment,
                }
                record = self.notebook_manager.add_record_to_notebook(
                    notebook_id=notebook_id,
                    record_type=RecordType.UPLOAD,
                    title=safe_name,
                    user_query="",
                    output=extracted_text,
                    metadata=metadata,
                    kb_name=kb_name,
                    record_id=record_id,
                )
                if record is None:
                    raise ValueError("Failed to save notebook record")

                results.append(
                    {
                        "success": item_status != "failure",
                        "status": item_status,
                        "filename": safe_name,
                        "record": record,
                    }
                )
            except Exception as exc:
                shutil.rmtree(record_dir, ignore_errors=True)
                results.append(
                    {
                        "success": False,
                        "status": "failure",
                        "filename": safe_name,
                        "error": str(exc),
                    }
                )

        success_count = sum(1 for item in results if item["status"] == "success")
        partial_count = sum(1 for item in results if item["status"] == "partial")
        failure_count = sum(1 for item in results if item["status"] == "failure")
        refreshed_summary = self.notebook_manager.get_notebook_summary(notebook_id) or summary
        return {
            "notebook": refreshed_summary,
            "results": results,
            "success_count": success_count,
            "partial_count": partial_count,
            "failure_count": failure_count,
        }
