import pytest

from src.agents.router import Mode, SubjectRouter
from src.agents.teacher.workflow import TeacherWorkflow
from src.config.accessors import get_default_subject, get_subject_config, normalize_subject


def test_default_subject_comes_from_config():
    assert get_default_subject() == "science"


def test_get_subject_config_merges_agent_and_main_settings():
    config = get_subject_config("science")

    assert config.kb_name == "数理统计"
    assert config.default_behavior == "explain-first"
    assert config.max_tokens == 8192


def test_subject_router_returns_teacher_workflow():
    workflow = SubjectRouter().route("engineering", Mode.TEACHER)

    assert isinstance(workflow, TeacherWorkflow)
    assert workflow.subject == "engineering"


def test_normalize_subject_rejects_unknown_subject():
    with pytest.raises(ValueError):
        normalize_subject("history")
