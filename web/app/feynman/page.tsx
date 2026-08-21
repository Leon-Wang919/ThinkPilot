"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Mic,
  Square,
  GraduationCap,
  User,
  RotateCcw,
  FileText,
  ChevronDown,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Target,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiUrl } from "@/lib/api";
import { processLatexContent } from "@/lib/latex";
import { useGlobal } from "@/context/GlobalContext";
import { useTranslation } from "react-i18next";
import { useSpeechInput } from "@/hooks/useSpeechInput";

/* ── Types ─────────────────────────────────────────────────────── */

interface FeynmanMessage {
  role: "user" | "assistant";
  content: string;
}

interface PersonaInfo {
  name: string;
  emoji: string;
}

interface Evaluation {
  covered_concepts?: string[];
  logic_gaps?: string[];
  clarity_score?: number;
  completeness_score?: number;
}

interface NotebookSummary {
  id: string;
  name: string;
  description?: string;
  record_count?: number;
}

interface NotebookRecord {
  id: string;
  title?: string;
  user_query?: string;
  output?: string;
  created_at?: number;
}

interface ImportedNotebookContext {
  notebookName: string;
  recordTitle: string;
  referenceNotes: string;
}

interface Persona {
  key: string;
  name: string;
  emoji: string;
  description: string;
}

const PERSONAS: Persona[] = [
  {
    key: "curious_student",
    name: "Curious Student",
    emoji: "🧑‍🎓",
    description: "Asks genuine, probing questions",
  },
  {
    key: "skeptical_peer",
    name: "Skeptical Peer",
    emoji: "🤔",
    description: "Challenges assumptions and logic",
  },
  {
    key: "rigorous_reviewer",
    name: "Rigorous Reviewer",
    emoji: "🧾",
    description: "Audits definitions, evidence, and logical rigor",
  },
];

const PERSONA_I18N: Record<string, { name: string; description: string }> = {
  curious_student: { name: "好奇学生", description: "提出深入的探索性问题" },
  skeptical_peer: { name: "怀疑同伴", description: "质疑假设和逻辑" },
  rigorous_reviewer: { name: "严审同侪", description: "审查定义、证据与推理严密性" },
};

function getErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    payload.detail &&
    typeof payload.detail === "object" &&
    "message" in payload.detail &&
    typeof payload.detail.message === "string"
  ) {
    return payload.detail.message;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  return fallback;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function FeynmanPage() {
  const { t, i18n } = useTranslation();
  const { currentSubject } = useGlobal();
  const isZh = i18n.language?.startsWith("zh");

  const personaDisplay = (p: Persona) => ({
    name: isZh ? PERSONA_I18N[p.key]?.name ?? p.name : p.name,
    description: isZh ? PERSONA_I18N[p.key]?.description ?? p.description : p.description,
  });

  // Session state
  const [topic, setTopic] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("curious_student");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [messages, setMessages] = useState<FeynmanMessage[]>([]);
  const [logicGaps, setLogicGaps] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [roundCount, setRoundCount] = useState(0);
  const [isReport, setIsReport] = useState(false);
  const [personaInfo, setPersonaInfo] = useState<PersonaInfo | null>(null);

  // UI state
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPersonaSelect, setShowPersonaSelect] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [loadingImportNotebooks, setLoadingImportNotebooks] = useState(false);
  const [loadingImportRecords, setLoadingImportRecords] = useState(false);
  const [importError, setImportError] = useState("");
  const [notebookQuery, setNotebookQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [importNotebooks, setImportNotebooks] = useState<NotebookSummary[]>([]);
  const [selectedImportNotebookId, setSelectedImportNotebookId] = useState("");
  const [importRecords, setImportRecords] = useState<NotebookRecord[]>([]);
  const [importedContext, setImportedContext] = useState<ImportedNotebookContext | null>(null);
  const [autoSendAfterTranscribe, setAutoSendAfterTranscribe] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recordingBaseInputRef = useRef("");

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (value: string) => {
    setInputMessage(value);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  };

  const onFinalTranscript = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) {
        return;
      }

      setVoiceError("");
      const base = recordingBaseInputRef.current;
      const merged = base
        ? `${base}${/\s$/.test(base) ? "" : " "}${clean}`
        : clean;
      handleInputChange(merged);
      if (autoSendAfterTranscribe) {
        void sendExplanation(false, merged);
      }
    },
    [autoSendAfterTranscribe],
  );

  const onInterimTranscript = useCallback((text: string) => {
    const clean = text.trim();
    const base = recordingBaseInputRef.current;
    const merged = clean
      ? (base ? `${base}${/\s$/.test(base) ? "" : " "}${clean}` : clean)
      : base;
    handleInputChange(merged);
  }, []);

  const {
    status: speechStatus,
    error: speechError,
    supported: speechSupported,
    isListening,
    startListening,
    stopListening,
    clearError: clearSpeechError,
  } = useSpeechInput({
    lang: isZh ? "zh-CN" : "en-US",
    mode: "hybrid",
    onFinalTranscript,
    onInterimTranscript,
    onError: (message) => {
      setVoiceError(message);
    },
  });

  const handleMicToggle = useCallback(() => {
    if (isLoading) {
      return;
    }

    if (!speechSupported) {
      setVoiceError(t("Voice input unavailable on this browser"));
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    recordingBaseInputRef.current = inputMessage;
    setVoiceError("");
    clearSpeechError();
    startListening();
  }, [clearSpeechError, inputMessage, isListening, isLoading, speechSupported, startListening, stopListening, t]);

  const startSession = () => {
    if (!topic.trim()) return;
    setSessionStarted(true);
    setMessages([]);
    setLogicGaps([]);
    setEvaluation(null);
    setRoundCount(0);
    setIsReport(false);

    const persona = PERSONAS.find((p) => p.key === selectedPersona);
    const displayName = persona ? personaDisplay(persona).name : (isZh ? "好奇学生" : "Curious Student");
    setPersonaInfo(
      persona
        ? { name: displayName, emoji: persona.emoji }
        : { name: displayName, emoji: "🧑‍🎓" }
    );

    // Add system welcome message
    const welcomeContent = isZh
      ? `${persona?.emoji || "🧑‍🎓"} 你好！我是你的${displayName}。我准备好学习 **${topic}** 了。请像给一个完全不懂的人讲课一样，开始教我吧！`
      : `${persona?.emoji || "🧑‍🎓"} Hi! I'm your ${displayName}. I'm ready to learn about **${topic}**. Go ahead and teach me — explain it as if I know nothing about it!`;
    const welcomeMsg: FeynmanMessage = {
      role: "assistant",
      content: welcomeContent,
    };
    setMessages([welcomeMsg]);
  };

  const sendExplanation = async (endSession = false, overrideMessage?: string) => {
    const outgoingMessage = (overrideMessage ?? inputMessage).trim();
    if (!outgoingMessage && !endSession) return;
    if (isLoading) return;

    const userMsg: FeynmanMessage = endSession
      ? { role: "user", content: "[Session ended — generating report]" }
      : { role: "user", content: outgoingMessage };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputMessage("");
    setIsLoading(true);

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      const response = await fetch(apiUrl("/api/v1/feynman/turn"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: currentSubject,
          locale: i18n.language || (isZh ? "zh" : "en"),
          topic,
          user_explanation: endSession ? "" : outgoingMessage,
          reference_notes: importedContext?.referenceNotes || "",
          reference_source_label: importedContext
            ? `${importedContext.notebookName} · ${importedContext.recordTitle}`
            : "",
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          logic_gaps: logicGaps,
          persona: selectedPersona,
          iteration_count: roundCount,
          max_iterations: endSession ? 0 : 10,
          should_continue: !endSession,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response
          .json()
          .catch(async () => ({ detail: await response.text().catch(() => "") }));
        throw new Error(
          getErrorMessage(errorPayload, `Server error: ${response.status}`),
        );
      }

      const data = await response.json();

      const assistantMsg: FeynmanMessage = {
        role: "assistant",
        content: data.response || "I need a moment to think about that...",
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setLogicGaps(data.logic_gaps || []);
      setEvaluation(data.evaluation || null);
      setRoundCount((prev) => prev + 1);
      setIsReport(data.is_report || false);

      if (data.persona_info?.name && data.persona_info?.emoji) {
        setPersonaInfo(data.persona_info);
      }
    } catch (error) {
      const errorMsg: FeynmanMessage = {
        role: "assistant",
        content: `⚠️ Something went wrong: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetSession = () => {
    setSessionStarted(false);
    setMessages([]);
    setLogicGaps([]);
    setEvaluation(null);
    setRoundCount(0);
    setIsReport(false);
    setTopic("");
    setPersonaInfo(null);
    setImportedContext(null);
    setVoiceError("");
  };

  useEffect(() => {
    if (!speechError) {
      return;
    }

    if (speechError.includes("not-allowed") || speechError.includes("permission")) {
      setVoiceError(t("Microphone access denied. Please allow microphone permission."));
      return;
    }

    if (speechError.includes("no-speech")) {
      setVoiceError(t("No speech detected. Please try again."));
      return;
    }

    if (speechError.includes("stop_timeout")) {
      setVoiceError(t("Recording stop timed out. Microphone was force-closed. Please try again."));
      return;
    }

    setVoiceError(t("Speech input failed. Please try again."));
  }, [speechError, t]);

  const loadImportNotebooks = async () => {
    setLoadingImportNotebooks(true);
    setImportError("");
    try {
      const res = await fetch(apiUrl("/api/v1/notebook/list"));
      const data = await res.json();
      const list = (data.notebooks || []) as NotebookSummary[];
      const usable = list.filter((item) => (item.record_count || 0) > 0);
      setImportNotebooks(usable);
    } catch (error) {
      console.error("Failed to load notebooks for feynman import:", error);
      setImportError(t("Failed to load notebooks. Please try again."));
      setImportNotebooks([]);
    } finally {
      setLoadingImportNotebooks(false);
    }
  };

  const openImportModal = async () => {
    setShowImportModal(true);
    setNotebookQuery("");
    setRecordQuery("");
    setSelectedImportNotebookId("");
    setImportRecords([]);
    await loadImportNotebooks();
  };

  const loadNotebookRecords = async (notebookId: string) => {
    if (!notebookId) {
      setSelectedImportNotebookId("");
      setImportRecords([]);
      return;
    }

    setSelectedImportNotebookId(notebookId);
    setLoadingImportRecords(true);
    setImportError("");
    try {
      const res = await fetch(apiUrl(`/api/v1/notebook/${notebookId}`));
      const data = await res.json();
      setImportRecords((data.records || []) as NotebookRecord[]);
    } catch (error) {
      console.error("Failed to load notebook records for feynman import:", error);
      setImportError(t("Failed to load notebook records. Please try again."));
      setImportRecords([]);
    } finally {
      setLoadingImportRecords(false);
    }
  };

  const applyImportedRecord = (record: NotebookRecord) => {
    const notebookName =
      importNotebooks.find((item) => item.id === selectedImportNotebookId)?.name ||
      t("Notebook");
    const recordTitle = (record.title || t("Untitled record")).trim();

    const pieces = [
      record.title ? `### ${record.title}` : "",
      record.user_query ? `${t("Question")}:\n${record.user_query}` : "",
      record.output ? `${t("Notes")}:\n${record.output}` : "",
    ].filter(Boolean);

    const merged = pieces.join("\n\n").trim();
    if (!merged) {
      return;
    }

    setImportedContext({
      notebookName,
      recordTitle,
      referenceNotes: merged,
    });

    if (!topic.trim() && record.title?.trim()) {
      setTopic(record.title.trim().slice(0, 120));
    }

    setShowImportModal(false);
  };

  const filteredImportNotebooks = importNotebooks.filter((item) => {
    const q = notebookQuery.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description || "").toLowerCase().includes(q)
    );
  });

  const filteredImportRecords = importRecords.filter((record) => {
    const q = recordQuery.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (
      (record.title || "").toLowerCase().includes(q) ||
      (record.user_query || "").toLowerCase().includes(q) ||
      (record.output || "").toLowerCase().includes(q)
    );
  });

  const renderImportModal = () => {
    if (!showImportModal) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-4xl rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] shadow-xl">
          <div className="flex items-center justify-between border-b border-[hsl(var(--panel-border))] px-5 py-4">
            <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              {t("Import Notebook")}
            </h3>
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="rounded-lg px-2 py-1 text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--panel-muted))]"
            >
              {t("Close")}
            </button>
          </div>

          <div className="grid h-[520px] grid-cols-1 gap-0 md:grid-cols-2">
            <div className="flex min-h-0 flex-col border-r border-[hsl(var(--panel-border))] p-4">
              <label className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                {t("Choose Notebook")}
              </label>
              <input
                value={notebookQuery}
                onChange={(e) => setNotebookQuery(e.target.value)}
                placeholder={t("Search notebooks...")}
                className="mb-3 w-full rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm"
              />

              <div className="min-h-0 flex-1 overflow-y-auto space-y-2">
                {loadingImportNotebooks ? (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading")}</div>
                ) : filteredImportNotebooks.length === 0 ? (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t("No notebooks with records found")}
                  </div>
                ) : (
                  filteredImportNotebooks.map((notebook) => (
                    <button
                      key={notebook.id}
                      type="button"
                      onClick={() => loadNotebookRecords(notebook.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        selectedImportNotebookId === notebook.id
                          ? "border-[hsl(var(--brand))] bg-[hsl(var(--brand-soft))]"
                          : "border-[hsl(var(--panel-border))] hover:bg-[hsl(var(--panel-muted))]"
                      }`}
                    >
                      <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {notebook.name}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        {(notebook.record_count || 0).toString()} {t("records")}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col p-4">
              <label className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                {t("Choose Record")}
              </label>
              <input
                value={recordQuery}
                onChange={(e) => setRecordQuery(e.target.value)}
                placeholder={t("Search records...")}
                className="mb-3 w-full rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm"
                disabled={!selectedImportNotebookId}
              />

              <div className="min-h-0 flex-1 overflow-y-auto space-y-2">
                {!selectedImportNotebookId ? (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t("Select a notebook first")}
                  </div>
                ) : loadingImportRecords ? (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading")}</div>
                ) : filteredImportRecords.length === 0 ? (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">{t("No records found")}</div>
                ) : (
                  filteredImportRecords.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => applyImportedRecord(record)}
                      className="w-full rounded-xl border border-[hsl(var(--panel-border))] px-3 py-2 text-left hover:bg-[hsl(var(--panel-muted))] transition-colors"
                    >
                      <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                        {record.title || t("Untitled record")}
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">
                        {(record.user_query || record.output || "").slice(0, 140)}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {importError ? (
            <div className="border-t border-[hsl(var(--panel-border))] px-5 py-3 text-sm text-red-500">
              {importError}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendExplanation();
    }
  };

  /* ── Render: Setup Screen ──────────────────────────────────────── */

  if (!sessionStarted) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="w-full max-w-lg mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--brand-soft))] flex items-center justify-center mx-auto mb-4">
              <GraduationCap className="w-8 h-8 text-[hsl(var(--brand))]" />
            </div>
            <h1 className="text-3xl font-bold text-[hsl(var(--foreground))] mb-2">
              {t("Feynman Assessment")}
            </h1>
            <p className="text-[hsl(var(--muted-foreground))]">
              {t("Explain a topic to an AI student. The best way to learn is to teach.")}
            </p>
          </div>

          {/* Topic Input */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                {t("What topic will you teach?")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && startSession()}
                  className="w-full px-4 py-3 bg-[hsl(var(--panel))] border border-[hsl(var(--panel-border))] rounded-xl focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand))]/20 focus:border-[hsl(var(--brand))] transition-all placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]"
                  placeholder={t("e.g., Real Analysis epsilon-delta proofs, Multivariable gradients, Bayesian inference...")}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={openImportModal}
                  className="shrink-0 px-3 py-3 rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--panel-muted))] transition-colors"
                >
                  {t("Import Notebook")}
                </button>
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {t("You can type directly, or import notebook records as evaluation reference material.")}
              </p>
              {importedContext ? (
                <div className="mt-2 rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="font-medium text-[hsl(var(--foreground))]">{t("Reference Loaded")}: </span>
                  {importedContext.notebookName} · {importedContext.recordTitle}
                </div>
              ) : null}
            </div>

            {/* Persona Selection */}
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                {t("Choose your student")}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PERSONAS.map((persona) => {
                  const display = personaDisplay(persona);
                  return (
                    <button
                      key={persona.key}
                      onClick={() => setSelectedPersona(persona.key)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedPersona === persona.key
                          ? "border-[hsl(var(--brand))] bg-[hsl(var(--brand-soft))] shadow-sm"
                          : "border-[hsl(var(--panel-border))] hover:border-[hsl(var(--muted-foreground))]/30"
                      }`}
                    >
                      <div className="text-2xl mb-1">{persona.emoji}</div>
                      <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {display.name}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                        {display.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={startSession}
              disabled={!topic.trim()}
              className="w-full py-3 px-4 bg-[hsl(var(--brand))] hover:bg-[hsl(var(--brand-strong))] disabled:opacity-50 disabled:hover:bg-[hsl(var(--brand))] text-white font-medium rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {t("Start Teaching")}
            </button>
          </div>
        </div>
        {renderImportModal()}
      </div>
    );
  }

  /* ── Render: Teaching Session ───────────────────────────────────── */

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--brand-soft))] flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-[hsl(var(--brand))]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">
              {t("Teaching")}: {topic}
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {personaInfo?.emoji} {personaInfo?.name} · {t("Round")} {roundCount} · {t("Current Subject")}:{" "}
              {t(
                currentSubject === "liberal_arts"
                  ? "Liberal Arts"
                  : currentSubject === "science"
                    ? "Science"
                    : "Engineering",
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Logic gaps indicator */}
          {logicGaps.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs font-medium">
              <AlertTriangle className="w-3 h-3" />
              {logicGaps.length} {t("gaps found")}
            </div>
          )}

          {!isReport && (
            <button
              onClick={() => sendExplanation(true)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--panel-muted))] rounded-lg transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {t("End & Get Report")}
            </button>
          )}

          <button
            onClick={resetSession}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t("New Topic")}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className="flex gap-3 w-full max-w-3xl mx-auto animate-fade-in"
          >
            {msg.role === "user" ? (
              <>
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand))] flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 bg-[hsl(var(--panel-muted))] px-4 py-3 rounded-2xl rounded-tl-none text-[hsl(var(--foreground))]">
                  <div className="prose prose-slate dark:prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {processLatexContent(msg.content)}
                    </ReactMarkdown>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand-soft))] flex items-center justify-center shrink-0 text-lg">
                  {personaInfo?.emoji || "🧑‍🎓"}
                </div>
                <div className="flex-1 bg-[hsl(var(--panel))] px-4 py-3 rounded-2xl rounded-tl-none border border-[hsl(var(--panel-border))] shadow-sm">
                  <div className="prose prose-slate dark:prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {processLatexContent(msg.content)}
                    </ReactMarkdown>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="flex gap-3 w-full max-w-3xl mx-auto">
            <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand-soft))] flex items-center justify-center shrink-0 text-lg">
              {personaInfo?.emoji || "🧑‍🎓"}
            </div>
            <div className="bg-[hsl(var(--panel))] px-4 py-3 rounded-2xl rounded-tl-none border border-[hsl(var(--panel-border))]">
              <div className="flex items-center gap-2 text-[hsl(var(--brand))] text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("Thinking...")}</span>
              </div>
            </div>
          </div>
        )}

        {/* Evaluation sidebar (inline) */}
        {evaluation && !isReport && (
          <div className="w-full max-w-3xl mx-auto">
            <div className="bg-[hsl(var(--panel-muted))] rounded-xl border border-[hsl(var(--panel-border))] p-4">
              <h4 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
                {t("Session Progress")}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-[hsl(var(--brand))]" />
                  <span className="text-sm text-[hsl(var(--foreground))]">
                    {t("Clarity")}: {evaluation.clarity_score || "—"}/10
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm text-[hsl(var(--foreground))]">
                    {t("Completeness")}: {evaluation.completeness_score || "—"}/10
                  </span>
                </div>
              </div>
              {logicGaps.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[hsl(var(--panel-border))]">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1.5">
                    {t("Knowledge Gaps")}:
                  </p>
                  <ul className="space-y-1">
                    {logicGaps.slice(-3).map((gap, i) => (
                      <li
                        key={i}
                        className="text-xs text-[hsl(var(--muted-foreground))] flex items-start gap-1.5"
                      >
                        <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {!isReport && (
        <div className="border-t border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-6 py-4">
          <div className="w-full max-w-3xl mx-auto">
            <div className="relative gemini-input-glow rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] transition-all">
              <textarea
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                className="w-full px-4 py-3 pr-24 bg-transparent rounded-2xl focus:outline-none resize-none text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                placeholder={t("Explain the topic in your own words...")}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleMicToggle}
                disabled={isLoading}
                aria-label={isListening ? t("Stop Recording") : t("Start Recording")}
                title={isListening ? t("Stop Recording") : t("Start Recording")}
                className={`absolute right-12 bottom-2 w-8 h-8 rounded-full border transition-colors flex items-center justify-center ${
                  isListening
                    ? "border-rose-500 bg-rose-50 text-rose-600"
                    : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                } disabled:opacity-50`}
              >
                {isListening ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => sendExplanation()}
                disabled={isLoading || !inputMessage.trim()}
                aria-label={t("Send explanation")}
                title={t("Send explanation")}
                className="absolute right-2 bottom-2 p-2 bg-[hsl(var(--brand))] text-white rounded-xl hover:bg-[hsl(var(--brand-strong))] disabled:opacity-50 disabled:hover:bg-[hsl(var(--brand))] transition-colors shadow-sm"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <div>
                {!speechSupported
                  ? t("Voice input unavailable on this browser")
                  : isListening
                    ? t("Recording... Click again to stop")
                    : speechStatus === "processing"
                      ? t("Transcribing...")
                      : t("Click to start recording")}
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoSendAfterTranscribe}
                  onChange={(e) => setAutoSendAfterTranscribe(e.target.checked)}
                  className="rounded border-[hsl(var(--panel-border))]"
                />
                <span>{t("Auto-send after transcription")}</span>
              </label>
            </div>
            {voiceError ? (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {voiceError}
                <button
                  type="button"
                  onClick={() => {
                    setVoiceError("");
                    clearSpeechError();
                  }}
                  className="ml-2 text-[hsl(var(--brand))] hover:underline"
                >
                  {t("Clear")}
                </button>
              </div>
            ) : null}
            {importedContext ? (
              <div className="mt-2 rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                <span className="font-medium text-[hsl(var(--foreground))]">{t("Reference Loaded")}: </span>
                {importedContext.notebookName} · {importedContext.recordTitle}
                <button
                  type="button"
                  onClick={() => setImportedContext(null)}
                  className="ml-2 text-[hsl(var(--brand))] hover:underline"
                >
                  {t("Clear")}
                </button>
              </div>
            ) : null}
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2 text-center">
              {t("Teach the topic as if explaining to someone who knows nothing about it")}
            </p>
          </div>
        </div>
      )}

      {/* Report complete state */}
      {isReport && (
        <div className="border-t border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-6 py-4">
          <div className="w-full max-w-3xl mx-auto flex items-center justify-center gap-3">
            <button
              onClick={resetSession}
              className="flex items-center gap-2 px-6 py-2.5 bg-[hsl(var(--brand))] hover:bg-[hsl(var(--brand-strong))] text-white font-medium rounded-xl transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              {t("Teach Another Topic")}
            </button>
          </div>
        </div>
      )}

      {renderImportModal()}
    </div>
  );
}
