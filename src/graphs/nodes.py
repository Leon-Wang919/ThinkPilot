"""
Node utilities for bridging BaseAgent with LangGraph.

Provides decorators and wrapper classes that let existing BaseAgent
subclasses be used as LangGraph graph nodes without rewriting their
core LLM-calling logic.

Usage:
    from src.agents.chat.chat_agent import ChatAgent
    from src.graphs.nodes import agent_node

    # Wrap an agent method as a LangGraph node function
    chat_agent = ChatAgent(language="zh")

    @agent_node(chat_agent, output_key="final_answer")
    async def chat_node(state, agent):
        response = await agent.call_llm(
            user_prompt=state["current_query"],
            system_prompt="You are a helpful assistant.",
        )
        return response
"""

from __future__ import annotations

import functools
import time
import traceback
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from src.tlogging import get_logger

logger = get_logger("Graphs.Nodes")

StateT = TypeVar("StateT", bound=dict)


def agent_node(
    agent: Any,
    output_key: str = "final_answer",
    error_key: str = "error",
    step_name: str | None = None,
) -> Callable:
    """
    Decorator that wraps an async function into a LangGraph-compatible node.

    The decorated function receives ``(state, agent)`` and should return
    either:
    - A string (written to *output_key*)
    - A dict  (merged directly into state)

    On exception the error message is written to *error_key* and
    ``should_continue`` is set to ``False``.

    Args:
        agent: A BaseAgent instance whose LLM methods the node will use.
        output_key: State key to write the return value into.
        error_key: State key to write error messages into.
        step_name: Human-readable name for logging (defaults to function name).
    """

    def decorator(
        func: Callable[[StateT, Any], Awaitable[str | dict[str, Any]]],
    ) -> Callable[[StateT], Awaitable[dict[str, Any]]]:
        name = step_name or func.__name__

        @functools.wraps(func)
        async def wrapper(state: StateT) -> dict[str, Any]:
            start = time.time()
            logger.info(f"[{name}] Starting execution")

            try:
                # Refresh agent config to pick up latest user settings
                if hasattr(agent, "refresh_config"):
                    agent.refresh_config()

                result = await func(state, agent)

                elapsed = time.time() - start
                logger.info(f"[{name}] Completed in {elapsed:.2f}s")

                if isinstance(result, dict):
                    # Merge dict result directly into state
                    result.setdefault("current_node", name)
                    result["intermediate_steps"] = [
                        {"node": name, "duration": elapsed}
                    ]
                    return result

                # Scalar result ?write to output_key
                return {
                    output_key: result,
                    "current_node": name,
                    "intermediate_steps": [
                        {"node": name, "duration": elapsed}
                    ],
                }

            except Exception as exc:
                elapsed = time.time() - start
                error_msg = f"[{name}] Failed after {elapsed:.2f}s: {exc}"
                logger.error(error_msg)
                logger.debug(traceback.format_exc())
                return {
                    error_key: str(exc),
                    "should_continue": False,
                    "current_node": name,
                    "intermediate_steps": [
                        {
                            "node": name,
                            "duration": elapsed,
                            "error": str(exc),
                        }
                    ],
                }

        return wrapper

    return decorator


def passthrough_node(state: dict[str, Any]) -> dict[str, Any]:
    """A no-op node useful as a merge point for conditional branches."""
    return {}


def make_llm_node(
    agent: Any,
    system_prompt: str,
    user_prompt_template: str,
    output_key: str = "final_answer",
    response_format: dict[str, str] | None = None,
    step_name: str = "llm_call",
) -> Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]:
    """
    Factory that creates a simple LLM-call node from a prompt template.

    The *user_prompt_template* is formatted with ``state`` as the namespace,
    so you can write ``{current_query}`` to interpolate state fields.

    Args:
        agent: BaseAgent instance.
        system_prompt: System prompt string.
        user_prompt_template: Python format-string using state keys.
        output_key: Where to store the LLM response in state.
        response_format: Optional response format (e.g. {"type": "json_object"}).
        step_name: Name for logging.

    Returns:
        An async callable suitable for ``graph.add_node()``.
    """

    async def node(state: dict[str, Any]) -> dict[str, Any]:
        start = time.time()
        logger.info(f"[{step_name}] Calling LLM")

        if hasattr(agent, "refresh_config"):
            agent.refresh_config()

        user_prompt = user_prompt_template.format_map(
            _SafeFormatDict(state)
        )

        try:
            response = await agent.call_llm(
                user_prompt=user_prompt,
                system_prompt=system_prompt,
                response_format=response_format,
                stage=step_name,
            )
            elapsed = time.time() - start
            logger.info(f"[{step_name}] Completed in {elapsed:.2f}s")
            return {
                output_key: response,
                "current_node": step_name,
                "intermediate_steps": [
                    {"node": step_name, "duration": elapsed}
                ],
            }
        except Exception as exc:
            elapsed = time.time() - start
            logger.error(f"[{step_name}] Failed: {exc}")
            return {
                "error": str(exc),
                "should_continue": False,
                "current_node": step_name,
                "intermediate_steps": [
                    {"node": step_name, "duration": elapsed, "error": str(exc)}
                ],
            }

    return node


class _SafeFormatDict(dict):
    """Dict subclass that returns '{key}' for missing keys instead of raising."""

    def __missing__(self, key: str) -> str:
        return f"{{{key}}}"

