from __future__ import annotations

from typing import Any

from .base import TeacherBaseAgent


class QuestionAgent(TeacherBaseAgent):
    def __init__(self, language: str = "zh"):
        super().__init__(agent_name="question_agent", language=language)

    async def process(
        self,
        question: str,
        subject: str,
        teaching_mode: str,
        explanation: str,
    ) -> dict[str, Any]:
        if self.language == "zh":
            user_prompt = f"""
学科：{subject}
教学模式：{teaching_mode}
原始问题：{question}

当前讲解：
{explanation}

返回 JSON：
{{
  "socratic_questions": ["一个简明的跟进问题"]
}}

只问一个考察理解程度的问题，不要只是简单复述。请用中文提问。
"""
        else:
            user_prompt = f"""
Subject: {subject}
Teaching mode: {teaching_mode}
Original question: {question}

Current explanation:
{explanation}

Return JSON:
{{
  "socratic_questions": ["one concise follow-up question"]
}}

Ask exactly one question that tests understanding rather than simple repetition.
"""
        raw = await self.call_completion(subject, user_prompt, "socratic", max_tokens=800)
        parsed = self.parse_json(raw)
        questions = [
            str(item).strip()
            for item in parsed.get("socratic_questions", [])
            if str(item).strip()
        ]
        if not questions:
            questions = [self._fallback(subject, teaching_mode)]
        return {"socratic_questions": questions}

    def _fallback(self, subject: str, teaching_mode: str) -> str:
        if self.language == "zh":
            if subject == "liberal_arts":
                return "讲解中哪个论点最关键？支持它的证据是什么？"
            if subject == "engineering":
                return "如果你要实现这个想法，首先会测试哪个边界情况？"
            if teaching_mode == "solve":
                return "如果问题的某个前提条件改变了，哪一步会最先出错？"
            return "你能用自己的话复述一下核心思路，并解释为什么它重要吗？"
        if subject == "liberal_arts":
            return "Which claim in the explanation is doing the most work, and what evidence supports it?"
        if subject == "engineering":
            return "If you had to implement this idea, which boundary case would you test first?"
        if teaching_mode == "solve":
            return "Which step would break first if one assumption in the problem changed?"
        return "Can you restate the core idea in your own words and explain why it matters?"

