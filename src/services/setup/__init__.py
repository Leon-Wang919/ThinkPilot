# -*- coding: utf-8 -*-
"""
Setup helpers for ThinkPilot.

Exports are loaded lazily so callers that only need runtime env parsing do not
also import the heavier config initialization path.
"""

from importlib import import_module

__all__ = [
    "init_user_directories",
    "get_backend_port",
    "get_frontend_port",
    "get_ports",
    "get_runtime_settings",
    "load_runtime_env",
    "reset_runtime_settings_cache",
]


def __getattr__(name: str):
    if name in {"get_runtime_settings", "load_runtime_env", "reset_runtime_settings_cache"}:
        module = import_module(f"{__name__}.runtime")
        return getattr(module, name)
    if name in {"init_user_directories", "get_backend_port", "get_frontend_port", "get_ports"}:
        module = import_module(f"{__name__}.init")
        return getattr(module, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
