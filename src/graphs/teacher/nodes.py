from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from src.knowledge.manager import KnowledgeBaseManager
from src.services.config import PROJECT_ROOT
from src.services.rag.service import RAGService


def infer_teaching_mode(preferred_mode: str, query: str) -> str:
    if preferred_mode == "solve-first":
        return "solve"

    query_lower = query.lower()
    solve_markers = ("solve", "calculate", "derive", "proof", "证明", "求", "计算")
    if any(marker in query_lower for marker in solve_markers):
        return "solve"
    return "teach"


def normalize_step_plan(step_plan: list[str] | None) -> list[str]:
    if not step_plan:
        return []
    return [step.strip() for step in step_plan if str(step).strip()]


def build_teach_step_plan(topic: str, subject: str, language: str = "zh") -> list[str]:
    topic_text = topic.strip() or ("这个主题" if language == "zh" else "this topic")
    if language == "zh":
        if subject == "liberal_arts":
            return [
                f"阐述 {topic_text} 背后的核心论点。",
                "将该论点与最有力的支撑证据或示例联系起来。",
            ]
        if subject == "engineering":
            return [
                f"解释 {topic_text} 背后的核心机制。",
                "检验一个实现细节或边界情况的影响。",
            ]
        return [
            f"解释 {topic_text} 的核心思想。",
            "验证当某个假设条件改变时，该思想是否仍然成立。",
        ]
    if subject == "liberal_arts":
        return [
            f"State the central claim behind {topic_text}.",
            "Connect that claim to the strongest supporting evidence or example.",
        ]
    if subject == "engineering":
        return [
            f"Explain the core mechanism behind {topic_text}.",
            "Check one implementation or boundary-case implication.",
        ]
    return [
        f"Explain the core idea behind {topic_text}.",
        "Check whether the idea still works when one assumption changes.",
    ]


def get_current_step_text(step_plan: list[str], active_step_index: int, topic: str, language: str = "zh") -> str:
    normalized = normalize_step_plan(step_plan)
    if normalized and 0 <= active_step_index < len(normalized):
        return normalized[active_step_index]
    fallback_topic = topic.strip() or ("这个主题" if language == "zh" else "this topic")
    if language == "zh":
        return f"解释 {fallback_topic} 的核心思想。"
    return f"Explain the core idea behind {fallback_topic}."


def evaluate_student_response(
    response: str,
    *,
    topic: str,
    current_step: str,
    pending_prompt: str = "",
    language: str = "zh",
) -> dict[str, Any]:
    text = response.strip()
    if not text:
        feedback = (
            "学生没有提供足够的细节来验证理解程度。"
            if language == "zh"
            else "The student did not provide enough detail to verify understanding."
        )
        return {
            "passed": False,
            "score": 0,
            "feedback": feedback,
        }

    lowered = text.lower()
    keywords = _extract_keywords(" ".join([topic, current_step, pending_prompt]))
    overlap = sum(1 for keyword in keywords if keyword in lowered)
    score = 0
    if len(text) >= 24 or len(text.split()) >= 8:
        score += 1
    if overlap >= 1:
        score += 1
    if any(token in lowered for token in ("because", "therefore", "so", "means", "因为", "所以", "说明")):
        score += 1

    passed = score >= 2
    if language == "zh":
        feedback = (
            "学生的回答与关键步骤相关联，并给出了足够的推理，可以继续下一步。"
            if passed
            else "回答仍然太简略或与当前步骤脱节，老师需要重新讲解后再继续。"
        )
    else:
        feedback = (
            "The student connected the response to the key step and gave enough reasoning to move on."
            if passed
            else "The response is still too thin or disconnected from the current step, so the teacher should re-explain before advancing."
        )
    return {
        "passed": passed,
        "score": score,
        "feedback": feedback,
        "keyword_overlap": overlap,
    }


def _extract_keywords(text: str) -> set[str]:
    tokens = {
        token
        for token in re.findall(r"[\w\u4e00-\u9fff]+", text.lower())
        if len(token) >= 3
    }
    return tokens


async def build_teacher_context(
    kb_name: str,
    query: str,
    project_root: Path | None = None,
) -> str:
    root = project_root or PROJECT_ROOT
    kb_manager = KnowledgeBaseManager(base_dir=str(Path(root) / "data" / "knowledge_bases"))
    sections: list[str] = []

    if kb_name:
        try:
            rag_service = RAGService(kb_base_dir=str(kb_manager.base_dir))
            result = await rag_service.search(query=query, kb_name=kb_name, mode="hybrid")
            if isinstance(result, dict):
                for value in result.values():
                    if isinstance(value, str) and value.strip():
                        sections.append(value.strip())
                    elif isinstance(value, list):
                        sections.extend(
                            str(item).strip() for item in value if str(item).strip()
                        )
        except Exception:
            pass

        try:
            info = kb_manager.get_info(kb_name)
            metadata = info.get("metadata", {})
            if isinstance(metadata, dict):
                title = metadata.get("name") or metadata.get("title") or kb_name
                description = metadata.get("description") or metadata.get("summary") or ""
                sections.append(f"{title}\n{description}".strip())
        except Exception:
            pass

    deduped: list[str] = []
    seen = set()
    for section in sections:
        normalized = " ".join(section.split())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(section)

    return "\n\n".join(deduped)[:4000]
