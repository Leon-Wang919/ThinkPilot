#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
GuideManager - Guided Learning Session Manager
Manages the complete lifecycle of learning sessions
"""

import asyncio
import hashlib
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

from src.services.config import load_config_with_main, parse_language
from src.services.rag.service import RAGService
from src.tlogging import get_logger

from .agents import ChatAgent, InteractiveAgent, LocateAgent, SummaryAgent


@dataclass
class GuidedSession:
    """Guided learning session"""

    session_id: str
    created_at: float
    subject: str = "science"
    kb_name: str = ""
    mode: str = "topic"
    topic: str | None = None
    source_label: str = ""
    source_notes: str = ""
    notebook_id: str | None = None
    notebook_name: str = ""
    knowledge_points: list[dict[str, Any]] = field(default_factory=list)
    current_index: int = 0
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    status: str = "initialized"  # initialized, learning, completed
    current_html: str = ""
    rendered_html: dict[int, str] = field(default_factory=dict)
    kb_contexts: dict[int, str] = field(default_factory=dict)
    grounding_warnings: dict[int, str] = field(default_factory=dict)
    summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GuidedSession":
        data = dict(data)
        source_label = data.get("source_label") or data.get("kb_name") or data.get("notebook_name") or ""
        rendered_html = data.get("rendered_html") or {}
        if isinstance(rendered_html, dict):
            data["rendered_html"] = {
                int(index): html
                for index, html in rendered_html.items()
                if str(index).isdigit() and isinstance(html, str)
            }
        else:
            data["rendered_html"] = {}
        kb_contexts = data.get("kb_contexts") or {}
        if isinstance(kb_contexts, dict):
            data["kb_contexts"] = {
                int(index): context
                for index, context in kb_contexts.items()
                if str(index).isdigit() and isinstance(context, str)
            }
        else:
            data["kb_contexts"] = {}
        grounding_warnings = data.get("grounding_warnings") or {}
        if isinstance(grounding_warnings, dict):
            data["grounding_warnings"] = {
                int(index): warning
                for index, warning in grounding_warnings.items()
                if str(index).isdigit() and isinstance(warning, str)
            }
        else:
            data["grounding_warnings"] = {}
        data.setdefault("kb_name", "")
        data.setdefault("subject", "science")
        data.setdefault("mode", "topic")
        data.setdefault("topic", None)
        data.setdefault("source_label", source_label)
        data.setdefault("source_notes", "")
        data.setdefault("notebook_id", None)
        data.setdefault("notebook_name", source_label)
        return cls(**data)


class GuideManager:
    """Guided learning manager"""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        api_version: str | None = None,
        language: str | None = None,
        output_dir: str | None = None,
        config_path: str | None = None,
        binding: str = "openai",
    ):
        """
        Initialize manager

        Args:
            api_key: API key
            base_url: API endpoint
            api_version: API version (for Azure OpenAI)
            language: Language setting (if None, read from config file)
            output_dir: Output directory
            config_path: Configuration file path (if None, use default path)
            binding: LLM provider binding
        """
        self.api_key = api_key
        self.base_url = base_url
        self.api_version = api_version
        self.binding = binding
        self.project_root = Path(__file__).parent.parent.parent.parent

        if config_path is None:
            config = load_config_with_main("guide_config.yaml", self.project_root)
        else:
            config_path = Path(config_path)
            if config_path.exists():
                try:
                    with open(config_path, encoding="utf-8") as f:
                        config = yaml.safe_load(f) or {}
                except Exception:
                    config = {}
            else:
                config = {}

        # Initialize logger (from config)
        log_dir = config.get("paths", {}).get("user_log_dir") or config.get("logging", {}).get(
            "log_dir"
        )
        self.logger = get_logger("Guide", log_dir=log_dir)

        if language is None:
            # Get language config (unified in config/main.yaml system.language)
            lang_config = config.get("system", {}).get("language", "zh")
            self.language = parse_language(lang_config)
            self.logger.info(f"Language setting loaded from config: {self.language}")
        else:
            # If explicitly specified, also parse it to ensure consistency
            self.language = parse_language(language)
            self.logger.info(f"Using explicitly specified language setting: {self.language}")

        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            # Get output_dir from config (already loaded above)
            output_dir_from_config = config.get("system", {}).get("output_dir")
            if output_dir_from_config:
                self.output_dir = Path(output_dir_from_config)
            else:
                self.output_dir = self.project_root / "data" / "user" / "guide"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.kb_base_dir = self.project_root / "data" / "knowledge_bases"
        self.rag_service = RAGService(kb_base_dir=str(self.kb_base_dir))

        self.locate_agent = LocateAgent(
            api_key,
            base_url,
            language=self.language,
            api_version=self.api_version,
            binding=self.binding,
        )
        self.interactive_agent = InteractiveAgent(
            api_key,
            base_url,
            language=self.language,
            api_version=self.api_version,
            binding=self.binding,
        )
        self.chat_agent = ChatAgent(
            api_key,
            base_url,
            language=self.language,
            api_version=self.api_version,
            binding=self.binding,
        )
        self.summary_agent = SummaryAgent(
            api_key,
            base_url,
            language=self.language,
            api_version=self.api_version,
            binding=self.binding,
        )

        self._sessions: dict[str, GuidedSession] = {}
        self._prefetch_tasks: dict[tuple[str, int], asyncio.Task[None]] = {}
        self.plan_cache_dir = self.output_dir / "plan_cache"
        self.plan_cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_session_file(self, session_id: str) -> Path:
        """Get session file path"""
        return self.output_dir / f"session_{session_id}.json"

    def _save_session(self, session: GuidedSession):
        """Save session to file"""
        filepath = self._get_session_file(session.session_id)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(session.to_dict(), f, indent=2, ensure_ascii=False)
        self._sessions[session.session_id] = session

    def _get_cached_html(self, session: GuidedSession, index: int) -> str:
        return session.rendered_html.get(index, "")

    def _set_cached_html(self, session: GuidedSession, index: int, html: str) -> None:
        if html:
            session.rendered_html[index] = html

    def _get_kb_signature(self, kb_name: str) -> str:
        kb_dir = self.locate_agent.kb_base_dir / kb_name
        if not kb_dir.exists():
            return "missing"

        latest_mtime_ns = 0
        total_size = 0
        file_count = 0
        for path in kb_dir.rglob("*"):
            if not path.is_file():
                continue
            stat = path.stat()
            latest_mtime_ns = max(latest_mtime_ns, stat.st_mtime_ns)
            total_size += stat.st_size
            file_count += 1
        return f"{file_count}:{total_size}:{latest_mtime_ns}"

    def _get_plan_cache_file(self, kb_name: str, mode: str, topic: str | None) -> Path:
        try:
            model = self.locate_agent.get_model()
        except Exception:
            model = ""

        payload = {
            "kb_name": kb_name,
            "mode": mode,
            "topic": topic or "",
            "language": self.language,
            "model": model,
            "kb_signature": self._get_kb_signature(kb_name),
        }
        digest = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        return self.plan_cache_dir / f"{digest}.json"

    def _load_plan_cache(self, kb_name: str, mode: str, topic: str | None) -> dict[str, Any] | None:
        cache_file = self._get_plan_cache_file(kb_name, mode, topic)
        if not cache_file.exists():
            return None
        try:
            with open(cache_file, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return None
        if not isinstance(data, dict) or not data.get("knowledge_points"):
            return None
        return data

    def _save_plan_cache(
        self, kb_name: str, mode: str, topic: str | None, locate_result: dict[str, Any]
    ) -> None:
        cache_file = self._get_plan_cache_file(kb_name, mode, topic)
        payload = {
            "success": True,
            "knowledge_points": locate_result.get("knowledge_points", []),
            "total_points": locate_result.get("total_points", 0),
            "grounding_warning": locate_result.get("grounding_warning", ""),
            "cached_at": time.time(),
        }
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

    def _extract_grounding_strings(self, value: Any) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            return [stripped] if stripped else []

        if isinstance(value, list):
            results: list[str] = []
            for item in value:
                results.extend(self._extract_grounding_strings(item))
            return results

        if isinstance(value, dict):
            results: list[str] = []
            preferred_keys = (
                "content",
                "answer",
                "text",
                "summary",
                "description",
                "chunk_text",
                "chunks",
                "results",
                "references",
            )
            for key in preferred_keys:
                if key in value:
                    results.extend(self._extract_grounding_strings(value[key]))
            for key, item in value.items():
                if key not in preferred_keys:
                    results.extend(self._extract_grounding_strings(item))
            return results

        return []

    def _dedupe_grounding_sections(self, sections: list[str], limit: int = 8000) -> str:
        cleaned: list[str] = []
        seen: set[str] = set()
        total_length = 0

        for section in sections:
            normalized = " ".join(section.split())
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            cleaned.append(section.strip())
            total_length += len(section)
            if total_length >= limit:
                break

        return "\n\n".join(cleaned)[:limit]

    def _is_thin_grounding(self, context: str) -> bool:
        return len(context.strip()) < 240

    def _build_grounding_warning(
        self, session: GuidedSession, title: str, kind: str = "step"
    ) -> str:
        source = session.source_label or session.kb_name or "the selected knowledge base"
        target = title or "this learning step"
        return (
            f'The selected knowledge base "{source}" returned limited grounding for {kind} '
            f'"{target}". The response may include light generic补全; verify against the source material.'
        )

    async def _search_kb(self, kb_name: str, query: str) -> str:
        try:
            result = await self.rag_service.search(query=query, kb_name=kb_name, mode="hybrid")
        except Exception as exc:
            self.logger.warning(f"Guide KB retrieval failed for '{kb_name}' and query '{query}': {exc}")
            return ""

        parts = self._extract_grounding_strings(result)
        return self._dedupe_grounding_sections(parts, limit=5000)

    async def _get_step_grounding(
        self, session: GuidedSession, index: int
    ) -> tuple[str, str | None]:
        cached_context = session.kb_contexts.get(index, "")
        cached_warning = session.grounding_warnings.get(index, "")
        if cached_context:
            return cached_context, cached_warning or None

        if index < 0 or index >= len(session.knowledge_points):
            return "", None

        knowledge = session.knowledge_points[index]
        title = knowledge.get("knowledge_title", "").strip()
        summary = knowledge.get("knowledge_summary", "").strip()
        difficulty = knowledge.get("user_difficulty", "").strip()

        if not session.kb_name:
            context = self._dedupe_grounding_sections(
                [section for section in [title, summary, session.source_notes] if section],
                limit=7000,
            )
            warning = None
            if self._is_thin_grounding(context):
                warning = self._build_grounding_warning(session, title)
            session.kb_contexts[index] = context
            if warning:
                session.grounding_warnings[index] = warning
            return context, warning

        queries = [
            "\n".join(part for part in [title, summary] if part).strip(),
            "\n".join(part for part in [title, difficulty, session.topic or ""] if part).strip(),
        ]

        sections: list[str] = []
        for query in queries:
            if not query:
                continue
            retrieved = await self._search_kb(session.kb_name, query)
            if retrieved:
                sections.append(retrieved)
            if len("\n\n".join(sections)) >= 7000:
                break

        context = self._dedupe_grounding_sections(sections, limit=7000)
        warning = None
        if self._is_thin_grounding(context):
            warning = self._build_grounding_warning(session, title)

        session.kb_contexts[index] = context
        if warning:
            session.grounding_warnings[index] = warning
        return context, warning

    async def _get_chat_grounding(
        self, session: GuidedSession, user_message: str
    ) -> tuple[str, str | None]:
        base_context, warning = await self._get_step_grounding(session, session.current_index)
        knowledge = session.knowledge_points[session.current_index]
        title = knowledge.get("knowledge_title", "").strip()

        if not session.kb_name:
            combined = self._dedupe_grounding_sections(
                [base_context, user_message],
                limit=8000,
            )
        else:
            chat_query = "\n".join(part for part in [title, user_message] if part).strip()
            chat_context = await self._search_kb(session.kb_name, chat_query) if chat_query else ""
            combined = self._dedupe_grounding_sections(
                [base_context, chat_context],
                limit=8000,
            )

        if self._is_thin_grounding(combined):
            warning = self._build_grounding_warning(session, title, kind="question")

        return combined, warning

    async def _render_html_for_index(self, session: GuidedSession, index: int) -> str:
        cached_html = self._get_cached_html(session, index)
        if cached_html:
            return cached_html

        if index < 0 or index >= len(session.knowledge_points):
            return ""

        knowledge = session.knowledge_points[index]
        kb_context, grounding_warning = await self._get_step_grounding(session, index)
        interactive_result = await self.interactive_agent.process(
            knowledge=knowledge,
            kb_context=kb_context,
            source_label=session.source_label or session.kb_name or session.notebook_name,
            grounding_warning=grounding_warning,
        )
        html = interactive_result.get("html", "")
        if html:
            self._set_cached_html(session, index, html)
        return html

    def _schedule_prefetch(self, session_id: str, index: int) -> None:
        task_key = (session_id, index)
        existing = self._prefetch_tasks.get(task_key)
        if existing and not existing.done():
            return

        async def _runner() -> None:
            try:
                session = self._load_session(session_id)
                if not session:
                    return
                if index < 0 or index >= len(session.knowledge_points):
                    return
                if self._get_cached_html(session, index):
                    return
                html = await self._render_html_for_index(session, index)
                if html:
                    self._save_session(session)
            except Exception as exc:
                self.logger.warning(
                    f"Guide prefetch failed for session={session_id}, index={index}: {exc}"
                )
            finally:
                self._prefetch_tasks.pop(task_key, None)

        self._prefetch_tasks[task_key] = asyncio.create_task(_runner())

    def _load_session(self, session_id: str) -> GuidedSession | None:
        """Load session from file"""
        if session_id in self._sessions:
            return self._sessions[session_id]

        filepath = self._get_session_file(session_id)
        if filepath.exists():
            with open(filepath, encoding="utf-8") as f:
                data = json.load(f)
            session = GuidedSession.from_dict(data)
            self._sessions[session_id] = session
            return session
        return None

    async def create_session(
        self,
        kb_name: str,
        mode: str,
        topic: str | None = None,
        subject: str = "science",
        source_notes: str | None = None,
        source_label: str | None = None,
    ) -> dict[str, Any]:
        """
        Create new learning session

        Args:
            kb_name: Knowledge base name
            mode: Learning mode ("topic" | "curriculum")
            topic: Learning topic for topic mode

        Returns:
            Session creation result
        """
        normalized_kb = (kb_name or "").strip()
        normalized_source_notes = (source_notes or "").strip()
        normalized_source_label = (source_label or normalized_kb or "Notebook Review").strip()
        session_id = str(uuid.uuid4())[:8]
        cache_hit = False
        has_source_notes = bool(normalized_source_notes)
        locate_result = None
        if not has_source_notes and normalized_kb:
            locate_result = self._load_plan_cache(kb_name=normalized_kb, mode=mode, topic=topic)
            if locate_result:
                cache_hit = True

        if locate_result is None:
            locate_kwargs = dict(
                kb_name=normalized_kb,
                mode=mode,
                topic=topic,
            )
            if has_source_notes:
                locate_kwargs["source_notes"] = normalized_source_notes
            locate_result = await self.locate_agent.process(**locate_kwargs)
            if locate_result.get("success") and not has_source_notes and normalized_kb:
                self._save_plan_cache(
                    kb_name=normalized_kb,
                    mode=mode,
                    topic=topic,
                    locate_result=locate_result,
                )

        if not locate_result.get("success"):
            return {
                "success": False,
                "code": locate_result.get("code", "guide_plan_failed"),
                "error": locate_result.get("error", "Failed to analyze knowledge points"),
                "message": locate_result.get("message", locate_result.get("error")),
                "session_id": None,
            }

        knowledge_points = locate_result.get("knowledge_points", [])

        if not knowledge_points:
            return {
                "success": False,
                "code": "knowledge_not_found",
                "error": "No knowledge points identified from knowledge base",
                "message": "The selected knowledge base did not yield a usable learning path.",
                "session_id": None,
            }

        session = GuidedSession(
            session_id=session_id,
            created_at=time.time(),
            subject=subject,
            kb_name=normalized_kb,
            mode=mode,
            topic=topic,
            source_label=normalized_source_label,
            source_notes=normalized_source_notes,
            notebook_name=normalized_source_label,
            knowledge_points=knowledge_points,
            current_index=0,
            status="initialized",
        )

        self._save_session(session)
        self._schedule_prefetch(session.session_id, 0)

        return {
            "success": True,
            "session_id": session_id,
            "kb_name": normalized_kb,
            "subject": subject,
            "source_label": session.source_label,
            "mode": mode,
            "topic": topic,
            "knowledge_points": knowledge_points,
            "total_points": len(knowledge_points),
            "cache_hit": cache_hit,
            "grounding_warning": locate_result.get("grounding_warning"),
            "message": f"Learning plan created with {len(knowledge_points)} knowledge points",
        }

    def _get_learning_state(
        self, knowledge_points: list[dict[str, Any]], current_index: int
    ) -> dict[str, Any]:
        """
        Get learning state information (internal helper method)

        Args:
            knowledge_points: Knowledge point list
            current_index: Current knowledge point index

        Returns:
            Learning state information
        """
        total_points = len(knowledge_points)

        if total_points == 0:
            return {"success": False, "error": "No knowledge points to learn", "status": "empty"}

        if current_index >= total_points:
            return {
                "success": True,
                "current_index": current_index,
                "current_knowledge": None,
                "status": "completed",
                "progress_percentage": 100,
                "total_points": total_points,
                "message": "🎉 Congratulations! You have completed learning all knowledge points!",
            }

        current_knowledge = knowledge_points[current_index]
        progress = int((current_index / total_points) * 100)

        message = f"📚 Starting to learn knowledge point {current_index + 1}: {current_knowledge.get('knowledge_title', '')}"

        return {
            "success": True,
            "current_index": current_index,
            "current_knowledge": current_knowledge,
            "status": "learning",
            "progress_percentage": progress,
            "total_points": total_points,
            "remaining_points": total_points - current_index - 1,
            "message": message,
        }

    async def start_learning(self, session_id: str) -> dict[str, Any]:
        """
        Start learning the first knowledge point

        Args:
            session_id: Session ID

        Returns:
            First knowledge point information and interactive page
        """
        session = self._load_session(session_id)
        if not session:
            return {"success": False, "error": "Session does not exist"}

        state = self._get_learning_state(session.knowledge_points, 0)

        if not state.get("success"):
            return state

        current_knowledge = state.get("current_knowledge")

        html = await self._render_html_for_index(session, 0)

        session.current_index = 0
        session.status = "learning"
        session.current_html = html

        session.chat_history.append(
            {
                "role": "system",
                "content": state.get("message", ""),
                "knowledge_index": 0,
                "timestamp": time.time(),
            }
        )

        self._save_session(session)
        self._schedule_prefetch(session.session_id, 1)

        return {
            "success": True,
            "current_index": 0,
            "current_knowledge": current_knowledge,
            "html": html,
            "progress": state.get("progress_percentage", 0),
            "total_points": len(session.knowledge_points),
            "source_label": session.source_label,
            "grounding_warning": session.grounding_warnings.get(0),
            "message": state.get("message", ""),
        }

    async def next_knowledge(self, session_id: str) -> dict[str, Any]:
        """
        Move to next knowledge point

        Args:
            session_id: Session ID

        Returns:
            Next knowledge point information and interactive page, or completion summary
        """
        session = self._load_session(session_id)
        if not session:
            return {"success": False, "error": "Session does not exist"}

        new_index = session.current_index + 1

        state = self._get_learning_state(session.knowledge_points, new_index)

        if not state.get("success"):
            return state

        if state.get("status") == "completed":
            summary_result = await self.summary_agent.process(
                source_label=session.source_label or session.kb_name or session.notebook_name,
                knowledge_points=session.knowledge_points,
                chat_history=session.chat_history,
            )

            session.status = "completed"
            session.summary = summary_result.get("summary", "")
            session.current_index = new_index

            session.chat_history.append(
                {
                    "role": "system",
                    "content": state.get(
                        "message", "Congratulations on completing all knowledge points!"
                    ),
                    "timestamp": time.time(),
                }
            )

            self._save_session(session)

            return {
                "success": True,
                "status": "completed",
                "summary": session.summary,
                "progress": 100,
                "source_label": session.source_label,
                "message": state.get("message", ""),
            }

        current_knowledge = state.get("current_knowledge")

        html = await self._render_html_for_index(session, new_index)

        session.current_index = new_index
        session.current_html = html

        message = f"📚 Entering knowledge point {new_index + 1}: {current_knowledge.get('knowledge_title', '')}"

        session.chat_history.append(
            {
                "role": "system",
                "content": message,
                "knowledge_index": new_index,
                "timestamp": time.time(),
            }
        )

        self._save_session(session)
        self._schedule_prefetch(session.session_id, new_index + 1)

        return {
            "success": True,
            "current_index": new_index,
            "current_knowledge": current_knowledge,
            "html": html,
            "progress": state.get("progress_percentage", 0),
            "total_points": len(session.knowledge_points),
            "remaining_points": state.get("remaining_points", 0),
            "source_label": session.source_label,
            "grounding_warning": session.grounding_warnings.get(new_index),
            "message": message,
        }

    async def previous_knowledge(self, session_id: str) -> dict[str, Any]:
        """
        Move back to previous knowledge point.

        Args:
            session_id: Session ID

        Returns:
            Previous knowledge point information and interactive page
        """
        session = self._load_session(session_id)
        if not session:
            return {"success": False, "error": "Session does not exist"}

        total_points = len(session.knowledge_points)
        if total_points == 0:
            return {"success": False, "error": "No knowledge points available"}

        if session.status == "completed":
            new_index = min(session.current_index - 1, total_points - 1)
        else:
            new_index = session.current_index - 1

        if new_index < 0:
            return {
                "success": False,
                "error": "Already at the first knowledge point",
                "code": "at_first_knowledge",
            }

        state = self._get_learning_state(session.knowledge_points, new_index)
        if not state.get("success"):
            return state

        current_knowledge = state.get("current_knowledge")
        html = await self._render_html_for_index(session, new_index)

        session.current_index = new_index
        session.current_html = html
        session.status = "learning"

        message = (
            f"📚 Returning to knowledge point {new_index + 1}: "
            f"{current_knowledge.get('knowledge_title', '')}"
        )

        session.chat_history.append(
            {
                "role": "system",
                "content": message,
                "knowledge_index": new_index,
                "timestamp": time.time(),
            }
        )

        self._save_session(session)
        self._schedule_prefetch(session.session_id, new_index + 1)

        return {
            "success": True,
            "current_index": new_index,
            "current_knowledge": current_knowledge,
            "html": html,
            "progress": state.get("progress_percentage", 0),
            "total_points": total_points,
            "remaining_points": state.get("remaining_points", 0),
            "source_label": session.source_label,
            "grounding_warning": session.grounding_warnings.get(new_index),
            "message": message,
        }

    async def chat(self, session_id: str, user_message: str) -> dict[str, Any]:
        """
        Process user chat message

        Args:
            session_id: Session ID
            user_message: User message

        Returns:
            Assistant's answer
        """
        session = self._load_session(session_id)
        if not session:
            return {"success": False, "error": "Session does not exist"}

        if session.status != "learning":
            return {"success": False, "error": "Not currently in learning state"}

        current_knowledge = session.knowledge_points[session.current_index]

        current_history = [
            msg
            for msg in session.chat_history
            if msg.get("knowledge_index") == session.current_index
        ]

        user_msg = {
            "role": "user",
            "content": user_message,
            "knowledge_index": session.current_index,
            "timestamp": time.time(),
        }
        session.chat_history.append(user_msg)

        kb_context, grounding_warning = await self._get_chat_grounding(session, user_message)

        chat_result = await self.chat_agent.process(
            knowledge=current_knowledge,
            chat_history=current_history,
            user_question=user_message,
            kb_context=kb_context,
            source_label=session.source_label or session.kb_name or session.notebook_name,
            grounding_warning=grounding_warning,
        )

        assistant_msg = {
            "role": "assistant",
            "content": chat_result.get("answer", ""),
            "knowledge_index": session.current_index,
            "timestamp": time.time(),
        }
        session.chat_history.append(assistant_msg)

        self._save_session(session)

        return {
            "success": True,
            "answer": chat_result.get("answer", ""),
            "knowledge_index": session.current_index,
            "source_label": session.source_label,
            "grounding_warning": grounding_warning,
        }

    async def fix_html(self, session_id: str, bug_description: str) -> dict[str, Any]:
        """
        Fix HTML page bug

        Args:
            session_id: Session ID
            bug_description: Bug description

        Returns:
            Fixed HTML
        """
        session = self._load_session(session_id)
        if not session:
            return {"success": False, "error": "Session does not exist"}

        current_knowledge = session.knowledge_points[session.current_index]

        kb_context, grounding_warning = await self._get_step_grounding(session, session.current_index)

        result = await self.interactive_agent.process(
            knowledge=current_knowledge,
            kb_context=kb_context,
            source_label=session.source_label or session.kb_name or session.notebook_name,
            grounding_warning=grounding_warning,
            retry_with_bug=bug_description,
        )

        if result.get("success"):
            session.current_html = result.get("html", "")
            self._save_session(session)

        return result

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Get session information"""
        session = self._load_session(session_id)
        if session:
            return session.to_dict()
        return None

    def get_current_html(self, session_id: str) -> str | None:
        """Get current HTML page"""
        session = self._load_session(session_id)
        if session:
            return session.current_html
        return None

