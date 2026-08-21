from __future__ import annotations

from typing import Any

from .base import TeacherBaseAgent


class TeacherSolveAgent(TeacherBaseAgent):
    def __init__(self, language: str = "zh"):
        super().__init__(agent_name="solve_agent", language=language)

    async def process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
    ) -> dict[str, Any]:
        if self.language == "zh":
            no_kb = "（未选择）"
            no_ctx = "（无可用的辅助知识。）"
            user_prompt = f"""
问题：{question}
学科：{subject}
知识库：{kb_name or no_kb}

知识上下文：
{knowledge_context or no_ctx}

返回 JSON：
{{
  "topic": "简短的主题名称",
  "step_plan": ["步骤一", "步骤二", "步骤三"],
  "explanation": "教师风格的逐步讲解"
}}

要求（用中文回答）：
- 步骤计划要具体且有序。
- 可用的知识上下文要加以利用。
- 重解题过程，而非简短的最终答案。
"""
        else:
            user_prompt = f"""
Question: {question}
Subject: {subject}
Knowledge base: {kb_name or "(not selected)"}

Knowledge context:
{knowledge_context or "(No grounding context available.)"}

Return JSON with:
{{
  "topic": "short topic name",
  "step_plan": ["step 1", "step 2", "step 3"],
  "explanation": "teacher-style walkthrough"
}}

Requirements:
- Keep the step plan concrete and ordered.
- Use the knowledge context when available.
- Prefer explanation over terse final answers.
"""
        raw = await self.call_completion(subject, user_prompt, "explain_step", max_tokens=3200)
        parsed = self.parse_json(raw)

        step_plan = [
            str(step).strip()
            for step in parsed.get("step_plan", [])
            if str(step).strip()
        ]
        explanation = str(parsed.get("explanation", "")).strip()
        topic = str(parsed.get("topic", "")).strip() or question.strip()[:120]

        if not step_plan:
            step_plan = self._fallback_steps(question, subject)
        if not explanation:
            explanation = self._fallback_explanation(question, subject, kb_name, knowledge_context, step_plan)

        return {
            "topic": topic,
            "step_plan": step_plan,
            "explanation": explanation,
        }

    def _fallback_steps(self, question: str, subject: str) -> list[str]:
        if self.language == "zh":
            return [
                f"明确这道 {subject} 题目在问什么，找到目标量或论点。",
                "收集相关的定义、公式或约束条件。",
                "按顺序求解，并对照原题检查结果。",
            ]
        return [
            f"Clarify what the {subject} problem is asking and identify the target quantity or claim.",
            "Collect the relevant definitions, formulas, or constraints from the grounded context.",
            "Work through the solution in order and check the result against the original question.",
        ]

    def _fallback_explanation(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str,
        step_plan: list[str],
    ) -> str:
        steps = "\n".join(f"{index}. {step}" for index, step in enumerate(step_plan, start=1))
        context_excerpt = knowledge_context[:700] if knowledge_context else ""
        if self.language == "zh":
            context_excerpt = context_excerpt or "所选知识库未返回有力的参考资料。"
            return (
                f"### 解题过程\n\n"
                f"问题：{question}\n\n"
                f"学科：`{subject}`\n\n"
                f"知识库：`{kb_name or '未选择'}`\n\n"
                f"解题步骤：\n{steps}\n\n"
                f"参考摘录：\n{context_excerpt}"
            )
        context_excerpt = context_excerpt or "No strong KB grounding available."
        return (
            f"### Solve Walkthrough\n\n"
            f"Question: {question}\n\n"
            f"Subject: `{subject}`\n\n"
            f"Knowledge base: `{kb_name or 'not selected'}`\n\n"
            f"Planned steps:\n{steps}\n\n"
            f"Grounding excerpt:\n{context_excerpt}"
        )

