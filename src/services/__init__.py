# -*- coding: utf-8 -*-
"""
Services layer package.

Submodules are exposed lazily to avoid importing optional/heavy dependencies
when callers only need a narrow utility such as `src.services.setup`.
"""

from importlib import import_module

__all__ = [
    "llm",
    "embedding",
    "rag",
    "prompt",
    "tts",
    "search",
    "setup",
    "config",
]


def __getattr__(name: str):
    """Lazy import for service subpackages."""
    if name in __all__:
        return import_module(f"{__name__}.{name}")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
