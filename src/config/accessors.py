from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from src.config.schema import SubjectConfig
from src.services.config import PROJECT_ROOT, load_config_with_main

SUPPORTED_SUBJECTS = ("liberal_arts", "science", "engineering")
DEFAULT_SUBJECT = "science"


def normalize_subject(subject: str | None) -> str:
    candidate = (subject or DEFAULT_SUBJECT).strip().lower()
    if candidate not in SUPPORTED_SUBJECTS:
        raise ValueError(
            f"Unsupported subject '{subject}'. Expected one of: {', '.join(SUPPORTED_SUBJECTS)}"
        )
    return candidate


@lru_cache(maxsize=8)
def _load_app_config(project_root_str: str) -> dict[str, Any]:
    return load_config_with_main("main.yaml", project_root=Path(project_root_str))


def get_default_subject(project_root: Path | None = None) -> str:
    root = project_root or PROJECT_ROOT
    config = _load_app_config(str(root))
    return normalize_subject(config.get("subjects", {}).get("default", DEFAULT_SUBJECT))


def get_subject_config(
    subject: str | None = None,
    project_root: Path | None = None,
) -> SubjectConfig:
    root = project_root or PROJECT_ROOT
    config = _load_app_config(str(root))
    subject_name = normalize_subject(subject or get_default_subject(root))
    main_subjects = config.get("subjects", {})
    agent_subjects = load_config_with_main("agents.yaml", root).get("subjects", {})
    merged = {
        **main_subjects.get(subject_name, {}),
        **agent_subjects.get(subject_name, {}),
    }
    return SubjectConfig.model_validate(merged)


def list_subject_configs(project_root: Path | None = None) -> dict[str, SubjectConfig]:
    return {
        subject: get_subject_config(subject, project_root)
        for subject in SUPPORTED_SUBJECTS
    }


class ConfigAccessor:
    def __init__(self, loader: Callable[[], dict]):
        self._loader = loader

    def llm_model(self) -> str:
        cfg = self._loader()
        return str(cfg.get("llm", {}).get("model", "Pro/Flash"))

    def llm_provider(self) -> str:
        cfg = self._loader()
        return str(cfg.get("llm", {}).get("provider", "openai"))

    def user_data_dir(self) -> str:
        cfg = self._loader()
        return str(cfg.get("paths", {}).get("user_data_dir", "./data/user"))

    def default_subject(self) -> str:
        cfg = self._loader()
        return normalize_subject(cfg.get("subjects", {}).get("default", DEFAULT_SUBJECT))

    def subject_config(self, subject: str | None = None) -> SubjectConfig:
        cfg = self._loader()
        subject_name = normalize_subject(subject or self.default_subject())
        main_subjects = cfg.get("subjects", {})
        return SubjectConfig.model_validate(main_subjects.get(subject_name, {}))

