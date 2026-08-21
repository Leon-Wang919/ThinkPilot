#!/usr/bin/env python
"""
InvestigateAgent - Investigator
Generates query actions and calls tools based on current memory and reflections.
"""

from pathlib import Path
import re
import sys
from typing import Any

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

import json

from src.agents.base_agent import BaseAgent
from src.tools import query_numbered_item, rag_search, web_search

from ..memory import CitationMemory, InvestigateMemory, KnowledgeItem
from ..utils.json_utils import extract_json_from_text


class InvestigateAgent(BaseAgent):
    """Investigator Agent - Generates queries and calls tools"""

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
            agent_name="investigate_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
            config=config,
            token_tracker=token_tracker,
        )
        # Read web_search enabled config from tools.web_search.enabled
        self.enable_web_search = config.get("tools", {}).get("web_search", {}).get("enabled", True)

        # Read agent-specific config from solve.agents.investigate_agent
        agent_config = config.get("solve", {}).get("agents", {}).get("investigate_agent", {})
        self.max_actions_per_round = agent_config.get("max_actions_per_round", 1)
        self.max_iterations = agent_config.get("max_iterations", 3)

    async def process(
        self,
        question: str,
        memory: InvestigateMemory,
        citation_memory: CitationMemory,
        kb_name: str = "ai_textbook",
        output_dir: str | None = None,
        verbose: bool = True,
    ) -> dict[str, Any]:
        """
        Process investigation flow (supports multiple tools per round)

        Args:
            question: User question
            memory: Investigation memory
            citation_memory: Citation memory (for registering citations)
            kb_name: Knowledge base name
            output_dir: Output directory
            verbose: Whether to print detailed info

        Returns:
            dict: Investigation result
                {
                    'reasoning': str,
                    'should_stop': bool,
                    'knowledge_item_ids': List[str],
                    'actions': List[Dict[str, Any]]
                }
        """
        if citation_memory is None:
            raise ValueError(
                "citation_memory cannot be None, InvestigateAgent needs it for citation registration"
            )

        # 1. Build context
        context = self._build_context(question, memory)

        # 2. Build prompts
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(context)

        # 3. Call LLM
        response = await self.call_llm(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            verbose=verbose,
            response_format={"type": "json_object"},
        )

        # 4. Parse output (JSON)
        parsed_result = extract_json_from_text(response)

        if not parsed_result or not isinstance(parsed_result, dict):
            self.logger.warning("Parse failed: LLM did not return valid JSON")
            return {
                "reasoning": "Parse failed: invalid JSON",
                "should_stop": True,
                "knowledge_item_ids": [],
                "actions": [],
            }

        reasoning = parsed_result.get("reasoning", "")
        tool_plans = parsed_result.get("plan", [])
        required_evidence = self._normalize_text_list(parsed_result.get("required_evidence"))
        covered_evidence = self._normalize_text_list(parsed_result.get("covered_evidence"))
        unavailable_evidence = self._normalize_text_list(parsed_result.get("unavailable_evidence"))
        knowns = self._normalize_text_list(parsed_result.get("knowns"))
        unknowns = self._normalize_text_list(parsed_result.get("unknowns"))
        constraints = self._normalize_text_list(parsed_result.get("constraints"))

        # Ensure tool_plans is a list (handle case where LLM returns dict instead of list)
        if not isinstance(tool_plans, list):
            if isinstance(tool_plans, dict):
                # If plan is a dict, wrap it in a list
                self.logger.warning("Parse warning: 'plan' field is a dict, wrapping in list")
                tool_plans = [tool_plans]
            else:
                self.logger.warning(
                    "Parse warning: 'plan' field is not a list or dict, using empty list"
                )
                tool_plans = []

        tool_plans = self._normalize_tool_plans(question=question, memory=memory, tool_plans=tool_plans)

        # 5. Determine if should stop
        explicit_should_stop = bool(parsed_result.get("should_stop"))
        unmet_evidence = [
            item
            for item in required_evidence
            if item not in covered_evidence and item not in unavailable_evidence
        ]
        should_stop = explicit_should_stop or (not tool_plans and not unmet_evidence)

        if should_stop:
            self._update_memory_evidence_state(
                memory=memory,
                required_evidence=required_evidence,
                covered_evidence=covered_evidence,
                unavailable_evidence=unavailable_evidence,
                knowns=knowns,
                unknowns=unknowns,
                constraints=constraints,
            )
            if output_dir:
                memory.save()
            return {
                "reasoning": reasoning,
                "should_stop": True,
                "knowledge_item_ids": [],
                "actions": [],
            }

        # 6. Execute multiple tool calls (limited by max_actions_per_round)
        knowledge_ids: list[str] = []
        executed_actions: list[dict[str, Any]] = []
        citation_memory_dirty = False

        # Limit number of actions per round based on config
        tool_plans_to_execute = tool_plans[: self.max_actions_per_round]

        for plan in tool_plans_to_execute:
            tool_type = plan.get("tool")
            if not tool_type:
                continue

            query = plan.get("query", "")
            identifier = plan.get("identifier")

            if tool_type == "none":
                continue

            knowledge_item = await self._execute_single_action(
                tool_selection=tool_type,
                query=query,
                identifier=identifier,
                kb_name=kb_name,
                output_dir=output_dir,
                citation_memory=citation_memory,
            )

            executed_actions.append(
                {
                    "tool_type": tool_type,
                    "query": query,
                    "identifier": identifier,
                    "cite_id": knowledge_item.cite_id if knowledge_item else None,
                }
            )

            if knowledge_item:
                memory.add_knowledge(knowledge_item)
                knowledge_ids.append(knowledge_item.cite_id)
                citation_memory_dirty = True

        self._update_memory_evidence_state(
            memory=memory,
            required_evidence=required_evidence,
            covered_evidence=covered_evidence,
            unavailable_evidence=unavailable_evidence,
            knowns=knowns,
            unknowns=unknowns,
            constraints=constraints,
        )
        if output_dir:
            memory.save()
        if citation_memory_dirty and citation_memory.file_path:
            citation_memory.save()

        # 7. Return results
        return {
            "reasoning": reasoning,
            "should_stop": False,
            "knowledge_item_ids": knowledge_ids,
            "actions": executed_actions,
            "required_evidence": required_evidence,
            "covered_evidence": covered_evidence,
            "unavailable_evidence": unavailable_evidence,
        }

    def _build_context(self, question: str, memory: InvestigateMemory) -> dict[str, Any]:
        """Build context (pass full content, no truncation)"""
        knowledge_chain_full = []
        for item in memory.knowledge_chain:
            knowledge_chain_full.append(
                {
                    "cite_id": item.cite_id,
                    "tool_type": item.tool_type,
                    "query": item.query,
                    "raw_result": item.raw_result,
                    "summary": item.summary,
                }
            )

        remaining_questions_full = []
        if memory.reflections and memory.reflections.remaining_questions:
            remaining_questions_full = memory.reflections.remaining_questions.copy()
        knowledge_chain_summary = (
            "\n".join(
                f"- {item.cite_id} ({item.tool_type}): {item.summary or item.raw_result[:200]}"
                for item in memory.knowledge_chain
            )
            if memory.knowledge_chain
            else "(none)"
        )
        reflections_summary = (
            "\n".join(f"- {q}" for q in remaining_questions_full)
            if remaining_questions_full
            else "(no remaining questions)"
        )

        return {
            "question": question,
            "num_knowledge": len(memory.knowledge_chain),
            "knowledge_chain_full": knowledge_chain_full,
            "knowledge_chain_summary": knowledge_chain_summary,
            "reflections_summary": reflections_summary,
            "remaining_questions": remaining_questions_full,
            "action_queue": "(no action history)",
            "required_evidence": "\n".join(memory.metadata.get("required_evidence", [])) or "(none)",
            "knowns": "\n".join(memory.metadata.get("knowns", [])) or "(none)",
            "unknowns": "\n".join(memory.metadata.get("unknowns", [])) or "(none)",
            "constraints": "\n".join(memory.metadata.get("constraints", [])) or "(none)",
            "grounding_strength": memory.metadata.get("grounding_strength", "low"),
        }

    def _build_system_prompt(self) -> str:
        """Build system prompt"""
        prompt = self.get_prompt("system") if self.has_prompts() else None
        if not prompt:
            raise ValueError(
                "InvestigateAgent missing system prompt. Configure in src/agents/solve/prompts/en/analysis_loop/investigate_agent.yaml"
            )

        # If web_search is disabled, remove web_search related content from prompt
        if not self.enable_web_search:
            # Get the web_search disabled prompt if available, otherwise filter out web_search lines
            web_search_disabled_prompt = (
                self.get_prompt("web_search_disabled") if self.has_prompts() else None
            )
            if web_search_disabled_prompt:
                # Replace web_search description with disabled message
                prompt = prompt.replace(
                    self.get_prompt("web_search_description") or "", web_search_disabled_prompt
                )
            else:
                # Simple filter: remove lines containing web_search tool description
                lines = prompt.split("\n")
                filtered_lines = []
                for line in lines:
                    # Skip lines that describe web_search as an available tool
                    if "`web_search`" in line and (
                        "Use Sparingly" in line or "latest news" in line or "Web Search" in line
                    ):
                        continue
                    # Also remove web_search from tool list in output format
                    if "web_search" in line and (
                        "rag_naive | rag_hybrid |" in line or 'tool":' in line
                    ):
                        line = (
                            line.replace(" | web_search", "")
                            .replace("| web_search", "")
                            .replace("web_search |", "")
                            .replace("web_search", "")
                        )
                    filtered_lines.append(line)
                prompt = "\n".join(filtered_lines)

        return prompt

    def _build_user_prompt(self, context: dict[str, Any]) -> str:
        """Build user prompt (pass full content)"""
        template = self.get_prompt("user_template") if self.has_prompts() else None
        if not template:
            raise ValueError(
                "InvestigateAgent missing user prompt template. Configure in prompts/en/analysis_loop/investigate_agent.yaml"
            )
        return template.format(**context)

    async def _execute_single_action(
        self,
        tool_selection: str,
        query: str,
        identifier: str | None,
        kb_name: str,
        output_dir: str | None,
        citation_memory: CitationMemory,
    ) -> KnowledgeItem | None:
        """Execute a single tool call"""
        import time

        start_time = time.time()
        tool_input = {"query": query, "identifier": identifier, "kb_name": kb_name}

        try:
            if tool_selection == "rag_naive":
                result = await self._call_rag_naive(query, kb_name, output_dir)
                raw_result = result.get("answer", "")

            elif tool_selection == "rag_hybrid":
                result = await self._call_rag_hybrid(query, kb_name, output_dir)
                raw_result = result.get("answer", "")

            elif tool_selection == "web_search":
                # Check if web_search is enabled
                if not self.enable_web_search:
                    self.logger.warning(
                        "Tool call rejected (web_search): web_search is disabled in config"
                    )
                    return None
                result = await self._call_web_search(query, output_dir)
                raw_result = json.dumps(result, ensure_ascii=False, indent=2)

            elif tool_selection == "query_item":
                identifier_to_use = identifier or query

                if (
                    not identifier_to_use
                    or not isinstance(identifier_to_use, str)
                    or not identifier_to_use.strip()
                ):
                    self.logger.warning(
                        "Tool call failed (query_item): identifier is empty or invalid"
                    )
                    return None

                result = await self._call_query_item(identifier_to_use, kb_name)
                raw_result = result.get("content", result.get("answer", ""))

            else:
                self.logger.warning(f"Unknown tool type: {tool_selection}")
                return None

            elapsed_ms = (time.time() - start_time) * 1000

            # Create and register citation
            cite_id = citation_memory.add_citation(
                tool_type=tool_selection,
                query=query,
                raw_result=raw_result,
                stage="analysis",
                metadata={"identifier": identifier},
            )

            # Log tool call
            self.logger.log_tool_call(
                tool_name=tool_selection,
                tool_input=tool_input,
                tool_output=result,
                status="success",
                elapsed_ms=elapsed_ms,
                citation_id=cite_id,
            )

            # Create knowledge item
            knowledge_item = KnowledgeItem(
                cite_id=cite_id,
                tool_type=tool_selection,
                query=query,
                raw_result=raw_result,
                summary="",  # Generated by NoteAgent
                metadata={
                    "identifier": identifier,
                    "source_bucket": "kb"
                    if tool_selection in {"rag_naive", "rag_hybrid", "query_item"}
                    else "web",
                },
            )

            return knowledge_item

        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            error_msg = str(e)

            self.logger.log_tool_call(
                tool_name=tool_selection,
                tool_input=tool_input,
                tool_output=error_msg,
                status="failed",
                elapsed_ms=elapsed_ms,
                error=error_msg,
            )

            self.logger.warning(f"Tool call failed ({tool_selection}): {e}")
            return None

    async def _call_rag_naive(
        self, query: str, kb_name: str, output_dir: str | None
    ) -> dict[str, Any]:
        """Call RAG Naive"""
        return await rag_search(query=query, kb_name=kb_name, mode="naive")

    async def _call_rag_hybrid(
        self, query: str, kb_name: str, output_dir: str | None
    ) -> dict[str, Any]:
        """Call RAG Hybrid"""
        return await rag_search(query=query, kb_name=kb_name, mode="hybrid")

    async def _call_web_search(self, query: str, output_dir: str | None) -> dict[str, Any]:
        """Call Web Search"""
        return web_search(query=query, output_dir=output_dir or "./cache", verbose=False)

    async def _call_query_item(self, identifier: str, kb_name: str) -> dict[str, Any]:
        """Call Query Item"""
        return query_numbered_item(identifier=identifier, kb_name=kb_name)

    def _normalize_text_list(self, value: Any) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            return [stripped] if stripped else []
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        for item in value:
            if not isinstance(item, str):
                continue
            stripped = item.strip()
            if stripped and stripped not in normalized:
                normalized.append(stripped)
        return normalized

    def _normalize_tool_plans(
        self, question: str, memory: InvestigateMemory, tool_plans: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for raw_plan in tool_plans:
            if not isinstance(raw_plan, dict):
                continue
            tool = str(raw_plan.get("tool", "")).strip()
            query = str(raw_plan.get("query", "")).strip()
            identifier = raw_plan.get("identifier")
            if not tool:
                continue

            if (
                tool == "web_search"
                and not self._is_external_query(question=question, query=query)
                and not self._has_prior_kb_attempt(memory, query)
            ):
                tool = "rag_hybrid"

            normalized.append({"tool": tool, "query": query, "identifier": identifier})

        return normalized

    def _is_external_query(self, question: str, query: str) -> bool:
        haystack = f"{question} {query}".lower()
        external_markers = (
            "latest",
            "today",
            "current",
            "news",
            "release notes",
            "version",
            "library",
            "package",
            "api",
            "documentation",
            "最新",
            "今天",
            "当前",
            "版本",
            "库",
            "包",
            "接口",
            "文档",
        )
        return any(marker in haystack for marker in external_markers)

    def _has_prior_kb_attempt(self, memory: InvestigateMemory, query: str) -> bool:
        query_terms = {term for term in re.split(r"\W+", query.lower()) if len(term) > 2}
        if not query_terms:
            return False
        for item in memory.knowledge_chain:
            if item.tool_type not in {"rag_naive", "rag_hybrid", "query_item"}:
                continue
            haystack = f"{item.query} {item.summary} {item.raw_result[:300]}".lower()
            if any(term in haystack for term in query_terms):
                return True
        return False

    def _update_memory_evidence_state(
        self,
        *,
        memory: InvestigateMemory,
        required_evidence: list[str],
        covered_evidence: list[str],
        unavailable_evidence: list[str],
        knowns: list[str],
        unknowns: list[str],
        constraints: list[str],
    ) -> None:
        satisfied_by_kb = [
            item.query
            for item in memory.knowledge_chain
            if item.tool_type in {"rag_naive", "rag_hybrid", "query_item"}
        ]
        satisfied_by_web = [
            item.query for item in memory.knowledge_chain if item.tool_type == "web_search"
        ]

        if satisfied_by_kb and not satisfied_by_web:
            grounding_strength = "high"
        elif satisfied_by_kb and satisfied_by_web:
            grounding_strength = "medium"
        elif satisfied_by_web:
            grounding_strength = "low"
        else:
            grounding_strength = "low"

        memory.update_evidence_state(
            required_evidence=required_evidence,
            covered_evidence=covered_evidence,
            unavailable_evidence=unavailable_evidence,
            knowns=knowns,
            unknowns=unknowns,
            constraints=constraints,
            satisfied_by_kb=satisfied_by_kb,
            satisfied_by_web=satisfied_by_web,
            grounding_strength=grounding_strength,
        )

