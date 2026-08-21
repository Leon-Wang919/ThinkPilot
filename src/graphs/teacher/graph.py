from __future__ import annotations

from typing import Any

from src.agents.teacher.question_agent import QuestionAgent
from src.agents.teacher.response_agent import ResponseAgent
from src.agents.teacher.session_manager import build_default_teacher_state
from src.agents.teacher.solve_agent import TeacherSolveAgent
from src.agents.teacher.teach_agent import TeachAgent
from src.graphs.builder import GraphBuilder
from src.graphs.teacher.nodes import (
    build_teach_step_plan,
    build_teacher_context,
    evaluate_student_response,
    get_current_step_text,
    infer_teaching_mode,
    normalize_step_plan,
)
from src.graphs.teacher.state import TeacherState


def build_teacher_graph(language: str = "zh") -> Any:
    teach_agent = TeachAgent(language=language)
    solve_agent = TeacherSolveAgent(language=language)
    question_agent = QuestionAgent(language=language)
    response_agent = ResponseAgent(language=language)

    async def assess_turn_node(state: TeacherState) -> dict[str, Any]:
        topic = str(state.get("topic") or state.get("current_query", "")).strip()[:120]
        preferred_mode = state.get("preferred_mode", "explain-first")
        teaching_mode = state.get("teaching_mode") or infer_teaching_mode(
            preferred_mode,
            topic or state.get("current_query", ""),
        )
        step_plan = normalize_step_plan(state.get("step_plan", []))
        active_step_index = int(state.get("active_step_index", 0) or 0)
        if step_plan:
            active_step_index = max(0, min(active_step_index, len(step_plan) - 1))
        else:
            active_step_index = 0
        current_step = int(state.get("current_step", 0) or 0)
        if current_step <= 0 and step_plan:
            current_step = active_step_index + 1
        return {
            "topic": topic or state.get("current_query", "")[:120],
            "teaching_mode": teaching_mode,
            "step_plan": step_plan,
            "active_step_index": active_step_index,
            "current_step": current_step,
            "turn_kind": state.get("turn_kind", "initial"),
        }

    async def locate_knowledge_node(state: TeacherState) -> dict[str, Any]:
        kb_name = state.get("kb_name", "")
        query = state.get("topic") or state.get("current_query", "")
        context = await build_teacher_context(kb_name=kb_name, query=query)
        return {"rag_context": context}

    async def assess_student_response_node(state: TeacherState) -> dict[str, Any]:
        current_step_text = get_current_step_text(
            state.get("step_plan", []),
            int(state.get("active_step_index", 0) or 0),
            state.get("topic", ""),
            language=language,
        )
        mastery = evaluate_student_response(
            state.get("current_query", ""),
            topic=state.get("topic", ""),
            current_step=current_step_text,
            pending_prompt=state.get("pending_prompt", ""),
            language=language,
        )
        student_responses = list(state.get("student_responses", []))
        if state.get("current_query", "").strip():
            student_responses.append(state["current_query"].strip())
        return {
            "student_responses": student_responses,
            "mastery_signals": mastery,
        }

    async def prepare_turn_node(state: TeacherState) -> dict[str, Any]:
        topic = state.get("topic", "") or state.get("current_query", "")[:120]
        subject = state.get("subject", "science")
        teaching_mode = state.get("teaching_mode", "teach")
        step_plan = normalize_step_plan(state.get("step_plan", []))
        active_step_index = int(state.get("active_step_index", 0) or 0)
        current_step = int(state.get("current_step", 0) or 0)
        solve_explanation = state.get("solve_explanation", "")
        turn_kind = state.get("turn_kind", "initial")

        if state.get("awaiting_student_response"):
            if (state.get("mastery_signals") or {}).get("passed"):
                if teaching_mode == "solve" and step_plan:
                    active_step_index = min(active_step_index + 1, len(step_plan) - 1)
                    current_step = active_step_index + 1
                    turn_kind = "follow_up"
                else:
                    active_step_index = 0
                    current_step = 1 if step_plan else 0
                    turn_kind = "follow_up"
            else:
                turn_kind = "retry"

        if teaching_mode == "solve":
            if not step_plan:
                result = await solve_agent.process(
                    question=topic or state.get("current_query", ""),
                    subject=subject,
                    kb_name=state.get("kb_name", ""),
                    knowledge_context=state.get("rag_context", ""),
                )
                step_plan = normalize_step_plan(result.get("step_plan"))
                solve_explanation = result.get("explanation", "")
                topic = result.get("topic", topic) or topic
                active_step_index = 0
                current_step = 1 if step_plan else 0
                turn_kind = "initial"
        else:
            if not step_plan:
                step_plan = build_teach_step_plan(topic, subject, language=language)
            active_step_index = 0
            current_step = 1 if step_plan else 0

        return {
            "topic": topic,
            "step_plan": step_plan,
            "solve_explanation": solve_explanation,
            "active_step_index": active_step_index,
            "current_step": current_step,
            "turn_kind": turn_kind,
            "awaiting_student_response": False,
            "pending_prompt": "",
            "socratic_questions": [],
        }

    async def explain_current_step_node(state: TeacherState) -> dict[str, Any]:
        step_plan = normalize_step_plan(state.get("step_plan", []))
        active_step_index = int(state.get("active_step_index", 0) or 0)
        current_step_text = get_current_step_text(
            step_plan,
            active_step_index,
            state.get("topic", ""),
            language=language,
        )
        retry_prefix = ""
        if state.get("turn_kind") == "retry":
            retry_prefix = (
                "学生的回答不够完整。请更具体地重新讲解同一步骤，然后再提出检查问题。\n\n"
                if language == "zh"
                else "The student response was incomplete. Re-explain the same step more concretely "
                "before asking the next check question.\n\n"
            )
        if state.get("teaching_mode") == "solve":
            if language == "zh":
                question = (
                    f"{retry_prefix}原始问题：{state.get('topic', '')}\n"
                    f"当前步骤：{current_step_text}\n"
                    f"已有解题框架：\n{state.get('solve_explanation', '')}"
                )
            else:
                question = (
                    f"{retry_prefix}Original problem: {state.get('topic', '')}\n"
                    f"Current step: {current_step_text}\n"
                    f"Existing solution outline:\n{state.get('solve_explanation', '')}"
                )
        else:
            if language == "zh":
                question = (
                    f"{retry_prefix}主题：{state.get('topic', '')}\n"
                    f"当前检查点：{current_step_text}\n"
                    "请解释这个概念，让学生能回答一个简短的理解检查问题。"
                )
            else:
                question = (
                    f"{retry_prefix}Topic: {state.get('topic', '')}\n"
                    f"Current checkpoint: {current_step_text}\n"
                    "Explain the concept so the student can answer a short understanding check."
                )
        result = await teach_agent.process(
            question=question,
            subject=state.get("subject", "science"),
            kb_name=state.get("kb_name", ""),
            knowledge_context=state.get("rag_context", ""),
            messages=state.get("messages", []),
        )
        return {
            "final_answer": result.get("explanation", ""),
            "topic": state.get("topic", ""),
        }

    async def ask_socratic_question_node(state: TeacherState) -> dict[str, Any]:
        step_plan = normalize_step_plan(state.get("step_plan", []))
        current_step_text = get_current_step_text(
            step_plan,
            int(state.get("active_step_index", 0) or 0),
            state.get("topic", ""),
            language=language,
        )
        result = await question_agent.process(
            question=current_step_text,
            subject=state.get("subject", "science"),
            teaching_mode=state.get("teaching_mode", "teach"),
            explanation=state.get("final_answer", "") or state.get("solve_explanation", ""),
        )
        questions = result.get("socratic_questions", [])[:1]
        return {
            "socratic_questions": questions,
            "pending_prompt": questions[-1] if questions else "",
            "awaiting_student_response": bool(questions),
        }

    async def summarize_turn_node(state: TeacherState) -> dict[str, Any]:
        step_plan = normalize_step_plan(state.get("step_plan", []))
        current_step_text = get_current_step_text(
            step_plan,
            int(state.get("active_step_index", 0) or 0),
            state.get("topic", ""),
            language=language,
        )
        result = await response_agent.process(
            question=state.get("topic", "") or state.get("current_query", ""),
            subject=state.get("subject", "science"),
            teaching_mode=state.get("teaching_mode", "teach"),
            explanation=state.get("final_answer", "") or state.get("solve_explanation", ""),
            step_plan=step_plan,
            socratic_questions=state.get("socratic_questions", []),
            knowledge_context=state.get("rag_context", ""),
            kb_name=state.get("kb_name", ""),
            current_step=state.get("current_step", 0),
            current_step_text=current_step_text,
            awaiting_student_response=bool(state.get("awaiting_student_response", False)),
            mastery_feedback=(state.get("mastery_signals") or {}).get("feedback", ""),
            turn_kind=state.get("turn_kind", "initial"),
            session_complete=False,
        )
        return {
            "final_answer": result.get("response", ""),
            "awaiting_student_response": bool(state.get("awaiting_student_response", False)),
            "turn_kind": state.get("turn_kind", "initial"),
            "should_continue": True,
        }

    async def complete_session_node(state: TeacherState) -> dict[str, Any]:
        step_plan = normalize_step_plan(state.get("step_plan", []))
        current_step_text = get_current_step_text(
            step_plan,
            int(state.get("active_step_index", 0) or 0),
            state.get("topic", ""),
            language=language,
        )
        if language == "zh":
            fallback_msg = f"关于 {state.get('topic', '这个主题')} 的课程已完成。"
        else:
            fallback_msg = f"The session on {state.get('topic', 'this topic')} is complete."
        summary_seed = (
            state.get("solve_explanation", "")
            or state.get("final_answer", "")
            or fallback_msg
        )
        final_step = len(step_plan) if step_plan else max(int(state.get("current_step", 0) or 0), 1)
        result = await response_agent.process(
            question=state.get("topic", "") or state.get("current_query", ""),
            subject=state.get("subject", "science"),
            teaching_mode=state.get("teaching_mode", "teach"),
            explanation=summary_seed,
            step_plan=step_plan,
            socratic_questions=[],
            knowledge_context=state.get("rag_context", ""),
            kb_name=state.get("kb_name", ""),
            current_step=final_step,
            current_step_text=current_step_text,
            awaiting_student_response=False,
            mastery_feedback=(state.get("mastery_signals") or {}).get("feedback", ""),
            turn_kind="summary",
            session_complete=True,
        )
        return {
            "final_answer": result.get("response", ""),
            "current_step": final_step,
            "active_step_index": max(final_step - 1, 0),
            "awaiting_student_response": False,
            "pending_prompt": "",
            "socratic_questions": [],
            "turn_kind": "summary",
            "should_continue": False,
        }

    def needs_response_assessment(state: TeacherState) -> str:
        if state.get("awaiting_student_response") and state.get("current_query", "").strip():
            return "assess"
        return "prepare"

    def after_assessment(state: TeacherState) -> str:
        mastery = state.get("mastery_signals") or {}
        if not mastery.get("passed"):
            return "retry"
        if state.get("teaching_mode") != "solve":
            return "complete"
        step_plan = normalize_step_plan(state.get("step_plan", []))
        active_step_index = int(state.get("active_step_index", 0) or 0)
        if not step_plan or active_step_index + 1 >= len(step_plan):
            return "complete"
        return "advance"

    builder = GraphBuilder(TeacherState, name="teacher")
    builder.add_node("assess_turn", assess_turn_node)
    builder.add_node("locate_knowledge", locate_knowledge_node)
    builder.add_node("assess_student_response", assess_student_response_node)
    builder.add_node("prepare_turn", prepare_turn_node)
    builder.add_node("explain_current_step", explain_current_step_node)
    builder.add_node("ask_socratic_question", ask_socratic_question_node)
    builder.add_node("summarize_turn", summarize_turn_node)
    builder.add_node("complete_session", complete_session_node)
    builder.set_entry("assess_turn")
    builder.add_edge("assess_turn", "locate_knowledge")
    builder.add_conditional_edge(
        "locate_knowledge",
        needs_response_assessment,
        {"assess": "assess_student_response", "prepare": "prepare_turn"},
    )
    builder.add_conditional_edge(
        "assess_student_response",
        after_assessment,
        {
            "retry": "prepare_turn",
            "advance": "prepare_turn",
            "complete": "complete_session",
        },
    )
    builder.add_edge("prepare_turn", "explain_current_step")
    builder.add_edge("explain_current_step", "ask_socratic_question")
    builder.add_edge("ask_socratic_question", "summarize_turn")
    builder.set_finish("summarize_turn")
    builder.set_finish("complete_session")
    return builder.compile()


async def run_teacher_turn(
    question: str,
    subject: str,
    kb_name: str = "",
    preferred_mode: str = "explain-first",
    messages: list[dict[str, str]] | None = None,
    teacher_state: dict[str, Any] | None = None,
    language: str = "zh",
) -> dict[str, Any]:
    graph = build_teacher_graph(language=language)
    persisted_state = build_default_teacher_state(
        preferred_mode=preferred_mode,
        topic=(teacher_state or {}).get("topic", "") or question,
    )
    if teacher_state:
        persisted_state.update(teacher_state)

    initial_state: TeacherState = {
        "current_query": question,
        "subject": subject,
        "kb_name": kb_name,
        "preferred_mode": preferred_mode,
        "messages": messages or [],
        "language": language,
        "citations": [],
        "tool_results": [],
        "intermediate_steps": [],
        "should_continue": True,
        "stream_tokens": False,
        "teaching_mode": persisted_state.get("teaching_mode", "teach"),
        "topic": (persisted_state.get("topic") or question)[:120],
        "step_plan": normalize_step_plan(persisted_state.get("step_plan", [])),
        "current_step": int(persisted_state.get("current_step", 0) or 0),
        "active_step_index": int(persisted_state.get("active_step_index", 0) or 0),
        "awaiting_student_response": bool(
            persisted_state.get("awaiting_student_response", False)
        ),
        "pending_prompt": str(persisted_state.get("pending_prompt", "")),
        "turn_kind": str(persisted_state.get("turn_kind", "initial")),
        "mastery_signals": dict(persisted_state.get("mastery_signals", {}) or {}),
        "socratic_questions": list(persisted_state.get("socratic_questions", []) or []),
        "student_responses": list(persisted_state.get("student_responses", []) or []),
        "solve_explanation": str(persisted_state.get("solve_explanation", "")),
    }
    result = await graph.ainvoke(initial_state)
    step_plan = normalize_step_plan(result.get("step_plan", []))
    current_step = int(result.get("current_step", 0) or 0)
    final_teacher_state = {
        "teaching_mode": result.get("teaching_mode", "teach"),
        "step_plan": step_plan,
        "current_step": current_step,
        "active_step_index": int(result.get("active_step_index", 0) or 0),
        "awaiting_student_response": bool(result.get("awaiting_student_response", False)),
        "pending_prompt": str(result.get("pending_prompt", "")),
        "socratic_questions": list(result.get("socratic_questions", []) or []),
        "student_responses": list(result.get("student_responses", []) or []),
        "turn_kind": str(result.get("turn_kind", "initial")),
        "mastery_signals": dict(result.get("mastery_signals", {}) or {}),
        "topic": (result.get("topic") or question)[:120],
        "solve_explanation": str(result.get("solve_explanation", "")),
    }
    return {
        "response": result.get("final_answer", ""),
        "subject": result.get("subject", subject),
        "kb_name": result.get("kb_name", kb_name),
        "topic": result.get("topic", question[:120]),
        "teaching_mode": result.get("teaching_mode", "teach"),
        "step_plan": step_plan,
        "socratic_questions": list(result.get("socratic_questions", []) or []),
        "current_step": current_step,
        "awaiting_student_response": bool(result.get("awaiting_student_response", False)),
        "session_state": {
            "topic": result.get("topic", question[:120]),
            "preferred_mode": preferred_mode,
            "subject": result.get("subject", subject),
        },
        "teacher_state": final_teacher_state,
    }
