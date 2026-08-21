"""
Feynman Graph -LangGraph implementation of the reverse-classroom workflow.

The Feynman technique: the user *teaches* a topic to an AI student.
The AI asks probing follow-up questions, detects logic gaps, and
eventually produces an evaluation report.

Architecture:
    START ->analyze_explanation ->ask_followup ->[enough_rounds?]
        ââ no  ->(wait for user) ->analyze_explanation (loop)
        ââ yes ->generate_report ->END

The graph is invoked once per user turn. Between turns the frontend
holds the accumulated state and feeds it back on the next invocation.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from src.agents.base_agent import BaseAgent
from src.config.accessors import get_subject_config, normalize_subject
from src.graphs.builder import GraphBuilder
from src.graphs.state import FeynmanState
from src.tlogging import get_logger

logger = get_logger("Graphs.Feynman")

# ââ Persona definitions âââââââââââââââââââââââââââââââââââââââââââââ

PERSONAS = {
    "en": {
        "curious_student": {
            "name": "Curious Student",
            "emoji": "🧑‍🎓",
            "system_prompt": (
                "You are a curious but intelligent student. The user is teaching you a topic. "
                "Ask one focused follow-up question at a time, point out unclear logic, and "
                "gently challenge gaps in understanding. Keep responses concise."
            ),
        },
        "skeptical_peer": {
            "name": "Skeptical Peer",
            "emoji": "🤔",
            "system_prompt": (
                "You are a skeptical peer reviewer. Challenge assumptions, ask for evidence, "
                "and request clarification when the explanation is vague. Be respectful but rigorous."
            ),
        },
        "rigorous_reviewer": {
            "name": "Rigorous Reviewer",
            "emoji": "🧾",
            "system_prompt": (
                "You are a rigorous peer reviewer. Ask one focused question at a time and audit "
                "the teacher's explanation for definition precision, evidence sufficiency, logical "
                "consistency, and boundary conditions. Be respectful but academically strict."
            ),
        },
    },
    "zh": {
        "curious_student": {
            "name": "好奇学生",
            "emoji": "🧑‍🎓",
            "system_prompt": (
                "你是一个好奇而聪明的学生。用户正在向你讲解一个主题。"
                "请一次只提出一个聚焦的追问，指出不清楚或自相矛盾的地方，"
                "并在发现理解漏洞时温和地追问。回复保持简洁。"
            ),
        },
        "skeptical_peer": {
            "name": "质疑同伴",
            "emoji": "🤔",
            "system_prompt": (
                "你是一个严谨的同伴评审者。请质疑关键假设，要求证据或例子，"
                "并在表述模糊时要求澄清。语气尊重但保持批判性。"
            ),
        },
        "rigorous_reviewer": {
            "name": "严审同侪",
            "emoji": "🧾",
            "system_prompt": (
                "你是一个严谨的同侪审稿人。请一次只提一个聚焦问题，重点审查"
                "术语定义是否准确、证据是否充分、推理链条是否闭合、结论边界是否说明。"
                "语气保持尊重，但标准要严格。"
            ),
        },
    },
}

PERSONA_ALIASES = {
    "young_learner": "rigorous_reviewer",
}


def _normalize_persona_key(language: str, persona_key: str | None) -> str:
    """Map legacy persona keys and provide a safe fallback."""
    lang_personas = PERSONAS.get(language, PERSONAS["en"])
    candidate = (persona_key or "").strip()
    if candidate in PERSONA_ALIASES:
        candidate = PERSONA_ALIASES[candidate]
    if candidate in lang_personas:
        return candidate
    return "curious_student"


class _FeynmanLLMAgent(BaseAgent):
    """Minimal concrete agent wrapper for graph-side LLM calls."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        language: str = "zh",
        api_version: str | None = None,
        binding: str = "openai",
    ):
        super().__init__(
            module_name="feynman",
            agent_name="turn_agent",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
            binding=binding,
        )

    async def process(self, *args, **kwargs) -> dict[str, Any]:
        return {}
ANALYSIS_SYSTEM_PROMPTS = {
    "en": (
        "You are an expert educational evaluator. Analyze the user's explanation of a topic "
        "and identify:\n"
        "1. Key concepts they covered correctly\n"
        "2. Logic gaps or misconceptions\n"
        "3. Areas that need deeper explanation\n"
        "4. Overall clarity and completeness\n\n"
        "Output a JSON object with these fields:\n"
        '- "covered_concepts": list of strings (concepts explained well)\n'
        '- "logic_gaps": list of strings (gaps or errors found)\n'
        '- "clarity_score": integer 1-10\n'
        '- "completeness_score": integer 1-10\n'
        '- "topic_relevance_score": integer 0-100\n'
        '- "suggested_followup": string (the best follow-up question to ask)\n\n'
        "Scoring policy: if explanation is mostly off-topic or unrelated to the topic, set "
        "clarity_score=0 and completeness_score=0.\n"
        "Be thorough but fair. Output ONLY valid JSON, no markdown."
    ),
    "zh": (
        "你是一位专业的教育评估专家。请分析用户对某个主题的讲解，"
        "识别他们正确覆盖的概念、逻辑漏洞、仍需深入解释的部分，以及整体清晰度和完整度。"
        "请输出有效 JSON，包含 covered_concepts、logic_gaps、clarity_score、"
        "completeness_score、topic_relevance_score 和 suggested_followup 字段。"
        "评分规则：若回答与主题大部分无关，清晰度和完整度都必须给 0 分。"
        "当 language=zh 时，所有字符串字段必须输出中文。"
    ),
}


def _extract_topic_tokens(text: str) -> set[str]:
    lowered = text.lower()
    tokens: set[str] = set()

    for item in re.findall(r"[a-z0-9_+\-]{2,}", lowered):
        tokens.add(item)

    for seq in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        tokens.add(seq)
        if len(seq) <= 6:
            continue
        # Add bigrams for long Chinese terms to tolerate paraphrasing.
        for i in range(len(seq) - 1):
            tokens.add(seq[i : i + 2])

    return tokens


def _apply_relevance_gate(
    *,
    topic: str,
    explanation: str,
    analysis: dict[str, Any],
    language: str,
) -> dict[str, Any]:
    topic_tokens = _extract_topic_tokens(topic)
    explanation_tokens = _extract_topic_tokens(explanation)

    lexical_relevance = 0.0
    if topic_tokens:
        overlap = len(topic_tokens & explanation_tokens)
        lexical_relevance = (overlap / max(len(topic_tokens), 1)) * 100.0

    llm_relevance_raw = analysis.get("topic_relevance_score", 0)
    try:
        llm_relevance = float(llm_relevance_raw)
    except (TypeError, ValueError):
        llm_relevance = 0.0

    normalized_relevance = int(max(0.0, min(100.0, max(lexical_relevance, llm_relevance))))
    analysis["topic_relevance_score"] = normalized_relevance

    if normalized_relevance < 25:
        analysis["clarity_score"] = 0
        analysis["completeness_score"] = 0
        if language == "zh":
            analysis["logic_gaps"] = ["回答与当前主题相关性极低，未形成有效讲解。"]
            analysis["suggested_followup"] = "请先用一句话定义该主题，再说明它的核心步骤或关键概念。"
        else:
            analysis["logic_gaps"] = ["The explanation is largely off-topic and does not teach the target topic."]
            analysis["suggested_followup"] = (
                "Please start by defining the topic in one sentence, then explain its core steps."
            )

    return analysis

REPORT_SYSTEM_PROMPTS = {
    "en": (
        "You are an expert educational evaluator. Generate a strict evidence-based report from "
        "the teaching transcript.\n"
        "Output JSON ONLY with fields:\n"
        '- "overall_assessment": string\n'
        '- "strengths": list[string]\n'
        '- "knowledge_gaps": list[string]\n'
        '- "recommendations": list[string]\n\n'
        "Do not output mastery score in JSON; it is computed by system guardrails."
    ),
    "zh": (
        "你是一位专业的教育评估专家。请基于教学会话文本生成严格、可追溯证据的评估。"
        "只输出 JSON，字段必须包含："
        "overall_assessment（字符串）、strengths（字符串数组）、"
        "knowledge_gaps（字符串数组）、recommendations（字符串数组）。"
        "不要输出掌握度评分，掌握度由系统护栏计算。"
        "当 language=zh 时，所有字符串字段必须为中文。"
    ),
}


def _collect_user_teaching_turns(messages: list[dict[str, Any]]) -> list[str]:
    turns: list[str] = []
    for msg in messages:
        role = msg.get("role", "") if isinstance(msg, dict) else getattr(msg, "role", "")
        content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
        if role != "user":
            continue
        text = str(content or "").strip()
        if not text or text.startswith("[Session ended"):
            continue
        turns.append(text)
    return turns


def _compute_mastery_guardrail(
    *,
    topic: str,
    messages: list[dict[str, Any]],
    latest_analysis: dict[str, Any],
) -> dict[str, Any]:
    turns = _collect_user_teaching_turns(messages)
    total_chars = sum(len(item) for item in turns)

    topic_tokens = _extract_topic_tokens(topic)
    user_tokens: set[str] = set()
    for text in turns:
        user_tokens |= _extract_topic_tokens(text)

    lexical_relevance = 0
    if topic_tokens:
        lexical_relevance = int((len(topic_tokens & user_tokens) / max(len(topic_tokens), 1)) * 100)

    try:
        clarity = float(latest_analysis.get("clarity_score", 0))
    except (TypeError, ValueError):
        clarity = 0.0
    try:
        completeness = float(latest_analysis.get("completeness_score", 0))
    except (TypeError, ValueError):
        completeness = 0.0

    base_score = int(round(0.5 * lexical_relevance + 0.25 * (clarity * 10) + 0.25 * (completeness * 10)))

    cap = 90
    if lexical_relevance < 25:
        cap = 10
    elif total_chars < 20:
        cap = 20
    elif total_chars < 60:
        cap = 35
    elif len(turns) <= 1:
        cap = 45

    mastery_score = max(0, min(cap, base_score))
    evidence = [item[:120] for item in turns[:3]]

    return {
        "mastery_score": mastery_score,
        "lexical_relevance": lexical_relevance,
        "turn_count": len(turns),
        "total_chars": total_chars,
        "evidence": evidence,
    }


def _format_report_markdown(
    *,
    language: str,
    topic: str,
    persona_name: str,
    report: dict[str, Any],
    guardrail: dict[str, Any],
) -> str:
    strengths = report.get("strengths") or []
    gaps = report.get("knowledge_gaps") or []
    recs = report.get("recommendations") or []
    overview = str(report.get("overall_assessment") or "").strip()

    if not isinstance(strengths, list):
        strengths = []
    if not isinstance(gaps, list):
        gaps = []
    if not isinstance(recs, list):
        recs = []

    if language == "zh":
        lines = [
            f"## 教学评估报告（{topic}）",
            "",
            f"- 学生身份：{persona_name}",
            f"- 相关性：{guardrail['lexical_relevance']}/100",
            f"- 讲解轮次：{guardrail['turn_count']}",
            "",
            "### 总体评价",
            overview or "本轮讲解信息不足，无法形成高质量掌握证明。",
            "",
            "### 优势",
        ]
        lines.extend([f"- {item}" for item in strengths] or ["- 暂未观察到稳定优势。"])
        lines.extend([
            "",
            "### 知识漏洞",
        ])
        lines.extend([f"- {item}" for item in gaps] or ["- 暂无可归纳漏洞。"])
        lines.extend([
            "",
            "### 复习建议",
        ])
        lines.extend([f"- {item}" for item in recs] or ["- 先补充定义、步骤和示例，再进行下一轮讲解。"])
        lines.extend([
            "",
            "### 证据片段",
        ])
        lines.extend([f"- {item}" for item in guardrail["evidence"]] or ["- 无有效讲解片段。"])
        lines.extend([
            "",
            f"### 掌握度评分\n{guardrail['mastery_score']}/100",
        ])
        return "\n".join(lines)

    lines = [
        f"## Teaching Evaluation Report ({topic})",
        "",
        f"- Student persona: {persona_name}",
        f"- Relevance: {guardrail['lexical_relevance']}/100",
        f"- Teaching turns: {guardrail['turn_count']}",
        "",
        "### Overall Assessment",
        overview or "The explanation is too limited to demonstrate solid mastery.",
        "",
        "### Strengths",
    ]
    lines.extend([f"- {item}" for item in strengths] or ["- No stable strengths observed."])
    lines.extend(["", "### Knowledge Gaps"])
    lines.extend([f"- {item}" for item in gaps] or ["- No reliable gaps extracted."])
    lines.extend(["", "### Recommendations"])
    lines.extend([f"- {item}" for item in recs] or ["- Rebuild with definition, steps, and a concrete example."])
    lines.extend(["", "### Evidence Snippets"])
    lines.extend([f"- {item}" for item in guardrail["evidence"]] or ["- No valid teaching snippet."])
    lines.extend(["", f"### Mastery Score\n{guardrail['mastery_score']}/100"])
    return "\n".join(lines)


def _get_prompt(prompts: dict[str, str], language: str) -> str:
    """Get prompt for the given language, falling back to English."""
    return prompts.get(language, prompts["en"])


def _compose_subject_prompt(subject: str, language: str, base_prompt: str) -> str:
    subject_name = normalize_subject(subject)
    subject_config = get_subject_config(subject_name)
    prefix = subject_config.system_prompt_prefix.strip()
    subject_note = (
        f"Current subject lens: {subject_name}."
        if language == "en"
        else f"当前学科视角：{subject_name}。"
    )
    parts = [part for part in (prefix, subject_note, base_prompt) if part]
    return "\n\n".join(parts)


def _compose_reference_context(state: FeynmanState, language: str) -> str:
    notes = (state.get("reference_notes") or "").strip()
    if not notes:
        return ""

    label = (state.get("reference_source_label") or "").strip()
    if language == "en":
        header = "Reference notes provided by user"
        if label:
            header = f"{header} ({label})"
        return (
            f"{header}:\n"
            "You must read this reference carefully and use it as evidence when auditing the explanation.\n"
            f"{notes}\n"
        )

    header = "用户提供的参考笔记"
    if label:
        header = f"{header}（{label}）"
    return (
        f"{header}：\n"
        "你必须完整阅读这份参考笔记，并在评估讲解时以其为依据。\n"
        f"{notes}\n"
    )


def build_feynman_graph(
    subject: str = "science",
    api_key: str = "",
    base_url: str = "",
    language: str = "zh",
    api_version: str | None = None,
    binding: str = "openai",
) -> Any:
    """
    Build and compile the Feynman reverse-classroom LangGraph.

    The graph processes one user turn at a time:
    - analyze_explanation: Evaluate the user's teaching attempt
    - ask_followup: Generate a follow-up question as the AI student
    - generate_report: Produce a final evaluation (when session ends)

    Returns:
        A compiled LangGraph runnable.
    """
    base_agent = _FeynmanLLMAgent(
        api_key=api_key,
        base_url=base_url,
        language=language,
        api_version=api_version,
        binding=binding,
    )

    # ââ Nodes ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    async def analyze_explanation(state: FeynmanState) -> dict[str, Any]:
        """Analyze the user's explanation for gaps and correctness."""
        start = time.time()
        logger.info("[analyze_explanation] Evaluating user explanation")

        topic = state.get("topic", "")
        subject_name = state.get("subject", subject)
        explanation = state.get("user_explanation", "")
        existing_gaps = state.get("logic_gaps", [])
        reference_context = _compose_reference_context(state, language)
        if not explanation.strip() and not state.get("should_continue", True):
            return {
                "evaluation_report": state.get("evaluation_report", {}),
                "logic_gaps": existing_gaps,
                "follow_up_questions": [],
                "current_node": "analyze_explanation",
                "intermediate_steps": [{"node": "analyze_explanation", "duration": 0.0}],
            }

        conversation_context = ""
        for msg in state.get("messages", []):
            role = msg.get("role", "user") if isinstance(msg, dict) else getattr(msg, "role", "user")
            content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
            conversation_context += f"\n{role}: {content}"

        user_prompt = (
            f"Subject lens: {subject_name}\n\n"
            f"Topic being taught: {topic}\n\n"
            f"{reference_context}\n"
            f"Conversation so far:{conversation_context}\n\n"
            f"Latest explanation from the teacher:\n{explanation}\n\n"
            f"Previously identified gaps: {json.dumps(existing_gaps)}\n\n"
            "Analyze this explanation and output JSON."
        )

        if hasattr(base_agent, "refresh_config"):
            base_agent.refresh_config()

        response = await base_agent.call_llm(
            user_prompt=user_prompt,
            system_prompt=_compose_subject_prompt(
                subject_name,
                language,
                _get_prompt(ANALYSIS_SYSTEM_PROMPTS, language),
            ),
            response_format={"type": "json_object"},
            stage="analyze_explanation",
        )

        try:
            analysis = json.loads(response)
        except (json.JSONDecodeError, TypeError):
            analysis = {
                "covered_concepts": [],
                "logic_gaps": [],
                "clarity_score": 5,
                "completeness_score": 5,
                "topic_relevance_score": 0,
                "suggested_followup": "Can you explain that in more detail?",
            }

        analysis = _apply_relevance_gate(
            topic=topic,
            explanation=explanation,
            analysis=analysis,
            language=language,
        )

        new_gaps = analysis.get("logic_gaps", [])

        elapsed = time.time() - start
        logger.info(f"[analyze_explanation] Done in {elapsed:.2f}s, found {len(new_gaps)} gaps")

        return {
            "evaluation_report": analysis,
            "logic_gaps": new_gaps,
            "follow_up_questions": [analysis.get("suggested_followup", "")],
            "current_node": "analyze_explanation",
            "intermediate_steps": [{"node": "analyze_explanation", "duration": elapsed}],
        }

    async def ask_followup(state: FeynmanState) -> dict[str, Any]:
        """Generate a follow-up question as the AI student persona."""
        start = time.time()
        persona_key = _normalize_persona_key(language, state.get("persona", "curious_student"))
        lang_personas = PERSONAS.get(language, PERSONAS["en"])
        persona = lang_personas.get(persona_key, lang_personas["curious_student"])
        logger.info(f"[ask_followup] Generating question as {persona['name']}")

        topic = state.get("topic", "")
        subject_name = state.get("subject", subject)
        explanation = state.get("user_explanation", "")
        analysis = state.get("evaluation_report", {})
        suggested = analysis.get("suggested_followup", "")
        reference_context = _compose_reference_context(state, language)

        conversation_context = ""
        for msg in state.get("messages", []):
            role = msg.get("role", "user") if isinstance(msg, dict) else getattr(msg, "role", "user")
            content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
            conversation_context += f"\n{role}: {content}"

        user_prompt = (
            f"Subject lens: {subject_name}\n\n"
            f"Topic: {topic}\n\n"
            f"{reference_context}\n"
            f"Conversation so far:{conversation_context}\n\n"
            f"The teacher just said:\n{explanation}\n\n"
            f"Analysis suggests asking about: {suggested}\n"
            f"Identified gaps: {json.dumps(analysis.get('logic_gaps', []))}\n\n"
            "Respond in character. Ask your follow-up question."
        )

        if hasattr(base_agent, "refresh_config"):
            base_agent.refresh_config()

        response = await base_agent.call_llm(
            user_prompt=user_prompt,
            system_prompt=_compose_subject_prompt(subject_name, language, persona["system_prompt"]),
            stage="ask_followup",
        )

        elapsed = time.time() - start
        logger.info(f"[ask_followup] Done in {elapsed:.2f}s")

        return {
            "final_answer": response,
            "current_node": "ask_followup",
            "intermediate_steps": [{"node": "ask_followup", "duration": elapsed}],
        }

    async def generate_report(state: FeynmanState) -> dict[str, Any]:
        """Generate a comprehensive evaluation report for the teaching session."""
        start = time.time()
        logger.info("[generate_report] Generating final evaluation")

        topic = state.get("topic", "")
        subject_name = state.get("subject", subject)
        all_gaps = state.get("logic_gaps", [])
        latest_analysis = state.get("evaluation_report", {})
        persona_key = _normalize_persona_key(language, state.get("persona", "curious_student"))
        lang_personas = PERSONAS.get(language, PERSONAS["en"])
        persona_name = lang_personas.get(persona_key, lang_personas["curious_student"])["name"]
        reference_context = _compose_reference_context(state, language)

        message_list = state.get("messages", [])
        conversation_context = ""
        for msg in message_list:
            role = msg.get("role", "user") if isinstance(msg, dict) else getattr(msg, "role", "user")
            content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
            conversation_context += f"\n{role}: {content}"

        guardrail = _compute_mastery_guardrail(
            topic=topic,
            messages=message_list,
            latest_analysis=latest_analysis,
        )

        user_prompt = (
            f"Subject lens: {subject_name}\n\n"
            f"Topic: {topic}\n\n"
            f"Student persona: {persona_name}\n"
            f"System guardrail metrics: {json.dumps(guardrail, ensure_ascii=False)}\n\n"
            f"{reference_context}\n"
            f"Full teaching session:{conversation_context}\n\n"
            f"All identified knowledge gaps throughout the session:\n"
            f"{json.dumps(all_gaps)}\n\n"
            "Generate a structured evaluation report JSON."
        )

        if hasattr(base_agent, "refresh_config"):
            base_agent.refresh_config()

        response = await base_agent.call_llm(
            user_prompt=user_prompt,
            system_prompt=_compose_subject_prompt(
                subject_name,
                language,
                _get_prompt(REPORT_SYSTEM_PROMPTS, language),
            ),
            response_format={"type": "json_object"},
            stage="generate_report",
        )

        try:
            report_obj = json.loads(response)
            if not isinstance(report_obj, dict):
                report_obj = {}
        except (json.JSONDecodeError, TypeError):
            report_obj = {}

        report_markdown = _format_report_markdown(
            language=language,
            topic=topic,
            persona_name=persona_name,
            report=report_obj,
            guardrail=guardrail,
        )

        elapsed = time.time() - start
        logger.info(f"[generate_report] Done in {elapsed:.2f}s")

        return {
            "final_answer": report_markdown,
            "current_node": "generate_report",
            "intermediate_steps": [{"node": "generate_report", "duration": elapsed}],
        }

    # ââ Condition ââââââââââââââââââââââââââââââââââââââââââââââââââââ

    def should_generate_report(state: FeynmanState) -> str:
        """Decide whether to ask another question or generate the final report."""
        if state.get("error"):
            return "report"

        iteration = state.get("iteration_count", 0)
        max_iter = state.get("max_iterations", 10)

        if iteration >= max_iter:
            return "report"

        if not state.get("should_continue", True):
            return "report"

        return "followup"

    # ââ Build Graph ââââââââââââââââââââââââââââââââââââââââââââââââââ

    builder = GraphBuilder(FeynmanState, name="feynman")

    builder.add_node("analyze_explanation", analyze_explanation)
    builder.add_node("ask_followup", ask_followup)
    builder.add_node("generate_report", generate_report)

    builder.set_entry("analyze_explanation")
    builder.add_conditional_edge(
        "analyze_explanation",
        should_generate_report,
        {"followup": "ask_followup", "report": "generate_report"},
    )
    builder.set_finish("ask_followup")
    builder.set_finish("generate_report")

    return builder.compile()


async def run_feynman_turn(
    topic: str,
    user_explanation: str,
    subject: str = "science",
    messages: list[dict[str, str]] | None = None,
    logic_gaps: list[str] | None = None,
    persona: str = "curious_student",
    iteration_count: int = 0,
    max_iterations: int = 10,
    should_continue: bool = True,
    language: str = "zh",
    api_key: str = "",
    base_url: str = "",
    reference_notes: str | None = None,
    reference_source_label: str | None = None,
) -> dict[str, Any]:
    """
    Run one turn of the Feynman teaching session.

    Each call processes the user's latest explanation, analyzes it,
    and returns either a follow-up question or a final report.

    Args:
        topic: The topic being taught.
        user_explanation: The user's latest teaching attempt.
        messages: Conversation history.
        logic_gaps: Previously identified gaps.
        persona: AI student persona key.
        iteration_count: Current round number.
        max_iterations: Max rounds before auto-generating report.
        should_continue: Whether to continue or generate report.
        language: Language setting.
        api_key: LLM API key.
        base_url: LLM API endpoint.

    Returns:
        Dict with ``response``, ``logic_gaps``, ``evaluation``,
        ``is_report`` (bool), and ``persona_info``.
    """
    subject_name = normalize_subject(subject)
    graph = build_feynman_graph(
        subject=subject_name,
        api_key=api_key,
        base_url=base_url,
        language=language,
    )

    initial_state: FeynmanState = {
        "subject": subject_name,
        "topic": topic,
        "user_explanation": user_explanation,
        "persona": persona,
        "messages": messages or [],
        "logic_gaps": logic_gaps or [],
        "iteration_count": iteration_count,
        "max_iterations": max_iterations,
        "should_continue": should_continue,
        "language": language,
        "current_query": user_explanation,
        "citations": [],
        "tool_results": [],
        "intermediate_steps": [],
        "follow_up_questions": [],
        "stream_tokens": False,
        "reference_notes": reference_notes or "",
        "reference_source_label": reference_source_label or "",
    }

    result = await graph.ainvoke(initial_state)

    is_report = result.get("current_node") == "generate_report"
    lang_personas = PERSONAS.get(language, PERSONAS["en"])
    normalized_persona = _normalize_persona_key(language, persona)
    persona_info = lang_personas.get(normalized_persona, lang_personas["curious_student"])

    return {
        "response": result.get("final_answer", ""),
        "logic_gaps": result.get("logic_gaps", []),
        "evaluation": result.get("evaluation_report", {}),
        "is_report": is_report,
        "persona_info": {
            "name": persona_info["name"],
            "emoji": persona_info["emoji"],
        },
    }

