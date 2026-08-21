import asyncio
import json
from types import SimpleNamespace

from src.agents.solve.analysis_loop.investigate_agent import InvestigateAgent
from src.agents.solve.main_solver import MainSolver
from src.agents.solve.memory import (
    CitationMemory,
    InvestigateMemory,
    KnowledgeItem,
    SolveChainStep,
    SolveMemory,
    ToolCallRecord,
)
from src.agents.solve.solve_loop.manager_agent import ManagerAgent
from src.agents.solve.solve_loop.solve_agent import SolveAgent


def _solver_config():
    return {
        "system": {"language": "en"},
        "tools": {"web_search": {"enabled": True}},
        "solve": {
            "max_solve_correction_iterations": 3,
            "enable_citations": True,
            "agents": {
                "investigate_agent": {
                    "max_actions_per_round": 2,
                    "max_iterations": 4,
                },
                "precision_answer_agent": {"enabled": True},
            },
        },
        "agents": {
            "investigate_agent": {
                "max_actions_per_round": 2,
                "max_iterations": 4,
            },
            "precision_answer_agent": {"enabled": True},
        },
    }


def test_manager_agent_appends_verification_step_for_calculation_question():
    agent = ManagerAgent(_solver_config(), "test-key", "https://example.invalid")
    steps = [
        SolveChainStep(
            step_id="S1",
            role="Calculation",
            step_target="Calculation: Solve the equation",
            available_cite=["[k-1]"],
        )
    ]

    updated = agent._ensure_verification_step("Solve x^2 = 4", steps)

    assert len(updated) == 2
    assert updated[-1].role == "Verification"
    assert updated[-1].available_cite == ["[k-1]"]


def test_investigate_agent_prefers_kb_before_web_search(tmp_path, monkeypatch):
    async def _run():
        agent = InvestigateAgent(_solver_config(), "test-key", "https://example.invalid")
        memory = InvestigateMemory(
            output_dir=str(tmp_path), user_question="What is gradient descent?"
        )
        citation_memory = CitationMemory(output_dir=str(tmp_path))
        captured_tools: list[str] = []

        async def fake_call_llm(*args, **kwargs):
            del args, kwargs
            return json.dumps(
                {
                    "reasoning": "Need a definition.",
                    "knowns": ["The user asks about gradient descent."],
                    "unknowns": ["Definition"],
                    "constraints": [],
                    "required_evidence": ["Gradient descent definition"],
                    "covered_evidence": [],
                    "unavailable_evidence": [],
                    "should_stop": False,
                    "plan": [{"tool": "web_search", "query": "gradient descent definition"}],
                }
            )

        async def fake_execute(
            tool_selection, query, identifier, kb_name, output_dir, citation_memory
        ):
            del identifier, kb_name, output_dir, citation_memory
            captured_tools.append(tool_selection)
            return KnowledgeItem(
                cite_id="[rag-1]",
                tool_type=tool_selection,
                query=query,
                raw_result="Gradient descent is an optimization algorithm.",
                metadata={"source_bucket": "kb"},
            )

        monkeypatch.setattr(agent, "call_llm", fake_call_llm)
        monkeypatch.setattr(agent, "_execute_single_action", fake_execute)

        result = await agent.process(
            question="What is gradient descent?",
            memory=memory,
            citation_memory=citation_memory,
            kb_name="stats_kb",
            output_dir=str(tmp_path),
            verbose=False,
        )

        assert result["should_stop"] is False
        assert captured_tools == ["rag_hybrid"]
        assert memory.metadata["used_web_fallback"] is False
        assert memory.metadata["grounding_strength"] == "high"

    asyncio.run(_run())


def test_investigate_agent_batches_citation_save_once(tmp_path, monkeypatch):
    async def _run():
        agent = InvestigateAgent(_solver_config(), "test-key", "https://example.invalid")
        memory = InvestigateMemory(output_dir=str(tmp_path), user_question="Need two facts")
        citation_memory = CitationMemory(output_dir=str(tmp_path))
        save_calls = 0

        async def fake_call_llm(*args, **kwargs):
            del args, kwargs
            return json.dumps(
                {
                    "reasoning": "Need two pieces of KB evidence.",
                    "knowns": [],
                    "unknowns": ["Fact A", "Fact B"],
                    "constraints": [],
                    "required_evidence": ["Fact A", "Fact B"],
                    "covered_evidence": [],
                    "unavailable_evidence": [],
                    "should_stop": False,
                    "plan": [
                        {"tool": "rag_naive", "query": "fact a"},
                        {"tool": "rag_hybrid", "query": "fact b"},
                    ],
                }
            )

        async def fake_call_rag_naive(query, kb_name, output_dir):
            del kb_name, output_dir
            return {"answer": f"KB answer for {query}"}

        async def fake_call_rag_hybrid(query, kb_name, output_dir):
            del kb_name, output_dir
            return {"answer": f"KB answer for {query}"}

        original_save = citation_memory.save

        def counted_save():
            nonlocal save_calls
            save_calls += 1
            return original_save()

        monkeypatch.setattr(agent, "call_llm", fake_call_llm)
        monkeypatch.setattr(agent, "_call_rag_naive", fake_call_rag_naive)
        monkeypatch.setattr(agent, "_call_rag_hybrid", fake_call_rag_hybrid)
        monkeypatch.setattr(citation_memory, "save", counted_save)

        await agent.process(
            question="Need two facts",
            memory=memory,
            citation_memory=citation_memory,
            kb_name="stats_kb",
            output_dir=str(tmp_path),
            verbose=False,
        )

        assert save_calls == 1
        assert len(citation_memory.citations) == 2

    asyncio.run(_run())


def test_solve_agent_forces_code_execution_for_verification_step_without_evidence(
    tmp_path, monkeypatch
):
    async def _run():
        agent = SolveAgent(_solver_config(), "test-key", "https://example.invalid")
        current_step = SolveChainStep(
            step_id="S1",
            role="Verification",
            step_target="Verification: Check the claimed answer.",
        )
        solve_memory = SolveMemory(output_dir=str(tmp_path), user_question="What is 2 + 2?")
        solve_memory.create_chains([current_step])
        investigate_memory = InvestigateMemory(user_question="What is 2 + 2?")
        citation_memory = CitationMemory(output_dir=str(tmp_path))

        async def fake_call_llm(*args, **kwargs):
            del args, kwargs
            return json.dumps(
                {
                    "thoughts": "I can answer directly.",
                    "tool_calls": [{"type": "none", "intent": "The answer is 4."}],
                }
            )

        monkeypatch.setattr(agent, "call_llm", fake_call_llm)

        result = await agent.process(
            question="What is 2 + 2?",
            current_step=current_step,
            solve_memory=solve_memory,
            investigate_memory=investigate_memory,
            citation_memory=citation_memory,
            kb_name="math_kb",
            output_dir=None,
            verbose=False,
        )

        assert result["requested_calls"]
        assert result["requested_calls"][0]["tool_type"] == "code_execution"

    asyncio.run(_run())


def test_main_solver_suppresses_concise_answer_when_verification_fails():
    solver = MainSolver(api_key="test-key", base_url="https://example.invalid")
    content = solver._compose_final_answer_content(
        detailed_answer="The detailed answer says the result is 5.",
        verification_result={
            "passed": False,
            "confidence": 0.2,
            "issues": ["Independent verification disagrees with the result."],
            "corrected_result": "$x = 2$",
        },
        precision_result={"needs_precision": True, "precision_answer": "$x = 2$"},
    )

    assert "Verification Warning" in content
    assert "Concise Answer" not in content
    assert "$x = 2$" in content


def test_main_solver_selects_precision_source_from_corrected_result():
    solver = MainSolver(api_key="test-key", base_url="https://example.invalid")
    selected = solver._select_precision_source(
        detailed_answer="Unverified detailed answer",
        verification_result={"corrected_result": "$x = 2$"},
    )

    assert selected == "$x = 2$"


def test_main_solver_does_not_trigger_code_verification_for_numbered_reference_only():
    solver = MainSolver(api_key="test-key", base_url="https://example.invalid")

    should_verify = solver._should_use_code_verification("Explain theorem 2.1.2", [])

    assert should_verify is False


def test_main_solver_reuses_existing_verification_code_output(tmp_path):
    async def _run():
        solver = MainSolver(api_key="test-key", base_url="https://example.invalid")
        solver.config = {"system": {"language": "en"}}
        tool_agent_called = False
        captured_code_result = ""

        async def fake_run_code_intent(*args, **kwargs):
            nonlocal tool_agent_called
            del args, kwargs
            tool_agent_called = True
            return "", {}

        async def fake_verify(**kwargs):
            nonlocal captured_code_result
            captured_code_result = kwargs["code_verification_result"]
            return {
                "passed": True,
                "confidence": 0.9,
                "issues": [],
                "corrected_result": "",
                "evidence_basis": [],
            }

        solver.tool_agent = SimpleNamespace(run_code_intent=fake_run_code_intent)
        solver.verification_agent = SimpleNamespace(process=fake_verify)

        step = SolveChainStep(
            step_id="S2",
            role="Verification",
            step_target="Verification: Check the result.",
            tool_calls=[
                ToolCallRecord(
                    tool_type="code_execution",
                    query="verify",
                    raw_answer="Existing code verification output",
                    summary="Existing code verification output",
                    status="success",
                )
            ],
            step_response="Verification step response",
            status="done",
        )
        investigate_memory = InvestigateMemory(
            output_dir=str(tmp_path), user_question="What is 2+2?"
        )
        citation_memory = CitationMemory(output_dir=str(tmp_path))

        result = await solver._run_final_verification(
            question="What is 2+2?",
            detailed_answer="The answer is 4.",
            completed_step_objs=[step],
            investigate_memory=investigate_memory,
            citation_memory=citation_memory,
            citation_summary="",
            output_dir=str(tmp_path),
            used_cite_ids=[],
        )

        assert result["passed"] is True
        assert captured_code_result == "Existing code verification output"
        assert tool_agent_called is False

    asyncio.run(_run())


def test_main_solver_normalizes_latex_code_blocks_and_delimiters():
    solver = MainSolver(api_key="test-key", base_url="https://example.invalid")

    normalized = solver._normalize_math_markdown(
        "Here is a block:\n```latex\nx = y + 1\n```\nAnd inline \\(a+b\\).\nAnd block \\[c=d\\]."
    )

    assert "```latex" not in normalized
    assert "$$\nx = y + 1\n$$" in normalized
    assert "$a+b$" in normalized
    assert "$$\nc=d\n$$" in normalized
