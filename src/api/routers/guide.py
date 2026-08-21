"""
Guided Learning API Router
==========================

Provides session creation, learning progress management, and chat interaction.
"""

import inspect
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from src.api.utils.health import build_health_payload

project_root = Path(__file__).parent.parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from src.agents.base_agent import BaseAgent
from src.agents.guide.guide_manager import GuideManager
from src.api.utils.task_id_manager import TaskIDManager
from src.knowledge.manager import KnowledgeBaseManager
from src.services.config import load_config_with_main
from src.services.llm import get_llm_config
from src.services.settings.interface_settings import get_ui_language
from src.tlogging import get_logger

router = APIRouter()

# Initialize logger with config
project_root = Path(__file__).parent.parent.parent.parent
config = load_config_with_main("guide_config.yaml", project_root)
log_dir = config.get("paths", {}).get("user_log_dir") or config.get("logging", {}).get("log_dir")
logger = get_logger("Guide", level="INFO", log_dir=log_dir)


# === Request/Response Models ===


class CreateSessionRequest(BaseModel):
    """Create session request"""

    kb_name: str
    mode: str = "topic"
    topic: str | None = None
    subject: str = "science"
    source_notes: str | None = None
    source_label: str | None = None


class ChatRequest(BaseModel):
    """Chat request"""

    session_id: str
    message: str


class FixHtmlRequest(BaseModel):
    """Fix HTML request"""

    session_id: str
    bug_description: str


class NextKnowledgeRequest(BaseModel):
    """Next knowledge point request"""

    session_id: str


# === Helper Functions ===


@router.get("/health")
async def health():
    return build_health_payload("guide")


def get_guide_manager():
    """Get GuideManager instance"""
    try:
        llm_config = get_llm_config()
        api_key = llm_config.api_key
        base_url = llm_config.base_url
        api_version = getattr(llm_config, "api_version", None)
        binding = llm_config.binding
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM config error: {e!s}")

    ui_language = get_ui_language(default=config.get("system", {}).get("language", "en"))
    return GuideManager(
        api_key=api_key,
        base_url=base_url,
        api_version=api_version,
        language=ui_language,
        binding=binding,
    )  # Read from config file


def get_kb_manager() -> KnowledgeBaseManager:
    return KnowledgeBaseManager(base_dir=str(project_root / "data" / "knowledge_bases"))


def _guide_error(status_code: int, code: str, message: str, **details):
    raise HTTPException(
        status_code=status_code,
        detail={
            "success": False,
            "code": code,
            "message": message,
            "details": details,
        },
    )


def _validate_kb_for_guide(kb_name: str) -> dict:
    kb_name = (kb_name or "").strip()
    if not kb_name:
        _guide_error(400, "knowledge_base_required", "A knowledge base must be selected.")

    manager = get_kb_manager()
    if kb_name not in manager.list_knowledge_bases():
        _guide_error(
            404,
            "knowledge_base_unavailable",
            f"Knowledge base '{kb_name}' was not found.",
            kb_name=kb_name,
        )

    info = manager.get_info(kb_name)
    statistics = info.get("statistics", {}) if isinstance(info, dict) else {}
    status = statistics.get("status") or info.get("status")
    rag_initialized = bool(statistics.get("rag_initialized"))
    rag_provider = statistics.get("rag_provider")

    if status != "ready" or not rag_initialized or not rag_provider:
        _guide_error(
            409,
            "knowledge_base_unavailable",
            "The selected knowledge base is not ready for guided learning.",
            kb_name=kb_name,
            status=status,
            rag_initialized=rag_initialized,
            rag_provider=rag_provider,
            progress=statistics.get("progress") or info.get("progress"),
        )

    return info


# === REST API Endpoints ===


@router.post("/create_session")
async def create_session(request: CreateSessionRequest):
    """
    Create a new guided learning session.

    Returns:
        Session creation result with knowledge point list.
    """
    task_manager = TaskIDManager.get_instance()

    try:
        kb_name = (request.kb_name or "").strip()
        mode = (request.mode or "topic").strip().lower()
        topic = (request.topic or "").strip() or None

        if mode not in {"topic", "curriculum"}:
            _guide_error(400, "guide_mode_invalid", "Guide mode must be 'topic' or 'curriculum'.")

        if mode == "topic" and not topic:
            _guide_error(400, "topic_required", "Topic mode requires a topic or chapter name.")

        _validate_kb_for_guide(kb_name)

        # Reset LLM stats for new session
        BaseAgent.reset_stats("guide")

        manager = get_guide_manager()
        create_kwargs = {
            "kb_name": kb_name,
            "mode": mode,
            "topic": topic,
        }
        create_parameters = inspect.signature(manager.create_session).parameters
        if "subject" in create_parameters:
            create_kwargs["subject"] = request.subject
        if "source_notes" in create_parameters and request.source_notes is not None:
            create_kwargs["source_notes"] = request.source_notes
        if "source_label" in create_parameters and request.source_label is not None:
            create_kwargs["source_label"] = request.source_label
        result = await manager.create_session(
            **create_kwargs,
        )

        if not result.get("success"):
            code = result.get("code", "guide_session_create_failed")
            message = result.get("message") or result.get("error") or "Failed to create guide session"
            _guide_error(400, code, message, kb_name=kb_name, mode=mode, topic=topic)

        if result and "session_id" in result:
            session_id = result["session_id"]
            task_id = task_manager.generate_task_id("guide", session_id)
            logger.info(f"[{task_id}] Session created: {session_id}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create session failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_learning(request: NextKnowledgeRequest):
    """
    Start learning (get the first knowledge point).
    """
    try:
        manager = get_guide_manager()
        result = await manager.start_learning(request.session_id)
        return result
    except Exception as e:
        logger.error(f"Start learning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/next")
async def next_knowledge(request: NextKnowledgeRequest):
    """
    Move to the next knowledge point.
    """
    try:
        manager = get_guide_manager()
        result = await manager.next_knowledge(request.session_id)

        # Print stats if learning completed
        if result.get("learning_complete", False):
            BaseAgent.print_stats("guide")

        return result
    except Exception as e:
        logger.error(f"Next knowledge failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/previous")
async def previous_knowledge(request: NextKnowledgeRequest):
    """
    Move back to the previous knowledge point.
    """
    try:
        manager = get_guide_manager()
        result = await manager.previous_knowledge(request.session_id)
        return result
    except Exception as e:
        logger.error(f"Previous knowledge failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Send a chat message.
    """
    try:
        manager = get_guide_manager()
        result = await manager.chat(request.session_id, request.message)
        return result
    except Exception as e:
        logger.error(f"Chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fix_html")
async def fix_html(request: FixHtmlRequest):
    """
    Fix HTML page bugs.
    """
    try:
        manager = get_guide_manager()
        result = await manager.fix_html(request.session_id, request.bug_description)
        return result
    except Exception as e:
        logger.error(f"Fix HTML failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """
    Get session information.
    """
    try:
        manager = get_guide_manager()
        session = manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get session failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/html")
async def get_current_html(session_id: str):
    """
    Get the current HTML page.
    """
    try:
        manager = get_guide_manager()
        html = manager.get_current_html(session_id)
        if html is None:
            raise HTTPException(status_code=404, detail="Session not found or no HTML content")
        return {"html": html}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get HTML failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === WebSocket Endpoint ===


@router.websocket("/ws/{session_id}")
async def websocket_guide(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time interaction.

    Message types:
    - start: Start learning
    - next: Next knowledge point
    - chat: Send chat message
    - fix_html: Fix HTML
    - get_session: Get session state
    """
    await websocket.accept()

    task_manager = TaskIDManager.get_instance()
    task_id = task_manager.generate_task_id("guide", session_id)

    try:
        await websocket.send_json({"type": "task_id", "task_id": task_id})
    except (RuntimeError, WebSocketDisconnect, ConnectionError) as e:
        logger.debug(f"Failed to send task_id: {e}")

    try:
        manager = get_guide_manager()

        session = manager.get_session(session_id)
        if not session:
            await websocket.send_json({"type": "error", "content": "Session not found"})
            await websocket.close()
            return

        logger.info(f"[{task_id}] Guide session started: {session_id}")

        await websocket.send_json({"type": "session_info", "data": session})

        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type", "")

                if msg_type == "start":
                    logger.debug(f"[{task_id}] Start learning")
                    result = await manager.start_learning(session_id)
                    await websocket.send_json({"type": "start_result", "data": result})

                elif msg_type == "next":
                    logger.debug(f"[{task_id}] Next knowledge point")
                    result = await manager.next_knowledge(session_id)
                    await websocket.send_json({"type": "next_result", "data": result})

                elif msg_type == "previous":
                    logger.debug(f"[{task_id}] Previous knowledge point")
                    result = await manager.previous_knowledge(session_id)
                    await websocket.send_json({"type": "previous_result", "data": result})

                elif msg_type == "chat":
                    message = data.get("message", "")
                    if message:
                        logger.debug(f"[{task_id}] User message: {message[:50]}...")
                        result = await manager.chat(session_id, message)
                        await websocket.send_json({"type": "chat_result", "data": result})

                elif msg_type == "fix_html":
                    bug_desc = data.get("bug_description", "")
                    logger.debug(f"[{task_id}] Fix HTML: {bug_desc[:50]}...")
                    result = await manager.fix_html(session_id, bug_desc)
                    await websocket.send_json({"type": "fix_result", "data": result})

                elif msg_type == "get_session":
                    session = manager.get_session(session_id)
                    await websocket.send_json({"type": "session_info", "data": session})

                else:
                    await websocket.send_json(
                        {"type": "error", "content": f"Unknown message type: {msg_type}"}
                    )

            except WebSocketDisconnect:
                logger.debug(f"WebSocket disconnected: {session_id}")
                break
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                await websocket.send_json({"type": "error", "content": str(e)})

    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect, ConnectionError):
            pass  # Connection already closed


@router.get("/health")
async def health_check():
    """Health check"""
    return {"status": "healthy", "service": "guide"}

