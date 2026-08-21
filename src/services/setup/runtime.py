from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_BACKEND_PORT = 8001
DEFAULT_FRONTEND_PORT = 3782
DEFAULT_APP_ENV = "development"


def _project_root(project_root: Path | None = None) -> Path:
    if project_root is not None:
        return project_root
    return Path(__file__).resolve().parents[3]


def load_runtime_env(project_root: Path | None = None) -> Path:
    root = _project_root(project_root)
    load_dotenv(root / "ThinkPilot.env", override=False)
    load_dotenv(root / ".env", override=False)
    return root


def _parse_port(raw: str | None, default: int) -> int:
    try:
        return int(raw or default)
    except (TypeError, ValueError):
        return default


def _split_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class RuntimeSettings:
    project_root: Path
    app_env: str
    backend_port: int
    frontend_port: int
    next_public_api_base: str | None
    next_public_api_base_external: str | None
    cors_allowed_origins: tuple[str, ...]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def default_local_api_base(self) -> str:
        return f"http://localhost:{self.backend_port}"

    @property
    def frontend_local_origins(self) -> tuple[str, ...]:
        port = self.frontend_port
        return (
            f"http://localhost:{port}",
            f"http://127.0.0.1:{port}",
        )

    @property
    def resolved_api_base(self) -> str:
        return (
            self.next_public_api_base_external
            or self.next_public_api_base
            or self.default_local_api_base
        )

    @property
    def allowed_cors_origins(self) -> list[str]:
        configured = list(dict.fromkeys(self.cors_allowed_origins))
        if configured:
            return configured
        if self.is_production:
            return []
        return list(self.frontend_local_origins)


@lru_cache(maxsize=4)
def get_runtime_settings(project_root: Path | None = None) -> RuntimeSettings:
    root = load_runtime_env(project_root)
    return RuntimeSettings(
        project_root=root,
        app_env=os.environ.get("APP_ENV", DEFAULT_APP_ENV),
        backend_port=_parse_port(os.environ.get("BACKEND_PORT"), DEFAULT_BACKEND_PORT),
        frontend_port=_parse_port(os.environ.get("FRONTEND_PORT"), DEFAULT_FRONTEND_PORT),
        next_public_api_base=os.environ.get("NEXT_PUBLIC_API_BASE") or None,
        next_public_api_base_external=os.environ.get("NEXT_PUBLIC_API_BASE_EXTERNAL") or None,
        cors_allowed_origins=tuple(_split_csv(os.environ.get("CORS_ALLOWED_ORIGINS"))),
    )


def reset_runtime_settings_cache() -> None:
    get_runtime_settings.cache_clear()
