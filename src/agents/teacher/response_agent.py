from __future__ import annotations

from typing import Any

from src.services.config import parse_language


class ResponseAgent:
    def __init__(self, language: str = "zh"):
        self.language = parse_language(language)

    async def process(
        self,
        question: str,
        subject: str,
        teaching_mode: str,
        explanation: str,
        step_plan: list[str] | None = None,
        socratic_questions: list[str] | None = None,
        knowledge_context: str = "",
        kb_name: str = "",
        current_step: int = 0,
        current_step_text: str = "",
        awaiting_student_response: bool = False,
        mastery_feedback: str = "",
        turn_kind: str = "initial",
        session_complete: bool = False,
    ) -> dict[str, Any]:
        zh = self.language == "zh"
        if zh:
            title = "解题过程" if teaching_mode == "solve" else "教师讲解"
        else:
            title = "Teacher Walkthrough" if teaching_mode == "solve" else "Teacher Explanation"
        sections = [f"### {title}", explanation.strip()]

        if current_step:
            label = "当前重点" if zh else "Current Focus"
            step_label = "步骤" if zh else "Step"
            sections.append(
                f"### {label}\n{step_label} {current_step}: {current_step_text or question.strip()}"
            )

        if mastery_feedback:
            label = "学习进度" if zh else "Progress Signal"
            sections.append(f"### {label}\n{mastery_feedback}")

        if step_plan:
            label = "解题步骤" if zh else "Step Plan"
            sections.append(
                f"### {label}\n"
                + "\n".join(
                    f"{index}. {step}" for index, step in enumerate(step_plan, start=1)
                )
            )

        if socratic_questions:
            label = "理解检查" if zh else "Socratic Check"
            sections.append(
                f"### {label}\n"
                + "\n".join(f"- {question}" for question in socratic_questions)
            )

        if session_complete:
            label = "课程状态" if zh else "Session Status"
            msg = (
                "本轮讲解已完成。你可以提出新问题，或回顾上方某个步骤。"
                if zh
                else "This lesson loop is complete. You can start a new prompt or revisit one of the steps above."
            )
            sections.append(f"### {label}\n{msg}")
        elif awaiting_student_response:
            label = "课程状态" if zh else "Session Status"
            msg = (
                "请先回答上面的理解检查，老师再进入下一步。"
                if zh
                else "Reply to the Socratic check before Teacher moves to the next step."
            )
            sections.append(f"### {label}\n{msg}")
        elif turn_kind == "retry":
            label = "课程状态" if zh else "Session Status"
            msg = (
                "老师停留在同一步骤，因为上次回答还需要更多推理。"
                if zh
                else "Teacher stayed on the same step because the last answer still needs more reasoning."
            )
            sections.append(f"### {label}\n{msg}")

        if knowledge_context:
            label = "参考来源" if zh else "Grounding Notes"
            kb_display = kb_name or ("所选知识库" if zh else "selected KB")
            sections.append(
                f"### {label}\n"
                f"使用知识库 `{kb_display}`。\n\n"
                f"{knowledge_context[:900]}"
                if zh
                else f"### {label}\n"
                f"Using knowledge base `{kb_display}`.\n\n"
                f"{knowledge_context[:900]}"
            )
        else:
            label = "参考来源" if zh else "Grounding Notes"
            msg = (
                "所选知识库未返回有力的参考资料，因此解释较为保守。"
                if zh
                else "The selected knowledge base did not return strong grounding, so the explanation stays conservative."
            )
            sections.append(f"### {label}\n{msg}")

        return {
            "response": "\n\n".join(section for section in sections if section),
            "question": question,
            "subject": subject,
            "teaching_mode": teaching_mode,
            "step_plan": step_plan or [],
            "socratic_questions": socratic_questions or [],
            "turn_kind": turn_kind,
        }
