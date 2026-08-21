import asyncio

from src.graphs.teacher.graph import run_teacher_turn


def test_run_teacher_turn_returns_graph_contract(monkeypatch):
    class _FakeGraph:
        async def ainvoke(self, initial_state):
            assert initial_state["subject"] == "science"
            assert initial_state["preferred_mode"] == "solve-first"
            assert initial_state["awaiting_student_response"] is False
            return {
                "final_answer": "### Teacher Walkthrough\n\nUse Bayes' rule step by step.",
                "subject": "science",
                "kb_name": "数理统计",
                "topic": "Bayes rule",
                "teaching_mode": "solve",
                "step_plan": ["Define the events", "Apply Bayes' rule"],
                "socratic_questions": ["Why do we condition on the observed event?"],
                "current_step": 1,
                "active_step_index": 0,
                "awaiting_student_response": True,
                "pending_prompt": "Why do we condition on the observed event?",
                "turn_kind": "initial",
                "mastery_signals": {},
                "student_responses": [],
                "solve_explanation": "Use Bayes' rule step by step.",
            }

    monkeypatch.setattr(
        "src.graphs.teacher.graph.build_teacher_graph", lambda language="zh": _FakeGraph()
    )

    result = asyncio.run(
        run_teacher_turn(
            question="Use Bayes rule on this problem",
            subject="science",
            kb_name="数理统计",
            preferred_mode="solve-first",
        )
    )

    assert result["teaching_mode"] == "solve"
    assert result["step_plan"] == ["Define the events", "Apply Bayes' rule"]
    assert result["socratic_questions"] == ["Why do we condition on the observed event?"]
    assert result["current_step"] == 1
    assert result["awaiting_student_response"] is True


def test_teacher_graph_advances_on_strong_student_response(monkeypatch):
    async def fake_teach_process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
        messages=None,
    ):
        return {
            "topic": "Bayes rule",
            "explanation": f"Explain: {question[:40]}",
        }

    async def fake_solve_process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
    ):
        return {
            "topic": "Bayes rule",
            "step_plan": ["Define the events", "Apply Bayes' rule"],
            "explanation": "Overall walkthrough",
        }

    async def fake_question_process(
        self,
        question: str,
        subject: str,
        teaching_mode: str,
        explanation: str,
    ):
        if "Define the events" in question:
            return {"socratic_questions": ["What event are we conditioning on?"]}
        return {"socratic_questions": ["What changes in the numerator now?"]}

    monkeypatch.setattr("src.agents.teacher.teach_agent.TeachAgent.process", fake_teach_process)
    monkeypatch.setattr(
        "src.agents.teacher.solve_agent.TeacherSolveAgent.process",
        fake_solve_process,
    )
    monkeypatch.setattr(
        "src.agents.teacher.question_agent.QuestionAgent.process",
        fake_question_process,
    )

    first = asyncio.run(
        run_teacher_turn(
            question="Use Bayes rule on this problem",
            subject="science",
            kb_name="数理统计",
            preferred_mode="solve-first",
        )
    )

    second = asyncio.run(
        run_teacher_turn(
            question="We condition on the observed event because it changes the sample space.",
            subject="science",
            kb_name="数理统计",
            preferred_mode="solve-first",
            teacher_state=first["teacher_state"],
        )
    )

    assert first["current_step"] == 1
    assert second["current_step"] == 2
    assert second["awaiting_student_response"] is True
    assert second["teacher_state"]["active_step_index"] == 1


def test_teacher_graph_retries_on_weak_student_response(monkeypatch):
    async def fake_teach_process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
        messages=None,
    ):
        return {
            "topic": "Bayes rule",
            "explanation": f"Explain: {question[:40]}",
        }

    async def fake_solve_process(
        self,
        question: str,
        subject: str,
        kb_name: str,
        knowledge_context: str = "",
    ):
        return {
            "topic": "Bayes rule",
            "step_plan": ["Define the events", "Apply Bayes' rule"],
            "explanation": "Overall walkthrough",
        }

    async def fake_question_process(
        self,
        question: str,
        subject: str,
        teaching_mode: str,
        explanation: str,
    ):
        return {"socratic_questions": ["What event are we conditioning on?"]}

    monkeypatch.setattr("src.agents.teacher.teach_agent.TeachAgent.process", fake_teach_process)
    monkeypatch.setattr(
        "src.agents.teacher.solve_agent.TeacherSolveAgent.process",
        fake_solve_process,
    )
    monkeypatch.setattr(
        "src.agents.teacher.question_agent.QuestionAgent.process",
        fake_question_process,
    )

    first = asyncio.run(
        run_teacher_turn(
            question="Use Bayes rule on this problem",
            subject="science",
            kb_name="数理统计",
            preferred_mode="solve-first",
        )
    )

    second = asyncio.run(
        run_teacher_turn(
            question="Not sure",
            subject="science",
            kb_name="数理统计",
            preferred_mode="solve-first",
            teacher_state=first["teacher_state"],
        )
    )

    assert second["current_step"] == 1
    assert second["teacher_state"]["turn_kind"] == "retry"
    assert second["awaiting_student_response"] is True
