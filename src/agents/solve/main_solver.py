#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Main Solver - Problem-Solving System Controller

Based on Dual-Loop Architecture: Analysis Loop + Solve Loop
"""

import asyncio
import json
import os
import re
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from ...services.config import parse_language
from .analysis_loop import InvestigateAgent, NoteAgent

# Dual-Loop Architecture
from .memory import CitationMemory, InvestigateMemory, SolveChainStep, SolveMemory
from .solve_loop import (
    ManagerAgent,
    PrecisionAnswerAgent,
    ResponseAgent,
    SolveAgent,
    ToolAgent,
    VerificationAgent,
)
from .utils import ConfigValidator, PerformanceMonitor, SolveAgentLogger
from .utils.display_manager import get_display_manager
from .utils.token_tracker import TokenTracker


class MainSolver:
    """Problem-Solving System Controller"""

    def __init__(
        self,
        config_path: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        api_version: str | None = None,
        language: str | None = None,
        kb_name: str = "ai_textbook",
        output_base_dir: str | None = None,
    ):
        """
        Initialize MainSolver with lightweight setup.
        Call ainit() to complete async initialization.

        Args:
            config_path: Config file path (default: config.yaml in current directory)
            api_key: API key (if not provided, read from environment)
            base_url: API URL (if not provided, read from environment)
            api_version: API version (if not provided, read from environment)
            language: Preferred language for prompts ("en"/"zh"/"cn")
            kb_name: Knowledge base name
            output_base_dir: Output base directory (optional, overrides config)
        """
        # Store initialization parameters
        self._config_path = config_path
        self._api_key = api_key
        self._base_url = base_url
        self._api_version = api_version
        self._language = language
        self._kb_name = kb_name
        self._output_base_dir = output_base_dir

        # Initialize with None - will be set in ainit()
        self.config = None
        self.api_key = None
        self.base_url = None
        self.api_version = None
        self.kb_name = kb_name
        self.logger = None
        self.monitor = None
        self.token_tracker = None

    async def ainit(self) -> None:
        """
        Complete the asynchronous second phase of MainSolver initialization.

        This class uses a two-phase initialization pattern:

        1. ``__init__`` performs only lightweight, synchronous setup and stores
           constructor arguments. Attributes such as ``config``, ``api_key``,
           ``base_url``, ``api_version``, ``logger``, ``monitor``, and
           ``token_tracker`` are intentionally left as ``None``.
        2. :meth:`ainit` performs all I/O-bound and asynchronous work required to
           make the instance fully usable (e.g., loading configuration, wiring up
           logging/monitoring, and preparing external-service clients).

        You **must** call and await this method exactly once after constructing
        ``MainSolver`` and **before** invoking any other methods that rely on
        configuration, logging, metrics, or API access. Using the object prior
        to calling :meth:`ainit` may result in attributes still being ``None``,
        which can lead to confusing runtime errors such as ``AttributeError``,
        misconfigured API calls, missing logs/metrics, or incorrect output paths.

        This async initialization pattern is used instead of performing all setup
        in ``__init__`` so that object construction remains fast and synchronous,
        while allowing potentially slow operations (disk I/O, network requests,
        validation) to be awaited explicitly by the caller in an async context.
        """
        config_path = self._config_path
        api_key = self._api_key
        base_url = self._base_url
        api_version = self._api_version
        kb_name = self._kb_name
        output_base_dir = self._output_base_dir
        language = self._language

        # Load config from config directory (main.yaml unified config)
        if config_path is None:
            project_root = Path(__file__).parent.parent.parent.parent
            # Load main.yaml (solve_config.yaml is optional and will be merged if exists)
            from ...services.config.loader import load_config_with_main_async

            full_config = await load_config_with_main_async("main.yaml", project_root)

            # Extract solve-specific config and build validator-compatible structure
            solve_config = full_config.get("solve", {})
            paths_config = full_config.get("paths", {})

            # Build config structure expected by ConfigValidator
            self.config = {
                "system": {
                    "output_base_dir": paths_config.get("solve_output_dir", "./data/user/solve"),
                    "save_intermediate_results": solve_config.get(
                        "save_intermediate_results", True
                    ),
                    "language": full_config.get("system", {}).get("language", "en"),
                },
                "agents": solve_config.get("agents", {}),
                "logging": full_config.get("logging", {}),
                "tools": full_config.get("tools", {}),
                "paths": paths_config,
                # Keep solve-specific settings accessible
                "solve": solve_config,
            }
        else:
            # If custom config path provided, load it directly (for backward compatibility)
            local_config = {}
            if Path(config_path).exists():
                try:

                    def load_local_config(path: str) -> dict:
                        with open(path, encoding="utf-8") as f:
                            return yaml.safe_load(f) or {}

                    local_config = await asyncio.to_thread(load_local_config, config_path)
                except Exception:
                    # Config loading warning will be handled by config_loader
                    pass
            self.config = local_config if isinstance(local_config, dict) else {}

        if self.config is None or not isinstance(self.config, dict):
            self.config = {}

        # Override system language from UI if provided
        if language:
            self.config.setdefault("system", {})
            self.config["system"]["language"] = parse_language(language)

        # Override output directory config
        if output_base_dir:
            if "system" not in self.config:
                self.config["system"] = {}
            self.config["system"]["output_base_dir"] = str(output_base_dir)

            # Note: log_dir and performance_log_dir are now in paths section from main.yaml
            # Only override if explicitly needed

        # Validate config
        validator = ConfigValidator()
        is_valid, errors, warnings = validator.validate(self.config)
        if not is_valid:
            raise ValueError(f"Config validation failed: {errors}")

        # API config
        if api_key is None or base_url is None or "llm" not in self.config:
            try:
                from ...services.llm.config import get_llm_config_async

                llm_config = await get_llm_config_async()
                if api_key is None:
                    api_key = llm_config.api_key
                if base_url is None:
                    base_url = llm_config.base_url
                if api_version is None:
                    api_version = getattr(llm_config, "api_version", None)

                # Ensure LLM config is populated in self.config for agents
                if "llm" not in self.config:
                    self.config["llm"] = {}

                # Update config with complete details (binding, model, etc.)
                from dataclasses import asdict

                self.config["llm"].update(asdict(llm_config))

            except ValueError as e:
                raise ValueError(f"LLM config error: {e!s}")

        # Check if API key is required
        # Local LLM servers (Ollama, LM Studio, etc.) don't need API keys
        from src.services.llm import is_local_llm_server

        if not api_key and not is_local_llm_server(base_url):
            raise ValueError("API key not set. Provide api_key param or set LLM_API_KEY in .env")

        # For local servers, use a placeholder key if none provided
        if not api_key and is_local_llm_server(base_url):
            api_key = "sk-no-key-required"

        self.api_key = api_key
        self.base_url = base_url
        self.api_version = api_version
        self.kb_name = kb_name

        # Initialize logging system
        logging_config = self.config.get("logging", {})
        # Get log_dir from paths (user_log_dir from main.yaml) or logging config
        log_dir = (
            self.config.get("paths", {}).get("user_log_dir")
            or self.config.get("paths", {}).get("log_dir")
            or logging_config.get("log_dir")
        )
        self.logger = SolveAgentLogger(
            name="Solver",
            level=logging_config.get("level", "INFO"),
            log_dir=log_dir,
            console_output=logging_config.get("console_output", True),
            file_output=logging_config.get("save_to_file", True),
        )

        # Attach display manager for TUI and frontend status updates
        self.logger.display_manager = get_display_manager()
        if self.logger.display_manager:
            self.logger.display_manager.reset_agent_statuses()

        # Initialize performance monitor (disabled by default - performance logging is deprecated)
        monitoring_config = self.config.get("monitoring", {})
        # Disable performance monitor by default to avoid creating performance directory
        self.monitor = PerformanceMonitor(
            enabled=False,
            save_dir=None,  # Disabled - performance logging is deprecated
        )

        # Initialize Token tracker
        self.token_tracker = TokenTracker(prefer_tiktoken=True)

        # Connect token_tracker to display_manager for real-time updates
        if self.logger.display_manager:
            self.token_tracker.set_on_usage_added_callback(
                self.logger.display_manager.update_token_stats
            )

        self.logger.section("Dual-Loop Solver Initializing")
        self.logger.info(f"Knowledge Base: {kb_name}")

        # Initialize Agents
        self._init_agents()

        self.logger.success("Solver ready")

    def _deep_merge(self, base: dict, update: dict) -> dict:
        """Deep merge two dictionaries"""
        if base is None:
            base = {}
        if update is None:
            update = {}

        result = base.copy() if base else {}
        for key, value in update.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def _init_agents(self):
        """Initialize all Agents - Dual-Loop Architecture"""
        self.logger.progress("Initializing agents...")

        # Analysis Loop Agents
        self.investigate_agent = InvestigateAgent(
            config=self.config,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            token_tracker=self.token_tracker,
        )
        self.logger.info("  InvestigateAgent initialized")

        self.note_agent = NoteAgent(
            config=self.config,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            token_tracker=self.token_tracker,
        )
        self.logger.info("  NoteAgent initialized")

        # Solve Loop Agents (lazy initialization)
        self.manager_agent = None
        self.solve_agent = None
        self.tool_agent = None
        self.response_agent = None
        self.precision_answer_agent = None
        self.verification_agent = None
        self.logger.info("  Solve Loop agents (lazy init)")

    def _set_agent_status(self, agent_name: str, status: str):
        """Push agent status to display manager (and websocket wrapper, if present)."""
        display_manager = getattr(self.logger, "display_manager", None)
        if not display_manager:
            return
        try:
            display_manager.set_agent_status(agent_name, status)
        except Exception:
            # Status updates are best-effort and should not break solve flow.
            pass

    def _select_orchestration_profile(self, question: str) -> str:
        """Select orchestration profile based on configuration and simple complexity heuristic."""
        orchestration = self.config.get("solve", {}).get("orchestration", {})
        mode = str(orchestration.get("mode", "balanced")).lower()
        if mode in {"fast", "balanced", "deep"}:
            return mode

        # Auto mode: short, direct questions favor fast; otherwise balanced.
        q = (question or "").strip()
        q_len = len(q)
        lowered = q.lower()
        complex_markers = (
            "prove",
            "derive",
            "optimization",
            "complexity",
            "multi-part",
            "证明",
            "推导",
            "复杂度",
            "最优化",
            "多问",
            "并说明",
        )
        if q_len <= 60 and not any(m in lowered for m in complex_markers):
            return "fast"
        return "balanced"

    def _build_fallback_single_step(
        self, question: str, investigate_memory: InvestigateMemory
    ) -> list[SolveChainStep]:
        """Build a single-step chain for fast mode when planning is bypassed."""
        cite_ids = [item.cite_id for item in investigate_memory.knowledge_chain if item.cite_id]
        step_target = (
            "Analysis: Solve the question directly, call tools only when evidence is insufficient, "
            "and provide a concise, verifiable conclusion."
        )
        if parse_language(self.config.get("system", {}).get("language", "zh")).startswith("zh"):
            step_target = (
                "分析：直接解答用户问题；如证据不足可调用工具补证，并给出可校验的结论。"
            )

        return [
            SolveChainStep(
                step_id="S1",
                step_target=step_target,
                role="Analysis",
                available_cite=cite_ids,
            )
        ]

    async def solve(self, question: str, verbose: bool = True) -> dict[str, Any]:
        """
        Main solving process - Dual-Loop Architecture

        Args:
            question: User question
            verbose: Whether to print detailed info

        Returns:
            dict: Solving result
        """
        # Create output directory
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_base_dir = self.config.get("system", {}).get("output_base_dir", "./user/solve")
        output_dir = os.path.join(output_base_dir, f"solve_{timestamp}")
        os.makedirs(output_dir, exist_ok=True)

        # Add task log file handler
        task_log_file = os.path.join(output_dir, "task.log")
        self.logger.add_task_log_handler(task_log_file)

        self.logger.section("Problem Solving Started")
        self.logger.info(f"Question: {question[:100]}{'...' if len(question) > 100 else ''}")
        self.logger.info(f"Output: {output_dir}")

        try:
            # Execute dual-loop pipeline
            result = await self._run_dual_loop_pipeline(question, output_dir)

            # Add metadata
            result["metadata"] = {
                "mode": "dual_loop",
                "timestamp": timestamp,
                "output_dir": output_dir,
            }

            # Save performance report
            if self.config.get("monitoring", {}).get("enabled", True):
                perf_report = self.monitor.generate_report()
                perf_file = os.path.join(output_dir, "performance_report.json")
                with open(perf_file, "w", encoding="utf-8") as f:
                    json.dump(perf_report, f, ensure_ascii=False, indent=2)
                self.logger.debug(f"Performance report saved: {perf_file}")

            # Output cost report
            if self.token_tracker:
                cost_summary = self.token_tracker.get_summary()
                if cost_summary["total_calls"] > 0:
                    cost_text = self.token_tracker.format_summary()
                    self.logger.info(f"\n{cost_text}")

                    cost_file = os.path.join(output_dir, "cost_report.json")
                    self.token_tracker.save(cost_file)
                    self.logger.debug(f"Cost report saved: {cost_file}")

                    self.token_tracker.reset()

            self.logger.success("Problem solving completed")
            self.logger.remove_task_log_handlers()

            return result

        except Exception as e:
            self.logger.error(f"Solving failed: {e!s}")
            self.logger.error(traceback.format_exc())
            self.logger.remove_task_log_handlers()
            raise

        finally:
            if hasattr(self, "logger"):
                self.logger.shutdown()

    async def _run_dual_loop_pipeline(self, question: str, output_dir: str) -> dict[str, Any]:
        """
        Dual-Loop Pipeline:
        1) Analysis Loop: Investigate ?Note
        2) Solve Loop: Plan ?Manager ?Solve ?Check ?Format
        """

        self.logger.info("Pipeline: Analysis Loop ?Solve Loop")

        profile = self._select_orchestration_profile(question)
        profile_cfg = (
            self.config.get("solve", {})
            .get("orchestration", {})
            .get("profiles", {})
            .get(profile, {})
        )

        use_note_agent = bool(profile_cfg.get("use_note_agent", profile != "fast"))
        use_manager_agent = bool(profile_cfg.get("use_manager_agent", profile != "fast"))
        use_precision_agent = bool(profile_cfg.get("use_precision_agent", profile == "deep"))
        note_min_new_knowledge = int(profile_cfg.get("note_min_new_knowledge", 1))

        self.logger.info(f"Orchestration profile: {profile}")
        # ========== Analysis Loop ==========
        self.logger.stage("Analysis Loop", "start", "Understanding the question")
        self._set_agent_status("InvestigateAgent", "running")
        if not use_note_agent:
            self._set_agent_status("NoteAgent", "done")

        investigate_memory = InvestigateMemory.load_or_create(
            output_dir=output_dir, user_question=question
        )

        citation_memory = CitationMemory.load_or_create(output_dir=output_dir)

        # Read max_iterations from solve.agents.investigate_agent config (authoritative source)
        agent_config = self.config.get("solve", {}).get("agents", {}).get("investigate_agent", {})
        max_analysis_iterations = agent_config.get("max_iterations", 5)
        profile_max_analysis_iterations = profile_cfg.get("max_analysis_iterations")
        if isinstance(profile_max_analysis_iterations, int) and profile_max_analysis_iterations > 0:
            max_analysis_iterations = min(max_analysis_iterations, profile_max_analysis_iterations)
        self.logger.log_stage_progress(
            "AnalysisLoop", "start", f"max_iterations={max_analysis_iterations}"
        )

        analysis_completed = False

        # Analysis Loop iterations
        for i in range(max_analysis_iterations):
            self.logger.log_stage_progress("AnalysisLoop", "running", f"round={i + 1}")

            # 1. Investigate: Generate queries and call tools
            with self.monitor.track(f"analysis_investigate_{i + 1}"):
                investigate_result = await self.investigate_agent.process(
                    question=question,
                    memory=investigate_memory,
                    citation_memory=citation_memory,
                    kb_name=self.kb_name,
                    output_dir=output_dir,
                    verbose=False,
                )

            knowledge_ids: list[str] = investigate_result.get("knowledge_item_ids", [])
            should_stop = investigate_result.get("should_stop", False)
            reasoning = investigate_result.get("reasoning", "")
            actions = investigate_result.get("actions", [])

            self.logger.debug(f"  [Investigate] Reasoning: {reasoning or 'N/A'}")

            if hasattr(self, "_send_progress_update"):
                queries = [action.get("query", "") for action in actions if action.get("query")]
                self._send_progress_update("investigate", {"round": i + 1, "queries": queries})

            if actions:
                for action in actions:
                    tool_label = action["tool_type"]
                    query = action.get("query") or ""
                    cite_id = action.get("cite_id")
                    suffix = f" ?cite_id={cite_id}" if cite_id else ""
                    self.logger.info(f"  Tool: {tool_label} | {query[:50]}{suffix}")
            else:
                self.logger.debug("  No queries generated this round")

            # 2. Note: Generate notes (if new knowledge exists)
            if use_note_agent and knowledge_ids and len(knowledge_ids) >= note_min_new_knowledge:
                self.logger.log_stage_progress("Note", "start")
                self._set_agent_status("NoteAgent", "running")

                with self.monitor.track(f"analysis_note_{i + 1}"):
                    note_result = await self.note_agent.process(
                        question=question,
                        memory=investigate_memory,
                        new_knowledge_ids=knowledge_ids,
                        citation_memory=citation_memory,
                        output_dir=output_dir,
                        verbose=False,
                    )

                if note_result.get("success"):
                    processed = note_result.get("processed_items", 0)
                    self.logger.info(f"  Note: {processed} items processed")
                    self.logger.log_stage_progress("Note", "complete")
                    self._set_agent_status("NoteAgent", "done")
                else:
                    self.logger.warning(f"  Note failed: {note_result.get('reason', 'unknown')}")
                    self.logger.log_stage_progress("Note", "error")
                    self._set_agent_status("NoteAgent", "error")

            # Update Token stats
            self.logger.update_token_stats(self.token_tracker.get_summary())

            # 3. Check stop condition
            if should_stop:
                analysis_completed = True
                self.logger.log_stage_progress(
                    "AnalysisLoop",
                    "complete",
                    f"rounds={i + 1}, knowledge={len(investigate_memory.knowledge_chain)}",
                )
                self._set_agent_status("InvestigateAgent", "done")
                break

        if not analysis_completed:
            self.logger.log_stage_progress(
                "AnalysisLoop",
                "warning",
                f"max_iterations({max_analysis_iterations}) reached, knowledge={len(investigate_memory.knowledge_chain)}",
            )
            self._set_agent_status("InvestigateAgent", "done")

        # Update investigate_memory metadata
        investigate_memory.metadata["total_iterations"] = i + 1
        investigate_memory.metadata["total_knowledge_items"] = len(
            investigate_memory.knowledge_chain
        )
        investigate_memory.reflections.remaining_questions = []

        if analysis_completed:
            investigate_memory.metadata["coverage_rate"] = 1.0
            investigate_memory.metadata["avg_confidence"] = 0.9
        else:
            coverage = min(
                1.0, len(investigate_memory.knowledge_chain) / max(1, max_analysis_iterations)
            )
            investigate_memory.metadata["coverage_rate"] = coverage
            investigate_memory.metadata["avg_confidence"] = 0.6

        investigate_memory.save()

        # ========== Solve Loop ==========
        self.logger.stage("Solve Loop", "start", "Generating solution")

        solve_memory = SolveMemory.load_or_create(output_dir=output_dir, user_question=question)

        # Initialize Solve Loop Agents (if not yet initialized)
        if self.manager_agent is None:
            self.logger.progress("Initializing Solve Loop agents...")
            self.manager_agent = ManagerAgent(
                self.config,
                self.api_key,
                self.base_url,
                api_version=self.api_version,
                token_tracker=self.token_tracker,
            )
            self.solve_agent = SolveAgent(
                self.config,
                self.api_key,
                self.base_url,
                api_version=self.api_version,
                token_tracker=self.token_tracker,
            )
            self.tool_agent = ToolAgent(
                self.config,
                self.api_key,
                self.base_url,
                api_version=self.api_version,
                token_tracker=self.token_tracker,
            )
            self.response_agent = ResponseAgent(
                self.config,
                self.api_key,
                self.base_url,
                api_version=self.api_version,
                token_tracker=self.token_tracker,
            )
            self.verification_agent = VerificationAgent(
                self.config,
                self.api_key,
                self.base_url,
                api_version=self.api_version,
                token_tracker=self.token_tracker,
            )

            precision_enabled = (
                self.config.get("agents", {})
                .get("precision_answer_agent", {})
                .get("enabled", False)
            )
            if precision_enabled:
                self.precision_answer_agent = PrecisionAnswerAgent(
                    self.config,
                    self.api_key,
                    self.base_url,
                    api_version=self.api_version,
                    token_tracker=self.token_tracker,
                )

        # 1. Plan: Generate solving plan (or fast fallback)
        plan_result = None
        if use_manager_agent:
            self.logger.info("Plan: Generating solution strategy...")
            self._set_agent_status("ManagerAgent", "running")

            for attempt in range(2):
                try:
                    with self.monitor.track(f"solve_plan_attempt_{attempt + 1}"):
                        plan_result = await self.manager_agent.process(
                            question=question,
                            investigate_memory=investigate_memory,
                            solve_memory=solve_memory,
                            verbose=(attempt > 0),
                        )
                    num_steps = plan_result.get("num_steps") or plan_result.get("steps_count", 0)
                    self.logger.log_stage_progress("Plan", "complete", f"steps={num_steps}")
                    self._set_agent_status("ManagerAgent", "done")
                    self.logger.update_token_stats(self.token_tracker.get_summary())
                    break
                except Exception as e:
                    if attempt == 0:
                        self.logger.error(f"ManagerAgent attempt {attempt + 1} failed: {e!s}")
                        self.logger.warning("Retrying plan generation...")
                        solve_memory = SolveMemory.load_or_create(
                            output_dir=output_dir, user_question=question
                        )
                    else:
                        self._set_agent_status("ManagerAgent", "error")
                        self.logger.error(f"ManagerAgent attempt {attempt + 1} also failed")
                        raise ValueError(f"ManagerAgent failed after retry: {e!s}")

            if plan_result is None:
                self._set_agent_status("ManagerAgent", "error")
                raise ValueError("ManagerAgent failed to generate plan")
        else:
            self.logger.info("Plan bypassed in fast profile: using single-step fallback")
            solve_memory.create_chains(self._build_fallback_single_step(question, investigate_memory))
            solve_memory.save()
            self._set_agent_status("ManagerAgent", "done")

        # 2. Solve Loop - Execute steps
        self.logger.info("Solve: Executing solution steps...")
        self._set_agent_status("SolveAgent", "running")
        max_correction_iterations = self.config.get("solve", {}).get(
            "max_solve_correction_iterations",
            self.config.get("system", {}).get("max_solve_correction_iterations", 3),
        )
        total_planned_steps = len(solve_memory.solve_chains)
        self.logger.log_stage_progress(
            "SolveLoop",
            "start",
            f"planned_steps={total_planned_steps}, max_corrections={max_correction_iterations}",
        )

        for step_index, step in enumerate(solve_memory.solve_chains, 1):
            if step.status in ("waiting_response", "done"):
                continue

            self.logger.info(f"  Step {step_index}: {step.step_id}")
            self.logger.debug(f"  Target: {step.step_target[:80]}")

            if hasattr(self, "_send_progress_update"):
                self._send_progress_update(
                    "solve",
                    {
                        "step_index": step_index,
                        "step_id": step.step_id,
                        "step_target": step.step_target,
                    },
                )

            self.logger.log_stage_progress("SolveLoop", "running", f"step={step.step_id}")

            if self._has_pending_tool_calls(step):
                await self._execute_tool_calls(step, solve_memory, citation_memory, output_dir)

            iteration = 0
            while iteration < max_correction_iterations:
                iteration += 1
                current_step = solve_memory.get_step(step.step_id) or step

                with self.monitor.track(f"solve_execute_{step.step_id}_iter_{iteration}"):
                    solve_result = await self.solve_agent.process(
                        question=question,
                        current_step=current_step,
                        solve_memory=solve_memory,
                        investigate_memory=investigate_memory,
                        citation_memory=citation_memory,
                        kb_name=self.kb_name,
                        output_dir=output_dir,
                        verbose=False,
                    )

                if solve_result.get("raw_llm_response"):
                    self.logger.log_stage_progress(
                        "SolveLoop", "running", f"step={step.step_id}, iteration={iteration}"
                    )

                if solve_result.get("requested_calls"):
                    await self._execute_tool_calls(
                        current_step, solve_memory, citation_memory, output_dir
                    )

                self.logger.update_token_stats(self.token_tracker.get_summary())

                if solve_result.get("finish_requested"):
                    current_step = solve_memory.get_step(step.step_id) or step
                    if self._has_pending_tool_calls(current_step):
                        self.logger.debug("  Finish triggered but tools pending, continuing...")
                        continue
                    solve_memory.mark_step_waiting_response(current_step.step_id)
                    solve_memory.save()
                    self.logger.log_stage_progress(
                        "SolveLoop", "complete", f"step={current_step.step_id} ready for response"
                    )
                    break
            else:
                self.logger.warning(f"  Step {step.step_id} max iterations reached")
                solve_memory.mark_step_waiting_response(step.step_id)
                solve_memory.save()

        pending_steps = [
            s.step_id
            for s in solve_memory.solve_chains
            if s.status not in ("waiting_response", "done")
        ]
        if pending_steps:
            self.logger.warning(f"Steps not ready for response: {', '.join(pending_steps)}")

        self.logger.log_stage_progress(
            "SolveLoop", "complete", f"steps_processed={total_planned_steps - len(pending_steps)}"
        )
        self._set_agent_status("SolveAgent", "done")

        # 3. Response: Generate responses for each step
        self.logger.info("Response: Generating step responses...")
        self._set_agent_status("ResponseAgent", "running")
        self.logger.log_stage_progress("ResponseLoop", "start", "Generating responses")

        accumulated_response = ""
        for step in solve_memory.solve_chains:
            if step.status == "done" and step.step_response:
                accumulated_response += step.step_response + "\n\n"

        for step in solve_memory.solve_chains:
            if step.status != "waiting_response":
                continue

            original_step_index = next(
                (
                    i + 1
                    for i, s in enumerate(solve_memory.solve_chains)
                    if s.step_id == step.step_id
                ),
                0,
            )

            if hasattr(self, "_send_progress_update"):
                self._send_progress_update(
                    "response",
                    {
                        "step_index": original_step_index,
                        "step_id": step.step_id,
                        "step_target": step.step_target,
                    },
                )

            with self.monitor.track(f"solve_response_{step.step_id}"):
                response_result = await self.response_agent.process(
                    question=question,
                    step=step,
                    solve_memory=solve_memory,
                    investigate_memory=investigate_memory,
                    citation_memory=citation_memory,
                    output_dir=output_dir,
                    verbose=False,
                    accumulated_response=accumulated_response,
                )

            step_response = response_result.get("step_response", "")
            if step_response:
                accumulated_response += step_response + "\n\n"

            if response_result.get("raw_response"):
                self.logger.log_stage_progress(
                    "ResponseLoop", "running", f"step={step.step_id} response generated"
                )

            self.logger.update_token_stats(self.token_tracker.get_summary())

        self.logger.log_stage_progress("ResponseLoop", "complete", "All responses generated")
        self._set_agent_status("ResponseAgent", "done")

        # 4. Finalize: Compile final answer
        self.logger.info("Finalize: Compiling final answer...")
        self.logger.log_stage_progress("Finalize", "start", "Compiling steps")

        actual_total_steps = len(solve_memory.solve_chains)
        completed_step_objs = [
            step
            for step in solve_memory.solve_chains
            if step.status == "done" and step.step_response
        ]
        completed_steps = len(completed_step_objs)

        solve_memory.metadata["total_steps"] = actual_total_steps
        solve_memory.metadata["completed_steps"] = completed_steps
        solve_memory.save()
        self.logger.info(f"  Stats: {completed_steps}/{actual_total_steps} steps completed")

        used_cite_ids = []
        for step in completed_step_objs:
            used_cite_ids.extend(step.used_citations)
        used_cite_ids = list(dict.fromkeys(used_cite_ids))

        step_responses = [step.step_response for step in completed_step_objs]
        final_answer = "\n\n".join(step_responses)

        # Get language setting from config (unified in config/main.yaml system.language)
        language = self.config.get("system", {}).get("language", "zh")
        lang_code = parse_language(language)

        # Check if citations are enabled
        enable_citations = self.config.get("solve", {}).get(
            "enable_citations",
            self.config.get("system", {}).get("enable_citations", True),
        )

        citations_section = ""
        if enable_citations and citation_memory:
            citations_section = citation_memory.format_citations_markdown(
                used_cite_ids=used_cite_ids, language=lang_code
            )
            if citations_section:
                final_answer = f"{final_answer}\n\n---\n\n{citations_section}"

        format_result = {
            "final_answer": final_answer.strip(),
            "citations": used_cite_ids,
            "metadata": {
                "refined_steps": len(completed_step_objs),
                "total_steps": actual_total_steps,
                "citations_section": bool(citations_section),
            },
        }

        self.logger.info(f"  Final answer: {len(format_result['final_answer'])} chars")
        self.logger.info(f"  Citations: {len(format_result['citations'])}")

        self.logger.info("Verification: Checking final answer...")
        self._set_agent_status("VerificationAgent", "running")
        verification_result = await self._run_final_verification(
            question=question,
            detailed_answer=format_result["final_answer"],
            completed_step_objs=completed_step_objs,
            investigate_memory=investigate_memory,
            citation_memory=citation_memory,
            citation_summary=citations_section,
            output_dir=output_dir,
            used_cite_ids=used_cite_ids,
        )
        solve_memory.metadata["verification_result"] = verification_result
        solve_memory.save()
        self.logger.info(
            "  Verification: passed=%s confidence=%.2f"
            % (verification_result.get("passed", False), verification_result.get("confidence", 0.0))
        )
        self._set_agent_status("VerificationAgent", "done")

        # 5. Precision Answer (if enabled)
        precision_answer_enabled = (
            self.config.get("agents", {}).get("precision_answer_agent", {}).get("enabled", False)
        )
        precision_answer_enabled = precision_answer_enabled and use_precision_agent
        final_answer_content = format_result["final_answer"]

        verification_ok = self._verification_is_reliable(verification_result)
        precision_source = self._select_precision_source(
            detailed_answer=format_result["final_answer"],
            verification_result=verification_result,
        )
        precision_result: dict[str, Any] | None = None

        if verification_ok and precision_answer_enabled and self.precision_answer_agent:
            self.logger.info("PrecisionAnswer: Generating concise answer...")
            self._set_agent_status("PrecisionAnswerAgent", "running")
            with self.monitor.track("precision_answer"):
                precision_result = await self.precision_answer_agent.process(
                    question=question, detailed_answer=precision_source, verbose=False
                )
            if precision_result.get("needs_precision"):
                self.logger.info(
                    f"  Precision answer: {len(precision_result.get('precision_answer', ''))} chars"
                )
            else:
                self.logger.debug("  No precision answer needed")
            self._set_agent_status("PrecisionAnswerAgent", "done")
        elif not verification_ok:
            self.logger.warning("PrecisionAnswer skipped because verification did not pass reliably")
            self._set_agent_status("PrecisionAnswerAgent", "done")
        else:
            self._set_agent_status("PrecisionAnswerAgent", "done")

        final_answer_content = self._compose_final_answer_content(
            detailed_answer=format_result["final_answer"],
            verification_result=verification_result,
            precision_result=precision_result,
        )
        final_answer_content = self._normalize_math_markdown(final_answer_content)

        # If some optional agents were never triggered in this run, mark them completed.
        display_manager = getattr(self.logger, "display_manager", None)
        if display_manager:
            if display_manager.agents_status.get("NoteAgent") == "pending":
                self._set_agent_status("NoteAgent", "done")
            if display_manager.agents_status.get("ToolAgent") == "pending":
                self._set_agent_status("ToolAgent", "done")

        # Save final answer
        final_answer_file = Path(output_dir) / "final_answer.md"
        with open(final_answer_file, "w", encoding="utf-8") as f:
            f.write(final_answer_content)

        self.logger.success(f"Final answer saved: {final_answer_file}")
        self.logger.log_stage_progress("Format", "complete", f"output={final_answer_file}")

        return {
            "question": question,
            "output_dir": output_dir,
            "final_answer": final_answer_content,
            "output_md": str(final_answer_file),
            "output_json": str(Path(output_dir) / "solve_chain.json"),
            "formatted_solution": final_answer_content,
            "citations": format_result["citations"],
            "pipeline": "reworked",
            "total_steps": solve_memory.metadata["total_steps"],
            "analysis_iterations": investigate_memory.metadata.get("total_iterations", 0),
            "solve_steps": solve_memory.metadata["completed_steps"],
            "metadata": {
                "orchestration_profile": profile,
                "coverage_rate": investigate_memory.metadata.get("coverage_rate", 0.0),
                "avg_confidence": investigate_memory.metadata.get("avg_confidence", 0.0),
                "total_steps": solve_memory.metadata["total_steps"],
                "verification_passed": verification_result.get("passed", False),
                "verification_confidence": verification_result.get("confidence", 0.0),
                "used_web_fallback": investigate_memory.metadata.get("used_web_fallback", False),
                "grounding_strength": investigate_memory.metadata.get("grounding_strength", "low"),
            },
        }

    async def _run_final_verification(
        self,
        *,
        question: str,
        detailed_answer: str,
        completed_step_objs: list[SolveChainStep],
        investigate_memory: InvestigateMemory,
        citation_memory: CitationMemory,
        citation_summary: str,
        output_dir: str,
        used_cite_ids: list[str],
    ) -> dict[str, Any]:
        step_summaries = "\n\n".join(
            (
                f"[{step.step_id}] role={step.role or 'Unknown'}\n"
                f"Target: {step.step_target}\n"
                f"Response: {(step.step_response or '')[:500]}"
            )
            for step in completed_step_objs
        )
        code_verification_result = ""
        code_verification_cite_id = ""
        existing_code_verification = self._extract_existing_code_verification(completed_step_objs)
        if existing_code_verification:
            code_verification_result = existing_code_verification
        elif self._should_use_code_verification(question, completed_step_objs):
            intent = (
                "Independently verify the claimed answer. Recompute the key result, compare it with "
                "the claimed conclusion, and print any mismatch.\n"
                f"Question: {question}\nClaimed answer:\n{detailed_answer}"
            )
            try:
                code_verification_result, metadata = await self.tool_agent.run_code_intent(
                    intent=intent,
                    output_dir=output_dir,
                    artifacts_dir=str(Path(output_dir) / "verification_artifacts"),
                )
                code_verification_cite_id = citation_memory.add_citation(
                    tool_type="code_execution",
                    query=intent,
                    raw_result=code_verification_result,
                    content=code_verification_result[:500],
                    stage="solve",
                    step_id="verification",
                    metadata=metadata,
                )
                citation_memory.save()
            except Exception as exc:
                code_verification_result = f"[Verification code execution failed]\n{exc}"

        verification_result = await self.verification_agent.process(
            question=question,
            detailed_answer=detailed_answer,
            step_summaries=step_summaries,
            citation_summary=citation_summary,
            grounding_strength=investigate_memory.metadata.get("grounding_strength", "low"),
            code_verification_result=code_verification_result,
            verbose=False,
        )
        if code_verification_cite_id:
            evidence_basis = verification_result.get("evidence_basis", [])
            if code_verification_cite_id not in evidence_basis:
                verification_result["evidence_basis"] = [*evidence_basis, code_verification_cite_id]
        return verification_result

    def _should_use_code_verification(
        self, question: str, completed_step_objs: list[SolveChainStep]
    ) -> bool:
        roles = {(step.role or "").strip().lower() for step in completed_step_objs}
        if roles.intersection({"calculation", "verification"}):
            return True

        lowered_question = (question or "").lower()
        markers = (
            "calculate",
            "solve",
            "equation",
            "derivative",
            "integral",
            "probability",
            "algorithm",
            "complexity",
            "multiple choice",
            "true/false",
            "fill in the blank",
            "计算",
            "求解",
            "方程",
            "导数",
            "积分",
            "概率",
            "算法",
            "复杂度",
            "选择题",
            "判断题",
            "填空",
        )
        return any(marker in lowered_question for marker in markers)

    def _extract_existing_code_verification(
        self, completed_step_objs: list[SolveChainStep]
    ) -> str:
        for step in completed_step_objs:
            if (step.role or "").strip().lower() != "verification":
                continue
            for call in step.tool_calls:
                if call.tool_type == "code_execution" and call.status == "success":
                    if call.raw_answer:
                        return call.raw_answer
                    if call.summary:
                        return call.summary
        return ""

    def _verification_is_reliable(self, verification_result: dict[str, Any]) -> bool:
        return bool(verification_result.get("passed")) and float(
            verification_result.get("confidence", 0.0)
        ) >= 0.75

    def _select_precision_source(
        self, *, detailed_answer: str, verification_result: dict[str, Any]
    ) -> str:
        corrected_result = str(verification_result.get("corrected_result", "") or "").strip()
        return corrected_result or detailed_answer

    def _compose_final_answer_content(
        self,
        *,
        detailed_answer: str,
        verification_result: dict[str, Any],
        precision_result: dict[str, Any] | None,
    ) -> str:
        config = self.config or {}
        lang_code = parse_language(config.get("system", {}).get("language", "en"))
        is_zh = lang_code.startswith("zh")

        title_verification_warning = "## 校验提示" if is_zh else "## Verification Warning"
        text_verification_warning = (
            "当前结果未能通过可靠性校验，下方详细答案可能存在错误或证据不足。"
            if is_zh
            else (
                "The result could not be reliably verified. The detailed answer below may contain "
                "mistakes or unsupported conclusions."
            )
        )
        title_issues = "问题" if is_zh else "Issues"
        title_verification_correction = "## 校验修正" if is_zh else "## Verification Correction"
        text_verification_correction = (
            "校验流程给出了更可靠的结论："
            if is_zh
            else "A verification pass produced a more reliable conclusion:"
        )
        title_concise_answer = "## 简明答案" if is_zh else "## Concise Answer"
        title_detailed_answer = "## 详细解答" if is_zh else "## Detailed Answer"

        sections: list[str] = []
        corrected_result = str(verification_result.get("corrected_result", "") or "").strip()
        verification_ok = self._verification_is_reliable(verification_result)
        issues = verification_result.get("issues", []) or []

        if not verification_ok:
            warning_lines = [
                title_verification_warning,
                text_verification_warning,
            ]
            if issues:
                warning_lines.append(f"{title_issues}: " + "; ".join(str(item) for item in issues))
            sections.append("\n\n".join(warning_lines))

        if corrected_result and corrected_result not in detailed_answer:
            sections.append(
                f"{title_verification_correction}\n\n"
                f"{text_verification_correction}\n\n"
                f"{corrected_result}"
            )

        if verification_ok and precision_result and precision_result.get("needs_precision"):
            precision_answer = str(precision_result.get("precision_answer", "") or "").strip()
            if precision_answer:
                sections.append(f"{title_concise_answer}\n\n{precision_answer}")

        sections.append(f"{title_detailed_answer}\n\n{detailed_answer.strip()}")
        return "\n\n---\n\n".join(section for section in sections if section.strip())

    @staticmethod
    def _normalize_math_markdown(content: str) -> str:
        if not content:
            return ""

        normalized = str(content)
        normalized = re.sub(
            r"```(?:latex|math)\s*\n([\s\S]*?)\n```",
            lambda match: f"\n$$\n{match.group(1).strip()}\n$$\n",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = re.sub(r"\\\[([\s\S]*?)\\\]", r"\n$$\n\1\n$$\n", normalized)
        normalized = re.sub(r"\\\(([\s\S]*?)\\\)", r" $\1$ ", normalized)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized.strip()

    async def _execute_tool_calls(
        self,
        step: SolveChainStep,
        solve_memory: SolveMemory,
        citation_memory: CitationMemory,
        output_dir: str | None,
    ) -> dict[str, Any]:
        self._set_agent_status("ToolAgent", "running")
        tool_result = await self.tool_agent.process(
            step=step,
            solve_memory=solve_memory,
            citation_memory=citation_memory,
            kb_name=self.kb_name,
            output_dir=output_dir,
            verbose=False,
        )
        executed = tool_result.get("executed", []) if isinstance(tool_result, dict) else []
        if any(item.get("status") == "failed" for item in executed if isinstance(item, dict)):
            self._set_agent_status("ToolAgent", "error")
        else:
            self._set_agent_status("ToolAgent", "done")
        return tool_result

    @staticmethod
    def _has_pending_tool_calls(step: SolveChainStep) -> bool:
        return any(call.status in {"pending", "running"} for call in step.tool_calls)


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()

    async def test():
        solver = MainSolver(kb_name="ai_textbook")
        result = await solver.solve(question="What is linear convolution?", verbose=True)
        print(f"Output file: {result['output_md']}")

    asyncio.run(test())

