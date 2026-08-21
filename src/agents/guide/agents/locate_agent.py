#!/usr/bin/env python
"""
LocateAgent - Agent for building guided-learning plans from knowledge bases.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
from typing import Any, Optional

from src.agents.base_agent import BaseAgent
from src.services.rag.service import RAGService


class LocateAgent(BaseAgent):
    """Knowledge-base-first learning plan agent."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        language: str = "zh",
        api_version: Optional[str] = None,
        binding: str = "openai",
    ):
        super().__init__(
            module_name="guide",
            agent_name="locate_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
            binding=binding,
        )
        self.project_root = Path(__file__).resolve().parents[4]
        self.kb_base_dir = self.project_root / "data" / "knowledge_bases"
        self.rag_service = RAGService(kb_base_dir=str(self.kb_base_dir))

    def _extract_strings(self, value: Any) -> list[str]:
        """Collect readable strings from arbitrary JSON content."""
        results: list[str] = []

        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                results.append(stripped)
            return results

        if isinstance(value, list):
            for item in value:
                results.extend(self._extract_strings(item))
            return results

        if isinstance(value, dict):
            preferred_keys = (
                "title",
                "heading",
                "section",
                "chapter",
                "summary",
                "description",
                "content",
                "text",
                "body",
            )
            for key in preferred_keys:
                if key in value:
                    results.extend(self._extract_strings(value[key]))
            for key, item in value.items():
                if key not in preferred_keys:
                    results.extend(self._extract_strings(item))
            return results

        return results

    def _load_content_candidates(self, kb_name: str) -> list[dict[str, str]]:
        """Load text snippets from KB-side JSON/text artifacts."""
        kb_dir = self.kb_base_dir / kb_name
        candidates: list[dict[str, str]] = []

        for json_path in sorted((kb_dir / "content_list").glob("*.json")):
            try:
                payload = json.loads(json_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            blocks = self._extract_strings(payload)
            text = "\n".join(blocks[:40]).strip()
            if text:
                candidates.append({"source": json_path.name, "text": text[:12000]})

        for text_path in sorted((kb_dir / "raw").glob("**/*")):
            if not text_path.is_file() or text_path.suffix.lower() not in {".md", ".markdown", ".txt"}:
                continue
            try:
                text = text_path.read_text(encoding="utf-8", errors="ignore").strip()
            except Exception:
                continue
            if text:
                candidates.append({"source": text_path.name, "text": text[:12000]})

        metadata_path = kb_dir / "metadata.json"
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except Exception:
                metadata = {}
            metadata_summary = "\n".join(self._extract_strings(metadata))
            if metadata_summary:
                candidates.append({"source": "metadata.json", "text": metadata_summary[:4000]})

        deduped: list[dict[str, str]] = []
        seen = set()
        for item in candidates:
            key = (item["source"], item["text"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _select_topic_context(
        self, candidates: list[dict[str, str]], topic: str
    ) -> list[dict[str, str]]:
        """Pick the most relevant snippets for a topic."""
        topic_terms = [term for term in re.split(r"\s+", topic.lower()) if term]
        ranked: list[tuple[int, dict[str, str]]] = []

        for item in candidates:
            haystack = f"{item['source']} {item['text']}".lower()
            score = sum(haystack.count(term) for term in topic_terms)
            if score > 0:
                ranked.append((score, item))

        ranked.sort(key=lambda item: item[0], reverse=True)
        return [item for _, item in ranked[:4]]

    def _format_context(self, candidates: list[dict[str, str]]) -> str:
        """Format snippets for prompt injection."""
        formatted = []
        for idx, item in enumerate(candidates, 1):
            snippet = item["text"][:3500]
            formatted.append(f"## Source {idx}: {item['source']}\n{snippet}")
        return "\n\n".join(formatted)

    def _extract_retrieval_text(self, value: Any) -> list[str]:
        return self._extract_strings(value)

    def _dedupe_sections(self, sections: list[str], limit: int = 10000) -> str:
        deduped: list[str] = []
        seen: set[str] = set()
        total_length = 0

        for section in sections:
            normalized = " ".join(section.split())
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(section.strip())
            total_length += len(section)
            if total_length >= limit:
                break

        return "\n\n".join(deduped)[:limit]

    def _is_thin_context(self, context: str) -> bool:
        return len(context.strip()) < 240

    async def _retrieve_context(
        self,
        kb_name: str,
        mode: str,
        topic: str | None,
        candidates: list[dict[str, str]],
    ) -> tuple[str, str | None]:
        if mode == "topic":
            queries = [
                topic or "",
                f"{topic or ''} key concepts examples common mistakes".strip(),
                f"{topic or ''} foundational explanation".strip(),
            ]
        else:
            queries = [
                "knowledge base overview core concepts",
                "fundamentals main topics learning path",
                "advanced ideas applications common pitfalls",
            ]

        sections: list[str] = []
        for idx, query in enumerate(queries, 1):
            if not query:
                continue
            try:
                result = await self.rag_service.search(query=query, kb_name=kb_name, mode="hybrid")
            except Exception:
                continue

            text = self._dedupe_sections(self._extract_retrieval_text(result), limit=4000)
            if text:
                sections.append(f"## Retrieval {idx}\n{text}")
            if len("\n\n".join(sections)) >= 9000:
                break

        warning = None
        context = self._dedupe_sections(sections, limit=9000)
        if self._is_thin_context(context):
            selected = candidates[:4]
            if mode == "topic" and topic:
                selected = self._select_topic_context(candidates, topic) or selected
            fallback_context = self._format_context(selected)
            context = self._dedupe_sections([context, fallback_context], limit=9000)
            warning = (
                f'The selected knowledge base "{kb_name}" returned limited grounding '
                f'for "{topic or "the current curriculum"}". The plan may include light generic补全.'
            )

        return context, warning

    def _build_prompt(
        self,
        kb_name: str,
        mode: str,
        topic: str | None,
        context: str,
        source_notes: str | None = None,
    ) -> str:
        mode_label = "topic-driven" if mode == "topic" else "curriculum-wide"
        topic_label = topic or "(entire knowledge base)"
        review_notes = (source_notes or "").strip()
        review_notes_block = f"\n\n复习材料（来自笔记/错题）:\n{review_notes[:3000]}" if review_notes else ""

        if str(self.language).lower().startswith("zh"):
            return f"""你是一位学习规划师。请基于知识库内容生成循序渐进的学习路径。

知识库: {kb_name}
模式: {mode_label}
主题: {topic_label}

可用知识内容:
{context}{review_notes_block}

请输出 JSON 对象，格式如下：
{{
  "knowledge_points": [
    {{
      "knowledge_title": "知识点标题",
      "knowledge_summary": "详细解释，必须基于上面的知识内容",
      "user_difficulty": "用户可能遇到的难点"
    }}
  ]
}}

要求：
1. topic 模式时只围绕给定主题组织学习路径。
2. curriculum 模式时按从基础到进阶的顺序覆盖整个知识库。
3. 输出 3-6 个知识点；如果内容不足，可输出 1-2 个，但必须保持可学习。
4. 不要编造和知识内容无关的主题。
5. 优先依照检索到的知识库内容；只有内容偏少时才允许少量常识性补全，并保持明确、克制。"""

        review_notes_block_en = (
            f"\n\nReview materials (from notebook/error notes):\n{review_notes[:3000]}"
            if review_notes
            else ""
        )

        return f"""You are a learning planner. Build a progressive guided-learning plan from the knowledge base content below.

Knowledge base: {kb_name}
Mode: {mode_label}
Topic: {topic_label}

Available content:
{context}{review_notes_block_en}

Return a JSON object in this shape:
{{
  "knowledge_points": [
    {{
      "knowledge_title": "Knowledge point title",
      "knowledge_summary": "Detailed explanation grounded in the knowledge base content",
      "user_difficulty": "Likely learner difficulty"
    }}
  ]
}}

Requirements:
1. In topic mode, stay focused on the requested topic.
2. In curriculum mode, produce a full learning route from fundamentals to advanced ideas.
3. Return 3-6 knowledge points when possible.
4. Do not invent content unrelated to the supplied knowledge base material.
5. Prioritize the retrieved KB context; only use light generic supplementation when the KB context is thin."""

    async def process(
        self,
        kb_name: str,
        mode: str,
        topic: str | None = None,
        source_notes: str | None = None,
    ) -> dict[str, Any]:
        """
        Generate a guided-learning plan from KB content.

        Args:
            kb_name: Knowledge base name.
            mode: "topic" or "curriculum".
            topic: Optional topic for topic mode.

        Returns:
            Dict containing knowledge points or a structured failure.
        """
        kb_name = (kb_name or "").strip()
        mode = (mode or "topic").strip().lower()
        topic = (topic or "").strip()
        review_notes = (source_notes or "").strip()

        if not kb_name and not review_notes:
            return {
                "success": False,
                "code": "knowledge_base_required",
                "error": "Knowledge base is required",
                "knowledge_points": [],
            }
        kb_display_name = kb_name or "Notebook Review Notes"

        if mode not in {"topic", "curriculum"}:
            return {
                "success": False,
                "code": "guide_mode_invalid",
                "error": f"Unsupported guide mode: {mode}",
                "knowledge_points": [],
            }

        if mode == "topic" and not topic:
            return {
                "success": False,
                "code": "topic_required",
                "error": "Topic is required for topic mode",
                "knowledge_points": [],
            }

        grounding_warning = None
        if kb_name:
            candidates = await asyncio.to_thread(self._load_content_candidates, kb_name)
            if not candidates:
                return {
                    "success": False,
                    "code": "knowledge_not_found",
                    "error": f"No usable KB content found for '{kb_display_name}'",
                    "knowledge_points": [],
                }

            context, grounding_warning = await self._retrieve_context(
                kb_name=kb_name,
                mode=mode,
                topic=topic or None,
                candidates=candidates,
            )
        else:
            context = review_notes[:9000]
        if not context.strip():
            return {
                "success": False,
                "code": "knowledge_not_found",
                "error": f"No usable KB context found for '{kb_display_name}'",
                "knowledge_points": [],
            }
        prompt = self._build_prompt(
            kb_name=kb_display_name,
            mode=mode,
            topic=topic or None,
            context=context,
            source_notes=source_notes,
        )

        try:
            response = await self.call_llm(
                user_prompt=prompt,
                system_prompt="Return only valid JSON.",
                response_format={"type": "json_object"},
                max_tokens=3072,
                stage="guide_plan",
            )
        except Exception as e:
            return {
                "success": False,
                "code": "guide_plan_failed",
                "error": str(e),
                "knowledge_points": [],
            }

        try:
            result = json.loads(response)
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "code": "guide_plan_parse_failed",
                "error": f"JSON parsing failed: {e!s}",
                "knowledge_points": [],
            }

        raw_points = []
        if isinstance(result, dict):
            raw_points = result.get("knowledge_points") or result.get("points") or []
        elif isinstance(result, list):
            raw_points = result

        validated_points = []
        for point in raw_points:
            if not isinstance(point, dict):
                continue
            title = (point.get("knowledge_title") or point.get("title") or "").strip()
            summary = (point.get("knowledge_summary") or point.get("summary") or "").strip()
            difficulty = (point.get("user_difficulty") or point.get("difficulty") or "").strip()
            if not title or not summary:
                continue
            validated_points.append(
                {
                    "knowledge_title": title,
                    "knowledge_summary": summary,
                    "user_difficulty": difficulty,
                }
            )

        if not validated_points:
            return {
                "success": False,
                "code": "knowledge_not_found",
                "error": "No valid knowledge points could be generated from the selected knowledge base.",
                "knowledge_points": [],
            }

        return {
            "success": True,
            "knowledge_points": validated_points,
            "total_points": len(validated_points),
            "grounding_warning": grounding_warning,
        }
