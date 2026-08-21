"""
Settings API Router (Simplified)
================================

Manages basic UI settings: theme, language, sidebar customization.
Configuration for LLM/Embedding/TTS/Search is handled by the unified config service.
"""

import copy
import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import List, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from src.api.utils.health import build_health_payload

router = APIRouter()

# Settings file path for UI preferences (stored in settings folder with other configs)
SETTINGS_FILE = (
    Path(__file__).parent.parent.parent.parent / "data" / "user" / "settings" / "interface.json"
)

# Default sidebar navigation order
DEFAULT_SIDEBAR_NAV_ORDER = {
    "start": ["/", "/knowledge"],
    "learnResearch": ["/teacher", "/feynman", "/question", "/settings"],
}

# Default UI settings
DEFAULT_UI_SETTINGS = {
    "theme": "light",
    "language": "en",
    "sidebar_description": "AI-Powered Learning Assistant",
    "sidebar_nav_order": DEFAULT_SIDEBAR_NAV_ORDER,
}

_SETTINGS_LOCK = Lock()
_SETTINGS_CACHE: dict | None = None
_SETTINGS_CACHE_MTIME_NS: int = -1
_SETTINGS_CACHE_SIZE: int = -1


@router.get("/health")
async def health_check():
    """Health check."""
    return build_health_payload("settings")


class SidebarNavOrder(BaseModel):
    start: List[str]
    learnResearch: List[str]


class UISettings(BaseModel):
    theme: Literal["light", "dark"] = "light"
    language: Literal["zh", "en"] = "en"
    sidebar_description: Optional[str] = None
    sidebar_nav_order: Optional[SidebarNavOrder] = None


class ThemeUpdate(BaseModel):
    theme: Literal["light", "dark"]


class LanguageUpdate(BaseModel):
    language: Literal["zh", "en"]


class SidebarDescriptionUpdate(BaseModel):
    description: str


class SidebarNavOrderUpdate(BaseModel):
    nav_order: SidebarNavOrder


HIDDEN_SIDEBAR_ROUTES = {"/notebook"}


def sanitize_sidebar_nav_order(nav_order: Optional[dict]) -> dict:
    payload = nav_order or {}

    def sanitize_list(items: Optional[list], fallback: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()

        for item in items or fallback:
            if not isinstance(item, str):
                continue
            candidate = item.strip()
            if not candidate or candidate in HIDDEN_SIDEBAR_ROUTES or candidate in seen:
                continue
            seen.add(candidate)
            cleaned.append(candidate)

        return cleaned or fallback.copy()

    return {
        "start": sanitize_list(payload.get("start"), DEFAULT_SIDEBAR_NAV_ORDER["start"]),
        "learnResearch": sanitize_list(
            payload.get("learnResearch"), DEFAULT_SIDEBAR_NAV_ORDER["learnResearch"]
        ),
    }


def load_ui_settings() -> dict:
    """Load UI-specific settings from json file"""
    global _SETTINGS_CACHE, _SETTINGS_CACHE_MTIME_NS, _SETTINGS_CACHE_SIZE
    with _SETTINGS_LOCK:
        if SETTINGS_FILE.exists():
            try:
                stat = SETTINGS_FILE.stat()
                if (
                    _SETTINGS_CACHE is not None
                    and stat.st_mtime_ns == _SETTINGS_CACHE_MTIME_NS
                    and stat.st_size == _SETTINGS_CACHE_SIZE
                ):
                    return copy.deepcopy(_SETTINGS_CACHE)

                with open(SETTINGS_FILE, encoding="utf-8") as f:
                    saved = json.load(f)
                    merged = {**DEFAULT_UI_SETTINGS, **saved}
                    merged["sidebar_nav_order"] = sanitize_sidebar_nav_order(
                        merged.get("sidebar_nav_order")
                    )
                    _SETTINGS_CACHE = merged
                    _SETTINGS_CACHE_MTIME_NS = stat.st_mtime_ns
                    _SETTINGS_CACHE_SIZE = stat.st_size
                    return copy.deepcopy(merged)
            except Exception:
                pass

        _SETTINGS_CACHE = DEFAULT_UI_SETTINGS.copy()
        _SETTINGS_CACHE["sidebar_nav_order"] = sanitize_sidebar_nav_order(
            _SETTINGS_CACHE.get("sidebar_nav_order")
        )
        _SETTINGS_CACHE_MTIME_NS = -1
        _SETTINGS_CACHE_SIZE = -1
        return copy.deepcopy(_SETTINGS_CACHE)


def save_ui_settings(settings: dict):
    """Save UI settings"""
    global _SETTINGS_CACHE, _SETTINGS_CACHE_MTIME_NS, _SETTINGS_CACHE_SIZE
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _SETTINGS_LOCK:
        fd, tmp_path = tempfile.mkstemp(
            prefix="interface.", suffix=".tmp", dir=str(SETTINGS_FILE.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, SETTINGS_FILE)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        stat = SETTINGS_FILE.stat()
        _SETTINGS_CACHE = settings.copy()
        _SETTINGS_CACHE_MTIME_NS = stat.st_mtime_ns
        _SETTINGS_CACHE_SIZE = stat.st_size


@router.get("")
async def get_settings():
    """Get UI settings."""
    return {"ui": load_ui_settings()}


@router.put("/theme")
async def update_theme(update: ThemeUpdate):
    """Update UI theme"""
    current_ui = load_ui_settings()
    current_ui["theme"] = update.theme
    save_ui_settings(current_ui)
    return {"theme": update.theme}


@router.put("/language")
async def update_language(update: LanguageUpdate):
    """Update UI language"""
    current_ui = load_ui_settings()
    current_ui["language"] = update.language
    save_ui_settings(current_ui)
    return {"language": update.language}


@router.put("/ui")
async def update_ui_settings(update: UISettings):
    """Update all UI settings"""
    current_ui = load_ui_settings()
    update_dict = update.model_dump(exclude_none=True)
    if "sidebar_nav_order" in update_dict:
        update_dict["sidebar_nav_order"] = sanitize_sidebar_nav_order(
            update_dict.get("sidebar_nav_order")
        )
    current_ui.update(update_dict)
    save_ui_settings(current_ui)
    return current_ui


@router.post("/reset")
async def reset_settings():
    """Reset UI settings to default"""
    save_ui_settings(DEFAULT_UI_SETTINGS)
    return DEFAULT_UI_SETTINGS


@router.get("/themes")
async def get_themes():
    """Get available theme list"""
    return {
        "themes": [
            {"id": "light", "name": "Light"},
            {"id": "dark", "name": "Dark"},
        ]
    }


@router.get("/sidebar")
async def get_sidebar_settings():
    """Get sidebar customization settings"""
    current_ui = load_ui_settings()
    return {
        "description": current_ui.get(
            "sidebar_description", DEFAULT_UI_SETTINGS["sidebar_description"]
        ),
        "nav_order": sanitize_sidebar_nav_order(
            current_ui.get("sidebar_nav_order", DEFAULT_UI_SETTINGS["sidebar_nav_order"])
        ),
    }


@router.put("/sidebar/description")
async def update_sidebar_description(update: SidebarDescriptionUpdate):
    """Update sidebar description"""
    current_ui = load_ui_settings()
    current_ui["sidebar_description"] = update.description
    save_ui_settings(current_ui)
    return {"description": update.description}


@router.put("/sidebar/nav-order")
async def update_sidebar_nav_order(update: SidebarNavOrderUpdate):
    """Update sidebar navigation order"""
    current_ui = load_ui_settings()
    current_ui["sidebar_nav_order"] = sanitize_sidebar_nav_order(update.nav_order.model_dump())
    save_ui_settings(current_ui)
    return {"nav_order": current_ui["sidebar_nav_order"]}
