import asyncio

from src.agents.guide.guide_manager import GuideManager


class _FakeLocateAgent:
    def __init__(self, kb_base_dir, knowledge_points):
        self.kb_base_dir = kb_base_dir
        self.knowledge_points = knowledge_points
        self.calls = 0

    def get_model(self):
        return "fake-guide-model"

    async def process(self, kb_name: str, mode: str, topic: str | None = None):
        self.calls += 1
        return {
            "success": True,
            "knowledge_points": list(self.knowledge_points),
            "total_points": len(self.knowledge_points),
        }


class _FakeInteractiveAgent:
    def __init__(self):
        self.calls: list[str] = []
        self.contexts: list[str] = []
        self.warnings: list[str | None] = []

    async def process(
        self,
        knowledge,
        kb_context: str = "",
        source_label: str = "",
        grounding_warning: str | None = None,
        retry_with_bug: str | None = None,
    ):
        del source_label
        del retry_with_bug
        title = knowledge["knowledge_title"]
        self.calls.append(title)
        self.contexts.append(kb_context)
        self.warnings.append(grounding_warning)
        return {"success": True, "html": f"<html><body>{title}</body></html>"}


class _FakeChatAgent:
    def __init__(self):
        self.contexts: list[str] = []
        self.questions: list[str] = []

    async def process(
        self,
        knowledge,
        chat_history,
        user_question,
        kb_context: str = "",
        source_label: str = "",
        grounding_warning: str | None = None,
    ):
        del knowledge, chat_history, source_label, grounding_warning
        self.contexts.append(kb_context)
        self.questions.append(user_question)
        return {"success": True, "answer": "ok"}


class _FakeSummaryAgent:
    async def process(self, source_label, knowledge_points, chat_history):
        del source_label, knowledge_points, chat_history
        return {"summary": "done"}


class _FakeRAGService:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls: list[tuple[str, str, str]] = []

    async def search(self, query: str, kb_name: str, mode: str = "hybrid", **kwargs):
        del kwargs
        self.calls.append((kb_name, mode, query))
        for needle, response in self.responses.items():
            if needle in query:
                return response
        return {"content": f"{kb_name}: grounded context for {query}"}


def _build_manager(tmp_path, kb_root, knowledge_points, rag_responses=None):
    manager = GuideManager(
        api_key="test-key",
        base_url="https://example.invalid",
        output_dir=str(tmp_path / "guide-output"),
        language="en",
    )
    manager.locate_agent = _FakeLocateAgent(kb_root, knowledge_points)
    manager.interactive_agent = _FakeInteractiveAgent()
    manager.chat_agent = _FakeChatAgent()
    manager.summary_agent = _FakeSummaryAgent()
    manager.rag_service = _FakeRAGService(rag_responses)
    return manager


def test_guide_plan_cache_reuses_previous_result(tmp_path):
    async def _run():
        kb_root = tmp_path / "kbs"
        (kb_root / "stats_kb" / "raw").mkdir(parents=True)
        (kb_root / "stats_kb" / "raw" / "intro.txt").write_text(
            "likelihood basics", encoding="utf-8"
        )

        knowledge_points = [
            {
                "knowledge_title": "Likelihood",
                "knowledge_summary": "Measure how well parameters explain data.",
                "user_difficulty": "Connecting the formula to intuition.",
            }
        ]

        manager1 = _build_manager(tmp_path, kb_root, knowledge_points)
        result1 = await manager1.create_session("stats_kb", "topic", "Likelihood")

        manager2 = _build_manager(tmp_path, kb_root, knowledge_points)
        result2 = await manager2.create_session("stats_kb", "topic", "Likelihood")

        assert result1["success"] is True
        assert result1["cache_hit"] is False
        assert manager1.locate_agent.calls == 1

        assert result2["success"] is True
        assert result2["cache_hit"] is True
        assert manager2.locate_agent.calls == 0
        assert result2["knowledge_points"] == knowledge_points

    asyncio.run(_run())


def test_guide_prefetches_current_and_next_html(tmp_path):
    async def _run():
        kb_root = tmp_path / "kbs"
        (kb_root / "stats_kb" / "raw").mkdir(parents=True)
        (kb_root / "stats_kb" / "raw" / "intro.txt").write_text("foundations", encoding="utf-8")

        knowledge_points = [
            {
                "knowledge_title": "Point 1",
                "knowledge_summary": "Summary 1",
                "user_difficulty": "Difficulty 1",
            },
            {
                "knowledge_title": "Point 2",
                "knowledge_summary": "Summary 2",
                "user_difficulty": "Difficulty 2",
            },
            {
                "knowledge_title": "Point 3",
                "knowledge_summary": "Summary 3",
                "user_difficulty": "Difficulty 3",
            },
        ]

        manager = _build_manager(tmp_path, kb_root, knowledge_points)
        create_result = await manager.create_session("stats_kb", "curriculum")
        session_id = create_result["session_id"]

        await asyncio.sleep(0.05)
        session = manager._load_session(session_id)
        assert session is not None
        assert session.rendered_html[0] == "<html><body>Point 1</body></html>"
        assert manager.interactive_agent.calls == ["Point 1"]
        assert "grounded context" in manager.interactive_agent.contexts[0]

        start_result = await manager.start_learning(session_id)
        await asyncio.sleep(0.05)
        session = manager._load_session(session_id)

        assert start_result["html"] == "<html><body>Point 1</body></html>"
        assert session.current_html == "<html><body>Point 1</body></html>"
        assert session.rendered_html[1] == "<html><body>Point 2</body></html>"
        assert manager.interactive_agent.calls == ["Point 1", "Point 2"]

        next_result = await manager.next_knowledge(session_id)
        await asyncio.sleep(0.05)
        session = manager._load_session(session_id)

        assert next_result["html"] == "<html><body>Point 2</body></html>"
        assert session.current_html == "<html><body>Point 2</body></html>"
        assert session.rendered_html[2] == "<html><body>Point 3</body></html>"
        assert manager.interactive_agent.calls == ["Point 1", "Point 2", "Point 3"]

    asyncio.run(_run())


def test_guide_chat_uses_selected_kb_grounding(tmp_path):
    async def _run():
        kb_root = tmp_path / "kbs"
        (kb_root / "stats_kb" / "raw").mkdir(parents=True)
        (kb_root / "stats_kb" / "raw" / "intro.txt").write_text("bayes", encoding="utf-8")

        knowledge_points = [
            {
                "knowledge_title": "Bayes Rule",
                "knowledge_summary": "Posterior is proportional to likelihood times prior.",
                "user_difficulty": "Connecting priors to intuition.",
            }
        ]

        manager = _build_manager(
            tmp_path,
            kb_root,
            knowledge_points,
            rag_responses={
                "Bayes Rule": {"content": "KB-only explanation of Bayes Rule."},
                "How": {"content": "KB-only explanation of Bayes Rule for the user question."},
            },
        )
        create_result = await manager.create_session("stats_kb", "topic", "Bayes Rule")
        session_id = create_result["session_id"]

        await manager.start_learning(session_id)
        chat_result = await manager.chat(session_id, "How does the prior affect the posterior?")

        assert chat_result["success"] is True
        assert chat_result["answer"] == "ok"
        assert manager.chat_agent.contexts
        assert "KB-only explanation of Bayes Rule" in manager.chat_agent.contexts[-1]
        assert manager.rag_service.calls[-1][0] == "stats_kb"

    asyncio.run(_run())
