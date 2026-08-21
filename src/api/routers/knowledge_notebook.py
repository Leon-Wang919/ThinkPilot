"""
Unified Knowledge Base and Notebook API Router
============================================

Combines knowledge base and notebook functionality into a single router.
"""

from fastapi import APIRouter

from src.api.routers.knowledge import router as knowledge_router
from src.api.routers.notebook import router as notebook_router

router = APIRouter()

# Include both routers under the same prefix
router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])
router.include_router(notebook_router, prefix="/notebook", tags=["notebook"])


@router.get("/health")
async def health_check():
    """Health check endpoint for the unified knowledge and notebook service"""
    return {
        "status": "healthy",
        "service": "knowledge_notebook",
        "endpoints": {
            "knowledge": "/api/v1/knowledge",
            "notebook": "/api/v1/notebook"
        }
    }
