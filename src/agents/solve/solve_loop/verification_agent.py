#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
VerificationAgent - Final answer verification before formatting.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

project_root = Path(__file__).parent.parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from src.agents.base_agent import BaseAgent


class VerificationAgent(BaseAgent):
    """Structured final-answer verifier."""

    def __init__(
        self,
        config: dict[str, Any],
        api_key: str,
        base_url: str,
        api_version: str | None = None,
        token_tracker=None,
    ):
        language = config.get("system", {}).get("language", "zh")
        super().__init__(
            module_name="solve",
            agent_name="verification_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
            config=config,
            token_tracker=token_tracker,
        )

    async def process(
        self,
        *,
        question: str,
        detailed_answer: str,
        step_summaries: str,
        citation_summary: str,
        grounding_strength: str,
        code_verification_result: str = "",
        verbose: bool = True,
    ) -> dict[str, Any]:
        system_prompt = self.get_prompt("system") if self.has_prompts() else None
        if not system_prompt:
            raise ValueError(
                "VerificationAgent missing system prompt, please configure prompts/{lang}/solve_loop/verification_agent.yaml"
            )

        template = self.get_prompt("user_template") if self.has_prompts() else None
        if not template:
            raise ValueError(
                "VerificationAgent missing user_template, please configure prompts/{lang}/solve_loop/verification_agent.yaml"
            )

        user_prompt = template.format(
            question=question,
            detailed_answer=detailed_answer,
            step_summaries=step_summaries or "(No step summaries)",
            citation_summary=citation_summary or "(No citation summary)",
            grounding_strength=grounding_strength or "low",
            code_verification_result=code_verification_result or "(No code verification result)",
        )

        response = await self.call_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            verbose=verbose,
            response_format={"type": "json_object"},
        )

        try:
            parsed = json.loads(response)
        except json.JSONDecodeError:
            parsed = {}

        confidence_raw = parsed.get("confidence", 0.0) if isinstance(parsed, dict) else 0.0
        try:
            confidence = float(confidence_raw)
        except (TypeError, ValueError):
            confidence = 0.0

        issues = parsed.get("issues", []) if isinstance(parsed, dict) else []
        if not isinstance(issues, list):
            issues = [str(issues)]

        evidence_basis = parsed.get("evidence_basis", []) if isinstance(parsed, dict) else []
        if not isinstance(evidence_basis, list):
            evidence_basis = [str(evidence_basis)]

        corrected_result = ""
        if isinstance(parsed, dict):
            corrected_result = str(parsed.get("corrected_result", "") or "").strip()

        passed = bool(parsed.get("passed")) if isinstance(parsed, dict) else False
        if not passed and confidence >= 0.85 and not issues:
            passed = True

        return {
            "passed": passed,
            "confidence": max(0.0, min(confidence, 1.0)),
            "issues": [str(item) for item in issues if str(item).strip()],
            "corrected_result": corrected_result,
            "evidence_basis": [str(item) for item in evidence_basis if str(item).strip()],
            "raw_response": response,
        }
