import asyncio

from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import feynman as feynman_router
from src.graphs.feynman.graph import run_feynman_turn

client = TestClient(app)


def test_feynman_turn_minimal_request_no_longer_500(monkeypatch):
    async def fake_run_feynman_turn(**kwargs):
        assert kwargs["subject"] == "science"
        return {
            "response": "What happens after the gradient is computed?",
            "evaluation": {"clarity_score": 7, "completeness_score": 6},
            "logic_gaps": ["Missing update rule."],
            "is_report": False,
            "persona_info": {"name": "Curious Student", "emoji": "🧑‍🎓"},
        }

    monkeypatch.setattr(feynman_router, "run_feynman_turn", fake_run_feynman_turn)

    response = client.post(
        "/api/v1/feynman/turn",
        json={
            "topic": "Gradient descent",
            "user_explanation": "It is an optimization method.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["response"]
    assert payload["is_report"] is False
    assert payload["persona_info"]["name"] == "Curious Student"


def test_feynman_turn_supports_report_generation(monkeypatch):
    async def fake_run_feynman_turn(**kwargs):
        assert kwargs["subject"] == "engineering"
        assert kwargs["should_continue"] is False
        return {
            "response": "# Report\nYou should review the update rule.",
            "evaluation": {"clarity_score": 8, "completeness_score": 7},
            "logic_gaps": ["Need a clearer update equation."],
            "is_report": True,
            "persona_info": {"name": "Skeptical Peer", "emoji": "🤔"},
        }

    monkeypatch.setattr(feynman_router, "run_feynman_turn", fake_run_feynman_turn)

    response = client.post(
        "/api/v1/feynman/turn",
        json={
            "subject": "engineering",
            "topic": "Gradient descent",
            "user_explanation": "",
            "persona": "skeptical_peer",
            "messages": [{"role": "user", "content": "Here is my explanation"}],
            "logic_gaps": ["Need the update rule."],
            "iteration_count": 3,
            "max_iterations": 10,
            "should_continue": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_report"] is True
    assert payload["persona_info"]["name"] == "Skeptical Peer"


def test_run_feynman_turn_falls_back_to_default_persona(monkeypatch):
    class _FakeGraph:
        async def ainvoke(self, initial_state):
            return {
                "final_answer": "Can you give me an example?",
                "logic_gaps": ["No example provided."],
                "evaluation_report": {"clarity_score": 6, "completeness_score": 5},
                "current_node": "ask_followup",
            }

    monkeypatch.setattr(
        "src.graphs.feynman.graph.build_feynman_graph",
        lambda **kwargs: _FakeGraph(),
    )

    result = asyncio.run(
        run_feynman_turn(
            topic="Gradient descent",
            user_explanation="It finds a minimum.",
            persona="not_a_real_persona",
            should_continue=True,
        )
    )

    assert result["is_report"] is False
    assert result["persona_info"]["emoji"] == "🧑‍🎓"
    assert result["persona_info"]["name"] in {"Curious Student", "好奇学生"}


def test_feynman_turn_surfaces_backend_error(monkeypatch):
    async def fake_run_feynman_turn(**kwargs):
        raise RuntimeError("LLM config is missing")

    monkeypatch.setattr(feynman_router, "run_feynman_turn", fake_run_feynman_turn)

    response = client.post(
        "/api/v1/feynman/turn",
        json={
            "topic": "Gradient descent",
            "user_explanation": "It is an optimization method.",
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["message"] == "LLM config is missing"
