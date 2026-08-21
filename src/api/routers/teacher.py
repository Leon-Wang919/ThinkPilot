from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.agents.router import SubjectRouter
from src.agents.teacher.session_manager import TeacherSessionManager
from src.agents.teacher.turn_service import TeacherTurnService
from src.api.utils.health import build_health_payload
from src.config.accessors import get_default_subject, list_subject_configs, normalize_subject
from src.knowledge.manager import KnowledgeBaseManager
from src.services.settings.interface_settings import get_ui_language

router = APIRouter()

project_root = Path(__file__).resolve().parents[3]
kb_manager = KnowledgeBaseManager(base_dir=str(project_root / "data" / "knowledge_bases"))
teacher_sessions = TeacherSessionManager()
subject_router = SubjectRouter(project_root=project_root)


class TeacherChatRequest(BaseModel):
    subject: str = Field(default_factory=get_default_subject)
    kb_name: str | None = None
    session_id: str | None = None
    message: str


class TeacherSolveRequest(BaseModel):
    subject: str = Field(default_factory=get_default_subject)
    kb_name: str | None = None
    session_id: str | None = None
    question: str


@router.get("/health")
async def health():
    return build_health_payload("teacher")


@router.get("/subjects")
async def get_subjects():
    configs = list_subject_configs(project_root)
    default_subject = get_default_subject(project_root)
    return {
        "default_subject": default_subject,
        "subjects": {
            subject: config.model_dump()
            for subject, config in configs.items()
        },
    }


@router.get("/knowledge-bases")
async def list_teacher_knowledge_bases(subject: str):
    subject_name = normalize_subject(subject)
    return {
        "subject": subject_name,
        "default_kb": kb_manager.get_default_for_subject(subject_name),
        "knowledge_bases": kb_manager.list_subject_knowledge_bases(subject_name),
    }


@router.get("/sessions")
async def list_teacher_sessions(subject: str | None = None, limit: int = 20):
    subject_name = normalize_subject(subject) if subject else None
    return teacher_sessions.list_sessions(subject=subject_name, limit=limit)


@router.get("/sessions/{session_id}")
async def get_teacher_session(session_id: str):
    session = teacher_sessions.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}")
async def delete_teacher_session(session_id: str):
    if not teacher_sessions.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}


def _get_turn_service() -> TeacherTurnService:
    return TeacherTurnService(
        subject_router=subject_router,
        session_manager=teacher_sessions,
    )


@router.post("/chat")
async def teacher_chat(request: TeacherChatRequest):
    subject = normalize_subject(request.subject)
    kb_name = request.kb_name or kb_manager.get_default_for_subject(subject) or ""
    language = get_ui_language(default="en")
    result = await _get_turn_service().run_turn(
        input_text=request.message,
        subject=subject,
        kb_name=kb_name,
        preferred_mode="explain-first",
        language=language,
        session_id=request.session_id,
    )
    return result


@router.post("/solve")
async def teacher_solve(request: TeacherSolveRequest):
    subject = normalize_subject(request.subject)
    kb_name = request.kb_name or kb_manager.get_default_for_subject(subject) or ""
    language = get_ui_language(default="en")
    result = await _get_turn_service().run_turn(
        input_text=request.question,
        subject=subject,
        kb_name=kb_name,
        preferred_mode="solve-first",
        language=language,
        session_id=request.session_id,
    )
    return result
