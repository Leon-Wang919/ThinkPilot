"""
Review API Router
=================

Unifies notebook-driven review workflows by reusing notebook and guide capabilities.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from src.agents.base_agent import BaseAgent
from src.api.routers.guide import get_guide_manager
from src.api.routers.knowledge import get_knowledge_notebook_service
from src.api.utils.notebook_manager import notebook_manager
from src.db.manager import get_db

router = APIRouter()


class CreateReviewSessionRequest(BaseModel):
    kb_name: str | None = None
    mode: str = "topic"
    topic: str | None = None
    subject: str = "science"
    source_label: str | None = None
    review_notes: str | None = None
    source_notes: str | None = None


class MarkMasteredRequest(BaseModel):
    entry_ids: list[str]
    mastered: bool = True


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "review"}


@router.get("/notebooks")
async def list_review_notebooks(query: str | None = None):
    try:
        notebooks = notebook_manager.list_notebooks(query=query)
        return {"notebooks": notebooks, "total": len(notebooks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/notebooks/{notebook_id}/records")
async def list_review_notebook_records(
    notebook_id: str,
    query: str | None = None,
    tag: str | None = None,
    record_type: str | None = None,
):
    try:
        notebook = notebook_manager.get_notebook(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        records = notebook_manager.search_records(
            notebook_id=notebook_id,
            query=query,
            tag=tag,
            record_type=record_type,
        )
        return {
            "notebook_id": notebook_id,
            "records": records,
            "total": len(records),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_review_files(
    kb_name: str,
    files: list[UploadFile] = File(...),
):
    """Upload review materials into KB-bound notebook via existing knowledge notebook service."""
    try:
        result = get_knowledge_notebook_service().upload_files(kb_name, files)
        if result["success_count"] + result.get("partial_count", 0) == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "No review files were uploaded successfully",
                    "results": result["results"],
                },
            )
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create_session")
async def create_review_session(request: CreateReviewSessionRequest):
    """Create a guided review session; internally reuses guide manager."""
    try:
        mode = (request.mode or "topic").strip().lower()
        if mode not in {"topic", "curriculum"}:
            raise HTTPException(status_code=400, detail="mode must be 'topic' or 'curriculum'")

        topic = (request.topic or "").strip() or None
        kb_name = (request.kb_name or "").strip()
        if mode == "topic" and not topic:
            raise HTTPException(status_code=400, detail="topic is required when mode='topic'")

        BaseAgent.reset_stats("guide")
        manager = get_guide_manager()
        effective_notes = (request.review_notes or request.source_notes or "").strip() or None
        result = await manager.create_session(
            kb_name=kb_name,
            mode=mode,
            topic=topic,
            subject=request.subject,
            source_notes=effective_notes,
            source_label=request.source_label or kb_name or "Notebook Review",
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mark_mastered")
async def mark_review_mastered(request: MarkMasteredRequest):
    """Mark error-book entries mastered/unmastered after review completion."""
    entry_ids = [entry_id.strip() for entry_id in request.entry_ids if entry_id and entry_id.strip()]
    if not entry_ids:
        return {"success": True, "updated": 0}

    try:
        db = get_db()
        placeholders = ",".join(["?" for _ in entry_ids])
        mastered_value = 1 if request.mastered else 0
        sql = f"""
            UPDATE error_entries
            SET mastered = ?,
                retry_count = retry_count + 1,
                last_retry_at = datetime('now'),
                updated_at = datetime('now')
            WHERE entry_id IN ({placeholders})
              AND user_id = 'default'
        """
        cursor = db.execute(sql, (mastered_value, *entry_ids))
        db.commit()
        return {
            "success": True,
            "updated": int(cursor.rowcount or 0),
            "mastered": request.mastered,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
