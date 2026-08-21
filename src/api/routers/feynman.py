"""
Feynman (Reverse Classroom) API Router
=======================================

POST /turn ?Process one teaching turn through the Feynman graph.
"""

from pathlib import Path
import traceback
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.api.utils.health import build_health_payload
from src.config.accessors import get_default_subject, normalize_subject
from src.graphs.feynman.graph import run_feynman_turn
from src.tlogging import get_logger
from src.services.llm.config import get_llm_config
from src.services.settings.interface_settings import get_ui_language
from src.services.config import load_config_with_main

project_root = Path(__file__).parent.parent.parent.parent
config = load_config_with_main("solve_config.yaml", project_root)
log_dir = config.get("paths", {}).get("user_log_dir") or config.get("logging", {}).get("log_dir")
logger = get_logger("FeynmanAPI", level="INFO", log_dir=log_dir)

router = APIRouter()


class FeynmanTurnRequest(BaseModel):
    subject: str = Field(default_factory=get_default_subject)
    topic: str
    user_explanation: str = ""
    locale: str | None = None
    persona: str = "curious_student"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    logic_gaps: list[str] = Field(default_factory=list)
    iteration_count: int = 0
    max_iterations: int = 10
    should_continue: bool = True
    generate_report: bool = False
    reference_notes: str | None = None
    reference_source_label: str | None = None


class FeynmanTurnResponse(BaseModel):
    response: str
    evaluation: dict[str, Any] = Field(default_factory=dict)
    logic_gaps: list[str] = Field(default_factory=list)
    is_report: bool = False
    persona_info: dict[str, str] = Field(default_factory=dict)


@router.get("/health")
async def health():
    return build_health_payload("feynman")


@router.post("/turn", response_model=FeynmanTurnResponse)
async def feynman_turn(request: FeynmanTurnRequest):
    """Process one Feynman teaching turn."""
    try:
        llm_config = get_llm_config()
        locale = (request.locale or "").lower()
        if locale.startswith("zh"):
            language = "zh"
        elif locale.startswith("en"):
            language = "en"
        else:
            language = get_ui_language(default=config.get("system", {}).get("language", "en"))
        should_continue = request.should_continue and not request.generate_report

        logger.info(
            f"Feynman turn: topic={request.topic} persona={request.persona} "
            f"iteration={request.iteration_count} should_continue={should_continue}"
        )

        result = await run_feynman_turn(
            subject=normalize_subject(request.subject),
            topic=request.topic,
            user_explanation=request.user_explanation,
            messages=request.messages,
            logic_gaps=request.logic_gaps,
            persona=request.persona,
            iteration_count=request.iteration_count,
            max_iterations=request.max_iterations,
            should_continue=should_continue,
            language=language,
            api_key=llm_config.api_key,
            base_url=llm_config.base_url,
            reference_notes=request.reference_notes,
            reference_source_label=request.reference_source_label,
        )
        return FeynmanTurnResponse(**result)
    except Exception as exc:
        logger.error(f"Feynman turn failed: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail={"message": str(exc)})

