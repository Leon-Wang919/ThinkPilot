from __future__ import annotations

from typing import Any

from .base import TeacherBaseAgent


class TeachAgent(TeacherBaseAgent):
    def __init__(self, language: str = "zh"):
        super().__init__(agent_name="teach_agent", language=language)

    async def process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
        messages: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        history = "\n".join(
            f"{message.get('role', 'user')}: {message.get('content', '')}"
            for message in (messages or [])[-6:]
        )
        if self.language == "zh":
            no_kb = "（未选择）"
            no_ctx = "（无可用的辅助知识。）"
            no_hist = "（无历史对话。）"
            user_prompt = f"""
问题：{question}
学科：{subject}
知识库：{kb_name or no_kb}

知识上下文：
{knowledge_context or no_ctx}

近期对话：
{history or no_hist}

请用中文写一段简明的教学回复，要求：
1. 先给出核心思路，
2. 由浅入深地解释关键概念，
3. 保持耐心辅导的语气，
4. 不要编造知识库中没有的内容。
"""
        else:
            user_prompt = f"""
Question: {question}
Subject: {subject}
Knowledge base: {kb_name or "(not selected)"}

Knowledge context:
{knowledge_context or "(No grounding context available.)"}

Recent history:
{history or "(No prior history.)"}

Write a concise teaching response that:
1. starts with the core idea,
2. explains the key concept progressively,
3. keeps the tone like a patient tutor,
4. avoids pretending the knowledge base said more than it did.
"""
        response = await self.call_completion(subject, user_prompt, max_tokens=2400)
        explanation = response.strip() or self._fallback(question, subject, kb_name, knowledge_context)
        return {
            "topic": question.strip()[:120],
            "explanation": explanation,
        }

    def _fallback(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str,
    ) -> str:
        if self.language == "zh":
            context_note = (
                f"已选知识库：`{kb_name}`。\n\n参考摘录：\n{knowledge_context[:600]}"
                if knowledge_context
                else "所选知识库未返回有力的参考资料，以下是保守解释。"
            )
            return (
                f"### 教师讲解\n\n"
                f"我将从 `{subject}` 的角度来解释这道题。\n\n"
                f"问题：{question}\n\n"
                f"{context_note}\n\n"
                "先找到核心概念，然后将每个细节回扣到该概念上。"
            )
        context_note = (
            f"Selected KB: `{kb_name}`.\n\nGrounding excerpt:\n{knowledge_context[:600]}"
            if knowledge_context
            else "The selected knowledge base did not return strong grounding, so this is a conservative explanation."
        )
        return (
            f"### Teacher Explanation\n\n"
            f"I will explain this from the perspective of `{subject}`.\n\n"
            f"Question: {question}\n\n"
            f"{context_note}\n\n"
            "Start by identifying the central concept, then connect each detail back to that concept."
        )

