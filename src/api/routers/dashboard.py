from fastapi import APIRouter, HTTPException

from src.api.utils.health import build_health_payload
from src.api.utils.history import history_manager

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check."""
    return build_health_payload("dashboard")


@router.get("/recent")
async def get_recent_history(limit: int = 10, type: str | None = None):
    return history_manager.get_recent(limit, type)


@router.get("/{entry_id}")
async def get_history_entry(entry_id: str):
    entry = history_manager.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.delete("/{entry_id}")
async def delete_history_entry(entry_id: str):
    success = history_manager.delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"message": "Entry deleted successfully"}
