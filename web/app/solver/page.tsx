"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CircleCheck,
  Loader2,
  RefreshCw,
  Square,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { useGlobal } from "@/context/GlobalContext";
import { apiUrl, API_BASE_URL, wsUrl } from "@/lib/api";
import { processLatexContent } from "@/lib/latex";
import { Composer, Panel } from "@/components/ui";
import AddToNotebookModal from "@/components/AddToNotebookModal";
import type { Subject } from "@/types/subject";

interface KnowledgeBase {
  name: string;
  subject: Subject;
  is_default?: boolean;
}

type ExplainLevel = "easy" | "medium" | "hard";

const EXPLAIN_LENGTH_RANGE: Record<ExplainLevel, string> = {
  easy: "80-140",
  medium: "180-280",
  hard: "320-520",
};

const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_RIGHT_PANEL_WIDTH = 620;

const clampRightPanelWidth = (value: number) =>
  Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, value));

const resolveArtifactUrl = (url?: string, outputDir?: string) => {
  if (!url) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const normalized = url.replace(/^\.\//, "");
  if (normalized.startsWith("/api/outputs/")) {
    return `${API_BASE_URL}${normalized}`;
  }
  if (normalized.startsWith("api/outputs/")) {
    return `${API_BASE_URL}/${normalized}`;
  }
  if (normalized.startsWith("artifacts/") && outputDir) {
    return `${API_BASE_URL}/api/outputs/solve/${outputDir}/${normalized}`;
  }

  return url;
};

export default function SolverPage() {
  const { t } = useTranslation();
  const {
    currentSubject,
    solverState,
    startSolver,
    stopSolver,
    newSolverSession,
    setSolverState,
  } = useGlobal();

  const [input, setInput] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [isNotebookModalOpen, setIsNotebookModalOpen] = useState(false);
  const [pendingNotebookRecord, setPendingNotebookRecord] = useState<{
    title: string;
    userQuery: string;
    output: string;
    metadata: Record<string, unknown>;
  } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const explainWsRef = useRef<WebSocket | null>(null);
  const [rightPaneWidth, setRightPaneWidth] = useState(320);
  const [draggingDivider, setDraggingDivider] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartRightRef = useRef(320);
  const [selectionAction, setSelectionAction] = useState<{
    visible: boolean;
    text: string;
    x: number;
    y: number;
    assistantIndex: number;
    assistantContent: string;
    userQuestion: string;
  }>({
    visible: false,
    text: "",
    x: 0,
    y: 0,
    assistantIndex: -1,
    assistantContent: "",
    userQuestion: "",
  });
  const [explainPanel, setExplainPanel] = useState<{
    selectedText: string;
    sourceQuestion: string;
    level: ExplainLevel;
    lengthRange: string;
    answer: string;
    isLoading: boolean;
    error: string;
  }>({
    selectedText: "",
    sourceQuestion: "",
    level: "medium",
    lengthRange: EXPLAIN_LENGTH_RANGE.medium,
    answer: "",
    isLoading: false,
    error: "",
  });

  const trimForTitle = (text: string, maxLength = 42) => {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) {
      return compact;
    }
    return `${compact.slice(0, maxLength - 1)}…`;
  };

  const stripMarkdown = (text: string) => {
    if (!text) {
      return "";
    }
    return text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/\$[^$]+\$/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const pickFinalAnswer = (answer: string) => {
    const patterns = [
      /(?:^|\n)#{0,3}\s*(?:最终答案|答案|Final Answer|Answer)\s*[:：]?\s*([\s\S]*)$/i,
      /(?:^|\n)因此[，,]?\s*([\s\S]{20,})$/,
    ];

    for (const pattern of patterns) {
      const match = answer.match(pattern);
      if (match?.[1]?.trim()) {
        return stripMarkdown(match[1]).slice(0, 360);
      }
    }

    const plain = stripMarkdown(answer);
    return plain.slice(0, 360);
  };

  const buildAnswerSummary = (answer: string) => {
    const plain = stripMarkdown(answer);
    const sentences = plain
      .split(/(?<=[。！？.!?])\s+|\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const summary = sentences.slice(0, 2).join(" ");
    if (summary) {
      return summary.slice(0, 220);
    }
    return plain.slice(0, 220);
  };

  const buildNotebookOutput = (question: string, answer: string) => {
    const plain = stripMarkdown(answer);
    const answerSummary = buildAnswerSummary(answer);
    const paragraphs = plain
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const keySteps = paragraphs
      .filter((line) =>
        /步骤|step|先|再|因此|所以|because|thus|由此|可得/i.test(line),
      )
      .slice(0, 3);

    const commonPitfall =
      paragraphs.find((line) => /易错|注意|陷阱|误区|pitfall|careful/i.test(line)) ||
      t("Review variable definitions and unit consistency before final substitution.");

    const conclusion = paragraphs[0] || plain.slice(0, 220);
    const finalAnswer = pickFinalAnswer(answer);

    return [
      "## 解题笔记（提炼版）",
      "",
      `### 题目`,
      question || t("(No question captured)"),
      "",
      "### 概括解答",
      answerSummary || t("(No summary extracted)"),
      "",
      "### 核心结论",
      conclusion || t("(No summary extracted)"),
      "",
      "### 关键步骤",
      keySteps.length > 0
        ? keySteps.map((line, idx) => `${idx + 1}. ${line}`).join("\n")
        : t("1. Break the problem into known conditions and target quantity.\n2. Apply the matching principle/formula carefully.\n3. Verify the final result with constraints."),
      "",
      "### 易错点",
      commonPitfall,
      "",
      "### 最终答案",
      finalAnswer || t("(Answer not clearly detected)"),
    ].join("\n");
  };

  const getLinkedUserQuestion = (assistantIndex: number) => {
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      const message = solverState.messages[i];
      if (message?.role === "user" && message.content?.trim()) {
        return message.content.trim();
      }
    }
    return "";
  };

  const openNotebookForAssistantMessage = (assistantIndex: number, answer: string) => {
    const userQuestion = getLinkedUserQuestion(assistantIndex);
    const refinedOutput = buildNotebookOutput(userQuestion, answer);
    const summaryTitle = buildAnswerSummary(answer);
    const titleBase = summaryTitle || userQuestion || t("Smart Solver Note");

    setPendingNotebookRecord({
      title: `${t("Smart Solver")} · ${trimForTitle(titleBase)}`,
      userQuery: userQuestion || t("No explicit user question was captured for this answer."),
      output: refinedOutput,
      metadata: {
        source: "solver",
        subject: currentSubject,
        selected_kb: solverState.selectedKb || null,
        message_index: assistantIndex,
        refined: true,
        refinement_version: "v1-rule-based",
        summary: summaryTitle,
        original_output: answer,
      },
    });
    setIsNotebookModalOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams({ subject: currentSubject });
    fetch(apiUrl(`/api/v1/knowledge/list?${params.toString()}`))
      .then((res) => res.json())
      .then((data) => {
        const items = Array.isArray(data) ? (data as KnowledgeBase[]) : [];
        setKnowledgeBases(items);

        const defaultKb = items.find((item) => item.is_default)?.name || items[0]?.name || "";
        setSolverState((prev) => {
          if (!defaultKb) {
            return { ...prev, selectedKb: "" };
          }
          if (prev.selectedKb && items.some((item) => item.name === prev.selectedKb)) {
            return prev;
          }
          return { ...prev, selectedKb: defaultKb };
        });
      })
      .catch((error) => {
        console.error("Failed to fetch solver knowledge bases:", error);
        setKnowledgeBases([]);
      });
  }, [currentSubject, setSolverState]);

  useEffect(() => {
    if (!messagesRef.current) {
      return;
    }
    messagesRef.current.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [solverState.messages, solverState.logs]);

  const submitSolve = () => {
    const question = input.trim();
    if (!question || solverState.isSolving) {
      return;
    }
    startSolver(question, solverState.selectedKb || "");
    setInput("");
  };

  const hideSelectionAction = () => {
    setSelectionAction((prev) => ({
      ...prev,
      visible: false,
    }));
  };

  const handleAssistantMouseUp = (
    event: React.MouseEvent<HTMLDivElement>,
    assistantIndex: number,
    assistantContent: string,
  ) => {
    if (solverState.isSolving) {
      hideSelectionAction();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideSelectionAction();
      return;
    }

    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    if (selectedText.length < 2 || selectedText.length > 260) {
      hideSelectionAction();
      return;
    }

    const range = selection.getRangeAt(0);
    const container = event.currentTarget;
    if (!container.contains(range.commonAncestorContainer)) {
      hideSelectionAction();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      hideSelectionAction();
      return;
    }

    const x = Math.min(
      Math.max(rect.left + rect.width / 2, 70),
      window.innerWidth - 70,
    );
    const y = Math.max(rect.top - 10, 54);
    setSelectionAction({
      visible: true,
      text: selectedText,
      x,
      y,
      assistantIndex,
      assistantContent,
      userQuestion: getLinkedUserQuestion(assistantIndex),
    });
  };

  const handleExplainSelection = () => {
    if (!selectionAction.text || solverState.isSolving || explainPanel.isLoading) {
      return;
    }

    const detectExplainLevel = (text: string): ExplainLevel => {
      const compact = text.replace(/\s+/g, " ").trim();
      const length = compact.length;
      const symbolMatches = compact.match(/[=<>+\-*/^(){}[\]\\]|[∑∫√πλμΔθω]|\d/g) || [];
      const symbolDensity = compact.length > 0 ? symbolMatches.length / compact.length : 0;
      const hasHardKeyword = /(证明|推导|收敛|复杂度|极限|梯度|最优化|矩阵|eigen|proof|derivation|convergence|complexity)/i.test(compact);

      if (hasHardKeyword || length > 120 || symbolDensity > 0.16) {
        return "hard";
      }
      if (length > 48 || symbolDensity > 0.08) {
        return "medium";
      }
      return "easy";
    };

    const englishRatio = (text: string) => {
      const latinCount = (text.match(/[A-Za-z]/g) || []).length;
      const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const base = latinCount + cjkCount;
      if (base === 0) {
        return 0;
      }
      return latinCount / base;
    };

    const requestExplainOnce = (prompt: string) =>
      new Promise<{ ok: boolean; answer?: string; error?: string }>((resolve) => {
        if (explainWsRef.current) {
          explainWsRef.current.close();
          explainWsRef.current = null;
        }

        const ws = new WebSocket(wsUrl("/api/v1/solve"));
        explainWsRef.current = ws;
        let settled = false;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              question: prompt,
              kb_name: solverState.selectedKb || "",
              session_id: solverState.sessionId || undefined,
            }),
          );
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "result") {
            settled = true;
            resolve({ ok: true, answer: data.final_answer || "" });
            ws.close();
            return;
          }
          if (data.type === "error") {
            settled = true;
            resolve({
              ok: false,
              error:
                data.content ||
                data.message ||
                t("Explanation failed. Please try selecting and asking again."),
            });
            ws.close();
          }
        };

        ws.onerror = () => {
          settled = true;
          resolve({
            ok: false,
            error: t("Explanation failed. Please try selecting and asking again."),
          });
        };

        ws.onclose = () => {
          if (explainWsRef.current === ws) {
            explainWsRef.current = null;
          }
          if (!settled) {
            resolve({
              ok: false,
              error: t("Explanation failed. Please try selecting and asking again."),
            });
          }
        };
      });

    const level = detectExplainLevel(selectionAction.text);
    const lengthRange = EXPLAIN_LENGTH_RANGE[level];

    setExplainPanel({
      selectedText: selectionAction.text,
      sourceQuestion: selectionAction.userQuestion,
      level,
      lengthRange,
      answer: "",
      isLoading: true,
      error: "",
    });

    const explainPrompt = [
      "请基于我们当前这道题的上下文进行讲解。",
      `我不懂这段内容：\"${selectionAction.text}\"`,
      "输出语言要求：必须全部使用中文。英文仅可作为术语在括号内保留，不要整句英文。",
      `难度等级：${level}。目标字数：${lengthRange} 字。请严格控制篇幅，不要冗长。`,
      "请按以下结构作答：",
      "1) 这段话在原题中的作用",
      "2) 核心概念拆解（通俗）",
      "3) 一个简短例子",
      "4) 常见误区与避免方式",
    ].join("\n");

    hideSelectionAction();
    window.getSelection()?.removeAllRanges();

    void (async () => {
      const first = await requestExplainOnce(explainPrompt);
      if (!first.ok) {
        setExplainPanel((prev) => ({
          ...prev,
          isLoading: false,
          error: first.error || t("Explanation failed. Please try selecting and asking again."),
        }));
        return;
      }

      let finalAnswer = first.answer || "";
      if (englishRatio(finalAnswer) > 0.22) {
        const rewritePrompt = [
          "请把下面这段解释重写为中文版本。",
          "要求：",
          `- 总字数控制在 ${lengthRange} 字；`,
          "- 术语可在括号里保留英文，不要整句英文；",
          "- 只输出重写后的解释正文。",
          "原解释：",
          finalAnswer,
        ].join("\n");

        const rewrite = await requestExplainOnce(rewritePrompt);
        if (rewrite.ok && rewrite.answer?.trim()) {
          finalAnswer = rewrite.answer;
        }
      }

      setExplainPanel((prev) => ({
        ...prev,
        answer: finalAnswer,
        isLoading: false,
        error: "",
      }));
    })();
  };

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
        hideSelectionAction();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideSelectionAction();
        window.getSelection()?.removeAllRanges();
      }
    };

    const onScroll = () => hideSelectionAction();

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    messagesRef.current?.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      messagesRef.current?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!draggingDivider) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - dragStartXRef.current;
      setRightPaneWidth(clampRightPanelWidth(dragStartRightRef.current - deltaX));
    };

    const handleMouseUp = () => {
      setDraggingDivider(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingDivider]);

  const startDividerDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    dragStartXRef.current = event.clientX;
    dragStartRightRef.current = rightPaneWidth;
    setDraggingDivider(true);
  };

  useEffect(() => {
    return () => {
      if (explainWsRef.current) {
        explainWsRef.current.close();
        explainWsRef.current = null;
      }
    };
  }, []);

  const hasMessages = solverState.messages.length > 0;
  const progressText = useMemo(() => {
    if (!solverState.progress.stage) {
      return null;
    }
    const stage = solverState.progress.stage;
    if (stage === "investigate") {
      return t("solver.progress.investigating");
    }
    if (stage === "solve") {
      return t("solver.progress.solving");
    }
    if (stage === "response") {
      return t("solver.progress.responding");
    }
    return null;
  }, [solverState.progress.stage, t]);

  return (
    <div className="tp-page">
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: `minmax(0,1fr) 10px ${rightPaneWidth}px`,
        }}
      >
        <Panel className="min-h-0" bodyClassName="flex h-full flex-col p-0">
          <div className="flex items-center justify-end gap-2 border-b border-[hsl(var(--panel-border))] px-4 py-2.5">
            <button
              type="button"
              onClick={newSolverSession}
              className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
            >
              <RefreshCw className="h-4 w-4" />
              {t("New Session")}
            </button>
            {solverState.isSolving ? (
              <button
                type="button"
                onClick={stopSolver}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300"
              >
                <Square className="h-4 w-4" />
                {t("solver.stop")}
              </button>
            ) : null}
          </div>

          <div
            ref={messagesRef}
            className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
          >
            {hasMessages ? (
              solverState.messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" ? (
                    <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand))] flex items-center justify-center">
                      <Bot className="h-4 w-4" />
                    </div>
                  ) : null}

                  <div
                    className={`max-w-[84%] rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-[hsl(var(--brand))] text-white rounded-br-md"
                        : "bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded-bl-md"
                    }`}
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    ) : (
                      <div
                        className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-headings:my-2"
                        onMouseUp={(event) =>
                          handleAssistantMouseUp(event, index, message.content)
                        }
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          urlTransform={(url) =>
                            resolveArtifactUrl(url, message.outputDir)
                          }
                          components={{
                            img: ({ node, src, alt, ...props }) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                {...props}
                                src={
                                  resolveArtifactUrl(
                                    typeof src === "string" ? src : "",
                                    message.outputDir,
                                  ) || undefined
                                }
                                alt={alt || "solver-artifact"}
                                loading="lazy"
                                className="max-w-full rounded-lg"
                              />
                            ),
                            a: ({ node, href, ...props }) => (
                              <a
                                {...props}
                                href={
                                  resolveArtifactUrl(
                                    typeof href === "string" ? href : "",
                                    message.outputDir,
                                  ) || undefined
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-[hsl(var(--brand))] hover:underline"
                              />
                            ),
                          }}
                        >
                          {processLatexContent(message.content)}
                        </ReactMarkdown>
                      </div>
                    )}

                    {message.role === "assistant" ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => openNotebookForAssistantMessage(index, message.content)}
                          disabled={!message.content?.trim()}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-2.5 py-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--panel))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          {t("Save to Notebook")}
                        </button>

                        <div className="flex flex-wrap items-center gap-2">
                        {message.verificationPassed === true ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                            <CircleCheck className="h-3.5 w-3.5" />
                            {t("solver.verified")}
                          </span>
                        ) : null}
                        {typeof message.verificationConfidence === "number" ? (
                          <span className="rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-2 py-1 text-[hsl(var(--muted-foreground))]">
                            {t("solver.confidence")}: {Math.round(message.verificationConfidence * 100)}%
                          </span>
                        ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {message.role === "user" ? (
                    <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-[hsl(var(--brand))] text-white flex items-center justify-center">
                      <User className="h-4 w-4" />
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
                <Bot className="mb-4 h-14 w-14 text-[hsl(var(--brand-soft))]" />
                <p className="text-xl font-semibold text-[hsl(var(--foreground))]">
                  Hi!今天想要问点什么呢？
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-[hsl(var(--panel-border))] px-4 py-3">
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={submitSolve}
              loading={solverState.isSolving}
              submitDisabled={!input.trim()}
              multiline
              placeholder={t("solver.placeholder")}
              context={
                <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <span>{t("solver.subject")}: {t(currentSubject === "liberal_arts" ? "Liberal Arts" : currentSubject === "engineering" ? "Engineering" : "Science")}</span>
                  <span>•</span>
                  <span>{t("Knowledge Base")}: {solverState.selectedKb || t("solver.none")}</span>
                  {progressText ? (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--brand))]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {progressText}
                      </span>
                    </>
                  ) : null}
                </div>
              }
              helperText={t("solver.helper.enterShiftEnter")}
            />
          </div>
        </Panel>

        <div
          role="separator"
          aria-orientation="vertical"
          className="group flex h-full cursor-col-resize items-center justify-center"
          onMouseDown={startDividerDrag}
        >
          <div className="h-16 w-1 rounded-full bg-[hsl(var(--panel-border))] transition-colors group-hover:bg-[hsl(var(--brand))]" />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <Panel
            title={t("Subject Knowledge Base")}
            description={t("No subject knowledge base is linked yet.")}
            bodyClassName="p-4"
          >
            <select
              value={solverState.selectedKb}
              onChange={(event) =>
                setSolverState((prev) => ({
                  ...prev,
                  selectedKb: event.target.value,
                }))
              }
              className="w-full rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-[hsl(var(--brand))/0.2]"
            >
              <option value="">{t("Select Knowledge Base")}</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.name} value={kb.name}>
                  {kb.name}
                </option>
              ))}
            </select>
          </Panel>

          <Panel
            className="min-h-0 flex-1"
            title={t("Selected Explanation")}
            description={t("Select a part of the answer and click \"I don't understand\" to get a focused explanation.")}
            bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
          >
            {explainPanel.selectedText ? (
              <div className="rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.6] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    {t("Selected Text")}
                  </p>
                  <span className="inline-flex items-center rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
                    {t("Difficulty")}: {t(`Explain level ${explainPanel.level}`)} · {t("Target")}: {explainPanel.lengthRange}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[hsl(var(--foreground))]">{explainPanel.selectedText}</p>
              </div>
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("No selected text yet. Drag your mouse over an assistant answer first.")}
              </p>
            )}

            {explainPanel.sourceQuestion ? (
              <div className="rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] p-3">
                <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  {t("Related Question")}
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--foreground))]">{explainPanel.sourceQuestion}</p>
              </div>
            ) : null}

            {explainPanel.isLoading ? (
              <div className="inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("Explaining selected content...")}
              </div>
            ) : null}

            {explainPanel.error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
                <div className="inline-flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  {explainPanel.error}
                </div>
              </div>
            ) : null}

            {explainPanel.answer ? (
              <div className="rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] p-3">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {processLatexContent(explainPanel.answer)}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      {selectionAction.visible ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleExplainSelection}
          className="fixed z-50 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))] shadow-lg transition hover:bg-[hsl(var(--panel-muted))]"
          style={{
            left: `${selectionAction.x}px`,
            top: `${selectionAction.y}px`,
            transform: "translate(-50%, -100%)",
          }}
        >
          {t("I don't understand")}
        </button>
      ) : null}

      <AddToNotebookModal
        isOpen={isNotebookModalOpen}
        onClose={() => {
          setIsNotebookModalOpen(false);
          setPendingNotebookRecord(null);
        }}
        recordType="solve"
        title={pendingNotebookRecord?.title || t("Smart Solver Note")}
        userQuery={pendingNotebookRecord?.userQuery || ""}
        output={pendingNotebookRecord?.output || ""}
        metadata={pendingNotebookRecord?.metadata || {}}
        kbName={solverState.selectedKb || undefined}
      />
    </div>
  );
}
