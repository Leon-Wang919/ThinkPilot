#!/usr/bin/env python3
"""
ThinkPilot startup health check.

Checks:
1) Python version
2) Core Python dependencies
3) Optional dependencies (warning only)
4) Required project files
5) Port availability for backend/frontend
"""

from __future__ import annotations

import importlib
import os
import socket
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / "ThinkPilot.env", override=False)
load_dotenv(PROJECT_ROOT / ".env", override=False)

CORE_IMPORTS = [
    "fastapi",
    "uvicorn",
    "yaml",
    "dotenv",
    "pydantic",
    "openai",
    "anthropic",
    "aiohttp",
    "httpx",
    "sqlalchemy",
    "aiosqlite",
]

OPTIONAL_IMPORTS = [
    "lightrag",
    "arxiv",
    "raganything",
    "llama_index",
    "docling",
]

REQUIRED_FILES = [
    PROJECT_ROOT / "pyproject.toml",
    PROJECT_ROOT / "config" / "main.yaml",
    PROJECT_ROOT / "config" / "agents.yaml",
    PROJECT_ROOT / "src" / "api" / "main.py",
    PROJECT_ROOT / "web" / "package.json",
    PROJECT_ROOT / "tests" / "test_api_smoke.py",
]


def _ok(msg: str) -> None:
    print(f"[OK] {msg}")


def _warn(msg: str) -> None:
    print(f"[WARN] {msg}")


def _fail(msg: str) -> None:
    print(f"[FAIL] {msg}")


def _can_bind(port: int, host: str = "127.0.0.1") -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _parse_port(value: str | None, default: int) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def main() -> int:
    blocked = 0
    warned = 0
    backend_port = _parse_port(os.environ.get("BACKEND_PORT"), 8001)
    frontend_port = _parse_port(os.environ.get("FRONTEND_PORT"), 3782)

    print("ThinkPilot Startup Health Check")
    print(f"Project root: {PROJECT_ROOT}")

    # Python version
    if sys.version_info >= (3, 10):
        _ok(f"Python {sys.version.split()[0]} (>=3.10)")
    else:
        _fail(f"Python {sys.version.split()[0]} (<3.10)")
        blocked += 1

    # Core imports
    for mod in CORE_IMPORTS:
        try:
            importlib.import_module(mod)
            _ok(f"core dependency import: {mod}")
        except Exception as exc:
            _fail(f"core dependency missing/broken: {mod} ({exc})")
            blocked += 1

    # Optional imports
    for mod in OPTIONAL_IMPORTS:
        try:
            importlib.import_module(mod)
            _ok(f"optional dependency import: {mod}")
        except Exception as exc:
            _warn(f"optional dependency unavailable: {mod} ({exc})")
            warned += 1

    # Required files
    for fp in REQUIRED_FILES:
        if fp.exists():
            _ok(f"required file exists: {fp.relative_to(PROJECT_ROOT)}")
        else:
            _fail(f"required file missing: {fp.relative_to(PROJECT_ROOT)}")
            blocked += 1

    # Port availability
    for port, name in (
        (backend_port, "backend"),
        (frontend_port, "frontend"),
    ):
        if _can_bind(port):
            _ok(f"{name} port available: {port}")
        else:
            _warn(f"{name} port already in use: {port}")
            warned += 1

    print("-" * 60)
    print(f"Blocked: {blocked}")
    print(f"Warnings: {warned}")

    if blocked:
        print("Result: FAILED")
        return 1

    print("Result: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
