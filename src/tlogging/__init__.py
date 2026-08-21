# -*- coding: utf-8 -*-
"""
Unified Logging System for ThinkPilot
=====================================

A clean, consistent logging system with:
- Unified format: [Module] Symbol Message
- English-only output
- File output to data/user/logs/
- WebSocket streaming support
- Color-coded console output
- LLM usage statistics tracking
- External library log forwarding (LightRAG, LlamaIndex)

Usage:
    from src.tlogging import get_logger, LLMStats

    logger = get_logger("Solver")
    logger.info("Processing started")
    logger.success("Task completed in 2.3s")
    logger.error("Something went wrong")

    # Track LLM usage
    stats = LLMStats("Solver")
    stats.add_call(model="gpt-4o", prompt_tokens=100, completion_tokens=50)
    stats.print_summary()
"""

# Use __getattr__ for lazy imports to avoid circular imports

__all__ = [
    # Core
    "Logger",
    "LogLevel",
    "get_logger",
    "reset_logger",
    "set_default_service_prefix",
    "ConsoleFormatter",
    "FileFormatter",
    # Handlers
    "ConsoleHandler",
    "FileHandler",
    "JSONFileHandler",
    "RotatingFileHandler",
    "WebSocketLogHandler",
    "LogInterceptor",
    # Adapters
    "LightRAGLogContext",
    "LightRAGLogForwarder",
    "get_lightrag_forwarding_config",
    "LlamaIndexLogContext",
    "LlamaIndexLogForwarder",
    # Stats
    "LLMStats",
    "LLMCall",
    "get_pricing",
    "estimate_tokens",
    "MODEL_PRICING",
    # Config
    "LoggingConfig",
    "load_logging_config",
    "get_default_log_dir",
    "get_global_log_level",
]

# Lazy imports to avoid circular dependencies
def __getattr__(name):
    if name in (
        "LoggingConfig",
        "get_default_log_dir",
        "get_global_log_level",
        "load_logging_config",
    ):
        from .config import (
            LoggingConfig,
            get_default_log_dir,
            get_global_log_level,
            load_logging_config,
        )
        return locals()[name]
    elif name in (
        "ConsoleHandler",
        "FileHandler",
        "JSONFileHandler",
        "LogInterceptor",
        "RotatingFileHandler",
        "WebSocketLogHandler",
    ):
        from .handlers import (
            ConsoleHandler,
            FileHandler,
            JSONFileHandler,
            LogInterceptor,
            RotatingFileHandler,
            WebSocketLogHandler,
        )
        return locals()[name]
    elif name in (
        "ConsoleFormatter",
        "FileFormatter",
        "Logger",
        "LogLevel",
        "get_logger",
        "reset_logger",
        "set_default_service_prefix",
    ):
        from .logger import (
            ConsoleFormatter,
            FileFormatter,
            Logger,
            LogLevel,
            get_logger,
            reset_logger,
            set_default_service_prefix,
        )
        return locals()[name]
    elif name in (
        "MODEL_PRICING",
        "LLMCall",
        "LLMStats",
        "estimate_tokens",
        "get_pricing",
    ):
        from .stats import (
            MODEL_PRICING,
            LLMCall,
            LLMStats,
            estimate_tokens,
            get_pricing,
        )
        return locals()[name]
    elif name in (
        "LightRAGLogContext",
        "LightRAGLogForwarder",
        "LlamaIndexLogContext",
        "LlamaIndexLogForwarder",
        "get_lightrag_forwarding_config",
    ):
        from .adapters import (
            LightRAGLogContext,
            LightRAGLogForwarder,
            LlamaIndexLogContext,
            LlamaIndexLogForwarder,
            get_lightrag_forwarding_config,
        )
        return locals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

