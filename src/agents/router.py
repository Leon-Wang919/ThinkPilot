from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from src.config.accessors import get_subject_config, normalize_subject
from src.agents.teacher.workflow import TeacherWorkflow


class Subject(str, Enum):
    LIBERAL_ARTS = "liberal_arts"
    SCIENCE = "science"
    ENGINEERING = "engineering"


class Mode(str, Enum):
    TEACHER = "teacher"
    STUDENT = "student"


@dataclass
class SubjectRoute:
    subject: Subject
    mode: Mode
    workflow: TeacherWorkflow


class SubjectRouter:
    def __init__(self, project_root: Path | None = None):
        self.project_root = project_root

    def route(
        self,
        subject: str | Subject,
        mode: str | Mode,
        query: str = "",
        language: str = "zh",
    ) -> TeacherWorkflow:
        del query  # Reserved for future routing heuristics.
        subject_name = normalize_subject(subject.value if isinstance(subject, Subject) else subject)
        mode_value = mode if isinstance(mode, Mode) else Mode(mode)
        if mode_value is not Mode.TEACHER:
            raise NotImplementedError("Student routing is planned for the next phase.")
        return TeacherWorkflow(
            subject=subject_name,
            language=language,
            subject_config=get_subject_config(subject_name, self.project_root),
        )
