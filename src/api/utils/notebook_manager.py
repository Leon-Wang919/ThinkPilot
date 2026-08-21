"""
Notebook Manager - Manages user notebooks and records.

Notebook data lives under ``data/user/notebook`` and uploaded notebook files
live under ``data/user/notebook_uploads``.
"""

from __future__ import annotations

from copy import deepcopy
from enum import Enum
import json
from pathlib import Path
import re
import shutil
import time
from typing import Any
import uuid

from pydantic import BaseModel


class RecordType(str, Enum):
    """Supported notebook record types."""

    SOLVE = "solve"
    QUESTION = "question"
    RESEARCH = "research"
    CO_WRITER = "co_writer"
    CHAT = "chat"
    UPLOAD = "upload"


class NotebookBinding(BaseModel):
    """Notebook ownership marker."""

    kind: str = "legacy"
    kb_name: str | None = None


class NotebookRecord(BaseModel):
    """Single record in notebook."""

    id: str
    type: RecordType
    title: str
    user_query: str
    output: str
    metadata: dict[str, Any] = {}
    created_at: float
    kb_name: str | None = None


class Notebook(BaseModel):
    """Notebook model."""

    id: str
    name: str
    description: str = ""
    created_at: float
    updated_at: float
    records: list[NotebookRecord] = []
    color: str = "#3B82F6"
    icon: str = "book"
    pinned: bool = False
    binding: NotebookBinding = NotebookBinding()
    managed: bool = False


class NotebookManager:
    """Notebook manager with knowledge-base-aware notebooks."""

    MAX_VERSION_HISTORY = 30

    def __init__(self, base_dir: str | None = None, user_root: str | None = None):
        if base_dir is None:
            project_root = Path(__file__).resolve().parents[3]
            self.user_root = project_root / "data" / "user"
            self.base_dir = self.user_root / "notebook"
        else:
            self.base_dir = Path(base_dir)
            self.user_root = Path(user_root) if user_root else self.base_dir.parent

        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_root = self.user_root / "notebook_uploads"
        self.uploads_root.mkdir(parents=True, exist_ok=True)

        self.index_file = self.base_dir / "notebooks_index.json"
        self._ensure_index()

    def _ensure_index(self):
        if not self.index_file.exists():
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump({"notebooks": []}, f, indent=2, ensure_ascii=False)

    def _normalize_binding(self, binding: dict[str, Any] | None) -> dict[str, Any]:
        payload = dict(binding or {})
        kind = str(payload.get("kind") or "legacy").strip() or "legacy"
        normalized = {"kind": kind}
        if kind == "knowledge_base":
            kb_name = str(payload.get("kb_name") or "").strip()
            normalized["kb_name"] = kb_name or None
        return normalized

    def _normalize_record_type(self, record_type: RecordType | str | Any) -> str:
        if isinstance(record_type, RecordType):
            return record_type.value

        normalized = str(record_type or "").strip()
        if normalized.startswith("RecordType."):
            normalized = normalized.split(".", 1)[1].lower()
        return normalized

    def _normalize_record(self, record: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        payload = dict(record)
        changed = False
        normalized_type = self._normalize_record_type(payload.get("type"))
        if payload.get("type") != normalized_type:
            payload["type"] = normalized_type
            changed = True
        if not isinstance(payload.get("metadata"), dict):
            payload["metadata"] = {}
            changed = True
        return payload, changed

    def _normalize_notebook_payload(self, notebook: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        payload = dict(notebook)
        changed = False

        if "description" not in payload:
            payload["description"] = ""
            changed = True
        if "records" not in payload or not isinstance(payload["records"], list):
            payload["records"] = []
            changed = True
        if "color" not in payload:
            payload["color"] = "#3B82F6"
            changed = True
        if "icon" not in payload:
            payload["icon"] = "book"
            changed = True
        if "pinned" not in payload:
            payload["pinned"] = False
            changed = True
        if "version_history" not in payload or not isinstance(payload["version_history"], list):
            payload["version_history"] = []
            changed = True

        normalized_binding = self._normalize_binding(payload.get("binding"))
        if payload.get("binding") != normalized_binding:
            payload["binding"] = normalized_binding
            changed = True

        managed_default = normalized_binding.get("kind") == "knowledge_base"
        if payload.get("managed") is None:
            payload["managed"] = managed_default
            changed = True
        elif bool(payload.get("managed")) != managed_default and managed_default:
            payload["managed"] = True
            changed = True
        else:
            payload["managed"] = bool(payload.get("managed"))

        normalized_records: list[dict[str, Any]] = []
        for record in payload.get("records", []):
            normalized_record, record_changed = self._normalize_record(record)
            normalized_records.append(normalized_record)
            changed = changed or record_changed
        payload["records"] = normalized_records

        return payload, changed

    def _load_index(self) -> dict[str, Any]:
        try:
            with open(self.index_file, encoding="utf-8") as f:
                index = json.load(f)
        except Exception:
            index = {"notebooks": []}

        notebooks = []
        changed = False
        for notebook in index.get("notebooks", []):
            normalized_binding = self._normalize_binding(notebook.get("binding"))
            managed_default = normalized_binding.get("kind") == "knowledge_base"
            normalized = {
                "id": notebook.get("id"),
                "name": notebook.get("name", ""),
                "description": notebook.get("description", ""),
                "created_at": notebook.get("created_at", 0),
                "updated_at": notebook.get("updated_at", 0),
                "record_count": notebook.get("record_count", 0),
                "color": notebook.get("color", "#3B82F6"),
                "icon": notebook.get("icon", "book"),
                "pinned": bool(notebook.get("pinned", False)),
                "binding": normalized_binding,
                "managed": bool(notebook.get("managed", managed_default)),
            }
            if normalized != notebook:
                changed = True
            notebooks.append(normalized)

        normalized_index = {"notebooks": notebooks}
        if changed:
            self._save_index(normalized_index)
        return normalized_index

    def _save_index(self, index: dict[str, Any]):
        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)

    def _get_notebook_file(self, notebook_id: str) -> Path:
        return self.base_dir / f"{notebook_id}.json"

    def _get_upload_dir(self, notebook_id: str, record_id: str | None = None) -> Path:
        base_dir = self.uploads_root / notebook_id
        return base_dir / record_id if record_id else base_dir

    def _load_notebook(self, notebook_id: str) -> dict[str, Any] | None:
        filepath = self._get_notebook_file(notebook_id)
        if not filepath.exists():
            return None

        try:
            with open(filepath, encoding="utf-8") as f:
                notebook = json.load(f)
        except Exception:
            return None

        normalized, changed = self._normalize_notebook_payload(notebook)
        if changed:
            self._save_notebook(normalized)
        return normalized

    def _save_notebook(self, notebook: dict[str, Any]):
        filepath = self._get_notebook_file(notebook["id"])
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(notebook, f, indent=2, ensure_ascii=False)

    def _snapshot_notebook(self, notebook: dict[str, Any]) -> dict[str, Any]:
        snapshot = deepcopy(notebook)
        snapshot.pop("version_history", None)
        return snapshot

    def _append_version(self, notebook: dict[str, Any], action: str):
        versions = notebook.setdefault("version_history", [])
        versions.append(
            {
                "version_id": str(uuid.uuid4())[:12],
                "created_at": time.time(),
                "action": action,
                "record_count": len(notebook.get("records", [])),
                "name": notebook.get("name", ""),
                "snapshot": self._snapshot_notebook(notebook),
            }
        )
        if len(versions) > self.MAX_VERSION_HISTORY:
            notebook["version_history"] = versions[-self.MAX_VERSION_HISTORY :]

    def _build_summary(self, notebook: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": notebook["id"],
            "name": notebook["name"],
            "description": notebook.get("description", ""),
            "created_at": notebook["created_at"],
            "updated_at": notebook["updated_at"],
            "record_count": len(notebook.get("records", [])),
            "color": notebook.get("color", "#3B82F6"),
            "icon": notebook.get("icon", "book"),
            "pinned": notebook.get("pinned", False),
            "binding": self._normalize_binding(notebook.get("binding")),
            "managed": bool(notebook.get("managed", False)),
        }

    def _sync_index_entry(self, notebook: dict[str, Any]):
        index = self._load_index()
        summary = self._build_summary(notebook)
        for nb_info in index.get("notebooks", []):
            if nb_info["id"] == notebook["id"]:
                nb_info.update(summary)
                break
        else:
            index.setdefault("notebooks", []).append(summary)
        self._save_index(index)

    def _delete_record_attachments(self, notebook_id: str, record_id: str):
        record_dir = self._get_upload_dir(notebook_id, record_id)
        if record_dir.exists():
            shutil.rmtree(record_dir, ignore_errors=True)

    def _extract_source_key(self, metadata: dict[str, Any] | None) -> str | None:
        if not isinstance(metadata, dict):
            return None
        source = metadata.get("source")
        if isinstance(source, dict):
            source_key = str(source.get("source_key") or "").strip()
            return source_key or None
        return None

    def _is_generic_title(self, title: str) -> bool:
        normalized = (title or "").strip().lower()
        if not normalized:
            return True

        generic_tokens = (
            "note",
            "notes",
            "record",
            "chat",
            "solver",
            "smart solver",
            "notebook",
            "笔记",
            "记录",
            "聊天",
            "智能解题",
            "解题",
            "未命名",
        )
        return any(token in normalized for token in generic_tokens)

    def _distill_title(self, title: str, user_query: str) -> str:
        original_title = (title or "").strip()
        query = (user_query or "").strip()

        if not query:
            return original_title or "学习笔记"

        # Keep meaningful manually provided titles.
        if original_title and original_title != query and not self._is_generic_title(original_title):
            return original_title

        text = re.sub(r"`[^`]*`", " ", query)
        text = re.sub(r"\s+", " ", text).strip()

        prefix_pattern = re.compile(
            r"^(?:请|帮我|麻烦|可以|能否|想|我想|请你|帮忙|介绍(?:一下)?|解释(?:一下)?|讲(?:一下)?|说(?:一下)?|告诉我|分析(?:一下)?|总结(?:一下)?|阐述(?:一下)?|说明(?:一下)?|给我|教我|让我了解|我想了解|我想知道|什么是|如何|怎么|怎样)+\s*"
        )
        suffix_pattern = re.compile(
            r"(?:简要介绍即可|简要说明即可|就好|即可|谢谢|可以吗|好吗|吧|呢|一下|详细一点|简单一点)[。！？?!,，;；\s]*$"
        )

        previous = None
        while text and text != previous:
            previous = text
            text = prefix_pattern.sub("", text).strip()
            text = suffix_pattern.sub("", text).strip()

        segments = [seg.strip() for seg in re.split(r"[，,。；;！？?!\n]", text) if seg.strip()]
        candidate = segments[0] if segments else text

        keyword_match = re.search(
            r"([A-Za-z][A-Za-z0-9_+\-]{1,15}\s*(?:算法|模型|定律|定理|原理|框架|方法|函数|方程)|[\u4e00-\u9fffA-Za-z0-9_+\-]{2,24}(?:算法|定理|原理|模型|方法|公式|概念|框架|机制|结构|网络|系统|协议|函数|方程))",
            candidate,
        )
        if keyword_match:
            distilled = keyword_match.group(1).strip()
        else:
            distilled = re.sub(r"^[^\w\u4e00-\u9fff]+|[^\w\u4e00-\u9fff]+$", "", candidate)
            distilled = distilled.strip()

        distilled = re.sub(r"\s+", " ", distilled).strip("-_:;,.，。！？?! ")
        if len(distilled) > 24:
            distilled = distilled[:24].rstrip()

        if len(distilled) < 2:
            if original_title and original_title != query:
                return original_title
            fallback = query[:24].strip("-_:;,.，。！？?! ")
            return fallback or "学习笔记"

        return distilled

    def generate_notebook_id(self) -> str:
        return str(uuid.uuid4())[:8]

    def generate_record_id(self) -> str:
        return str(uuid.uuid4())[:8]

    def create_notebook(
        self,
        name: str,
        description: str = "",
        color: str = "#3B82F6",
        icon: str = "book",
        binding: dict[str, Any] | None = None,
        managed: bool | None = None,
    ) -> dict[str, Any]:
        notebook_id = self.generate_notebook_id()
        now = time.time()
        normalized_binding = self._normalize_binding(binding)
        normalized_managed = managed
        if normalized_managed is None:
            normalized_managed = normalized_binding.get("kind") == "knowledge_base"

        notebook = {
            "id": notebook_id,
            "name": name,
            "description": description,
            "created_at": now,
            "updated_at": now,
            "records": [],
            "color": color,
            "icon": icon,
            "pinned": False,
            "binding": normalized_binding,
            "managed": bool(normalized_managed),
            "version_history": [],
        }
        self._append_version(notebook, "create")
        self._save_notebook(notebook)
        self._sync_index_entry(notebook)
        return notebook

    def list_notebooks(self, query: str | None = None) -> list[dict[str, Any]]:
        index = self._load_index()
        notebooks: list[dict[str, Any]] = []

        for nb_info in index.get("notebooks", []):
            notebook = self._load_notebook(nb_info["id"])
            if notebook:
                notebooks.append(self._build_summary(notebook))

        if query:
            q = query.lower().strip()
            notebooks = [
                nb
                for nb in notebooks
                if q in nb["name"].lower() or q in nb.get("description", "").lower()
            ]

        notebooks.sort(key=lambda x: (not x.get("pinned", False), -x["updated_at"]))
        return notebooks

    def get_notebook(self, notebook_id: str) -> dict[str, Any] | None:
        return self._load_notebook(notebook_id)

    def get_notebook_summary(self, notebook_id: str) -> dict[str, Any] | None:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return None
        return self._build_summary(notebook)

    def find_notebook_by_binding(self, kind: str, **criteria: Any) -> dict[str, Any] | None:
        for summary in self.list_notebooks():
            binding = summary.get("binding") or {}
            if binding.get("kind") != kind:
                continue
            matched = True
            for key, value in criteria.items():
                if binding.get(key) != value:
                    matched = False
                    break
            if matched:
                notebook = self.get_notebook(summary["id"])
                if notebook:
                    return notebook
        return None

    def update_notebook(
        self,
        notebook_id: str,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
        icon: str | None = None,
    ) -> dict[str, Any] | None:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return None

        if name is not None:
            notebook["name"] = name
        if description is not None:
            notebook["description"] = description
        if color is not None:
            notebook["color"] = color
        if icon is not None:
            notebook["icon"] = icon

        notebook["updated_at"] = time.time()
        self._append_version(notebook, "update_notebook")
        self._save_notebook(notebook)
        self._sync_index_entry(notebook)
        return notebook

    def set_binding(
        self,
        notebook_id: str,
        binding: dict[str, Any],
        *,
        managed: bool | None = None,
        name: str | None = None,
        description: str | None = None,
        icon: str | None = None,
    ) -> dict[str, Any] | None:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return None

        notebook["binding"] = self._normalize_binding(binding)
        notebook["managed"] = (
            managed
            if managed is not None
            else notebook["binding"].get("kind") == "knowledge_base"
        )
        if name is not None:
            notebook["name"] = name
        if description is not None:
            notebook["description"] = description
        if icon is not None:
            notebook["icon"] = icon

        notebook["updated_at"] = time.time()
        self._append_version(notebook, "update_binding")
        self._save_notebook(notebook)
        self._sync_index_entry(notebook)
        return notebook

    def delete_notebook(self, notebook_id: str, force: bool = False) -> bool:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return False
        if notebook.get("managed") and not force:
            raise PermissionError("Managed notebook cannot be deleted directly")

        filepath = self._get_notebook_file(notebook_id)
        if filepath.exists():
            filepath.unlink()

        uploads_dir = self._get_upload_dir(notebook_id)
        if uploads_dir.exists():
            shutil.rmtree(uploads_dir, ignore_errors=True)

        index = self._load_index()
        index["notebooks"] = [nb for nb in index.get("notebooks", []) if nb["id"] != notebook_id]
        self._save_index(index)
        return True

    def add_record(
        self,
        notebook_ids: list[str],
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
        metadata: dict[str, Any] | None = None,
        kb_name: str | None = None,
        record_id: str | None = None,
    ) -> dict[str, Any]:
        now = time.time()
        resolved_title = self._distill_title(title, user_query)
        record = {
            "id": record_id or self.generate_record_id(),
            "type": self._normalize_record_type(record_type),
            "title": resolved_title,
            "user_query": user_query,
            "output": output,
            "metadata": deepcopy(metadata or {}),
            "created_at": now,
            "kb_name": kb_name,
        }

        added_to: list[str] = []
        for notebook_id in notebook_ids:
            notebook = self._load_notebook(notebook_id)
            if not notebook:
                continue
            notebook["records"].append(deepcopy(record))
            notebook["updated_at"] = now
            self._append_version(notebook, f"add_record:{record_type}")
            self._save_notebook(notebook)
            self._sync_index_entry(notebook)
            added_to.append(notebook_id)

        return {"record": record, "added_to_notebooks": added_to}

    def add_record_to_notebook(
        self,
        notebook_id: str,
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
        metadata: dict[str, Any] | None = None,
        kb_name: str | None = None,
        record_id: str | None = None,
    ) -> dict[str, Any] | None:
        result = self.add_record(
            notebook_ids=[notebook_id],
            record_type=record_type,
            title=title,
            user_query=user_query,
            output=output,
            metadata=metadata or {},
            kb_name=kb_name,
            record_id=record_id,
        )
        if notebook_id not in result["added_to_notebooks"]:
            return None
        return result["record"]

    def find_record_by_source_key(self, notebook_id: str, source_key: str) -> dict[str, Any] | None:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return None
        for record in notebook.get("records", []):
            if self._extract_source_key(record.get("metadata")) == source_key:
                return record
        return None

    def add_or_get_record_to_notebook(
        self,
        notebook_id: str,
        record_type: RecordType | str,
        title: str,
        user_query: str,
        output: str,
        metadata: dict[str, Any] | None = None,
        kb_name: str | None = None,
        record_id: str | None = None,
    ) -> dict[str, Any] | None:
        source_key = self._extract_source_key(metadata or {})
        if source_key:
            existing = self.find_record_by_source_key(notebook_id, source_key)
            if existing:
                return {"record": existing, "created": False}

        record = self.add_record_to_notebook(
            notebook_id=notebook_id,
            record_type=record_type,
            title=title,
            user_query=user_query,
            output=output,
            metadata=metadata or {},
            kb_name=kb_name,
            record_id=record_id,
        )
        if not record:
            return None
        return {"record": record, "created": True}

    def remove_record(self, notebook_id: str, record_id: str) -> bool:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return False

        original_count = len(notebook["records"])
        notebook["records"] = [r for r in notebook["records"] if r["id"] != record_id]
        if len(notebook["records"]) == original_count:
            return False

        notebook["updated_at"] = time.time()
        self._append_version(notebook, "remove_record")
        self._save_notebook(notebook)
        self._sync_index_entry(notebook)
        self._delete_record_attachments(notebook_id, record_id)
        return True

    def search_records(
        self,
        notebook_id: str,
        query: str | None = None,
        tag: str | None = None,
        record_type: str | None = None,
    ) -> list[dict[str, Any]]:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return []

        records = notebook.get("records", [])
        q = (query or "").strip().lower()
        tag_norm = (tag or "").strip().lower()
        type_norm = (record_type or "").strip()

        def _match(record: dict[str, Any]) -> bool:
            if type_norm and record.get("type") != type_norm:
                return False

            if q:
                attachment = record.get("metadata", {}).get("attachment", {})
                haystack = " ".join(
                    [
                        str(record.get("title", "")),
                        str(record.get("user_query", "")),
                        str(record.get("output", "")),
                        str(record.get("kb_name", "")),
                        str(attachment.get("filename", "")),
                    ]
                ).lower()
                if q not in haystack:
                    return False

            if tag_norm:
                tags = record.get("metadata", {}).get("tags", [])
                tags_lower = [str(t).lower() for t in tags] if isinstance(tags, list) else []
                if tag_norm not in tags_lower:
                    return False

            return True

        return [r for r in records if _match(r)]

    def get_record_tags(self, notebook_id: str) -> list[str]:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return []
        tags: set[str] = set()
        for record in notebook.get("records", []):
            meta_tags = record.get("metadata", {}).get("tags", [])
            if isinstance(meta_tags, list):
                for tag in meta_tags:
                    if isinstance(tag, str) and tag.strip():
                        tags.add(tag.strip())
        return sorted(tags)

    def list_versions(self, notebook_id: str) -> list[dict[str, Any]]:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return []

        versions = notebook.get("version_history", [])
        summaries = [
            {
                "version_id": version.get("version_id"),
                "created_at": version.get("created_at"),
                "action": version.get("action"),
                "record_count": version.get("record_count", 0),
                "name": version.get("name", notebook.get("name", "")),
            }
            for version in versions
        ]
        summaries.sort(key=lambda item: item.get("created_at", 0), reverse=True)
        return summaries

    def rollback_to_version(self, notebook_id: str, version_id: str) -> dict[str, Any] | None:
        notebook = self._load_notebook(notebook_id)
        if not notebook:
            return None

        versions = notebook.get("version_history", [])
        target = next((v for v in versions if v.get("version_id") == version_id), None)
        if not target:
            return None

        target_snapshot = target.get("snapshot")
        if not isinstance(target_snapshot, dict):
            return None

        self._append_version(notebook, f"rollback_backup:{version_id}")
        current_versions = notebook.get("version_history", [])

        restored = deepcopy(target_snapshot)
        restored["id"] = notebook_id
        restored["updated_at"] = time.time()
        restored["version_history"] = current_versions
        self._append_version(restored, f"rollback_to:{version_id}")

        self._save_notebook(restored)
        self._sync_index_entry(restored)
        return restored

    def get_statistics(self) -> dict[str, Any]:
        notebooks = self.list_notebooks()
        total_records = 0
        type_counts = {
            "solve": 0,
            "question": 0,
            "research": 0,
            "co_writer": 0,
            "chat": 0,
            "upload": 0,
        }

        for nb_info in notebooks:
            notebook = self._load_notebook(nb_info["id"])
            if not notebook:
                continue
            for record in notebook.get("records", []):
                total_records += 1
                record_type = record.get("type", "")
                if record_type in type_counts:
                    type_counts[record_type] += 1

        return {
            "total_notebooks": len(notebooks),
            "total_records": total_records,
            "records_by_type": type_counts,
            "recent_notebooks": notebooks[:5],
        }


notebook_manager = NotebookManager()
