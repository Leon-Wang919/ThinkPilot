"""Audio API router for speech-to-text transcription."""

from __future__ import annotations

import os
from pathlib import Path

import openai
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from src.api.utils.health import build_health_payload
from src.services.config import load_config_with_main
from src.services.llm.config import get_llm_config
from src.tlogging import get_logger

project_root = Path(__file__).parent.parent.parent.parent
config = load_config_with_main("solve_config.yaml", project_root)
log_dir = config.get("paths", {}).get("user_log_dir") or config.get("logging", {}).get("log_dir")
logger = get_logger("AudioAPI", level="INFO", log_dir=log_dir)

router = APIRouter()

MAX_AUDIO_BYTES = int(os.getenv("STT_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")


class TranscriptionResponse(BaseModel):
    text: str
    model: str
    language: str | None = None


async def transcribe_audio_with_provider(
    *,
    filename: str,
    content: bytes,
    content_type: str,
    language: str | None,
) -> str:
    llm_config = get_llm_config()
    if not llm_config.api_key:
        raise ValueError("Missing API key for transcription")

    client = openai.AsyncOpenAI(
        api_key=llm_config.api_key,
        base_url=llm_config.base_url or None,
    )

    file_payload = (filename, content, content_type)
    response = await client.audio.transcriptions.create(
        model=STT_MODEL,
        file=file_payload,
        language=language or None,
    )
    return (response.text or "").strip()


@router.get("/health")
async def health_check():
    """Health check."""
    return build_health_payload("audio")


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
):
    """Transcribe uploaded audio to text."""
    if not file.filename:
        raise HTTPException(status_code=400, detail={"message": "Missing audio filename"})

    content_type = (file.content_type or "application/octet-stream").lower()
    if not (content_type.startswith("audio/") or content_type == "application/octet-stream"):
        raise HTTPException(status_code=400, detail={"message": "Unsupported audio content type"})

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail={"message": "Empty audio file"})

    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"message": f"Audio file too large (>{MAX_AUDIO_BYTES} bytes)"},
        )

    try:
        text = await transcribe_audio_with_provider(
            filename=file.filename,
            content=content,
            content_type=content_type,
            language=language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    except Exception as exc:
        logger.error(f"Audio transcription failed: {exc}")
        raise HTTPException(status_code=502, detail={"message": "Transcription service unavailable"}) from exc

    if not text:
        raise HTTPException(status_code=422, detail={"message": "No transcription result"})

    return TranscriptionResponse(text=text, model=STT_MODEL, language=language)
