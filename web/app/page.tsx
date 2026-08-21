"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  BookOpen,
  Database,
  Globe,
  GraduationCap,
  Loader2,
  Microscope,
  MoreHorizontal,
  PenTool,
  Save,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { useGlobal } from "@/context/GlobalContext";
import { apiUrl } from "@/lib/api";
import { processLatexContent } from "@/lib/latex";
import { Composer, PageHeader, Panel } from "@/components/ui";
import type { Subject } from "@/types/subject";

interface KnowledgeBase {
  name: string;
  is_default?: boolean;
  subject: Subject;
}

const EXAMPLE_PROMPTS = [
  {
    key: "Build a study plan for my probability course",
    icon: GraduationCap,
  },
  {
    key: "Summarize the latest literature on diffusion models",
    icon: Microscope,
  },
  {
    key: "Generate a quiz from my uploaded materials",
    icon: PenTool,
  },
];

export default function HomePage() {
  const {
    chatState,
    setChatState,
    sendChatMessage,
    newChatSession,
    currentSubject,
  } = useGlobal();
  const { t } = useTranslation();

  const [inputMessage, setInputMessage] = useState("");
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [isSavingNotebook, setIsSavingNotebook] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams({ subject: currentSubject });
    fetch(apiUrl(`/api/v1/knowledge/list?${params.toString()}`))
      .then((res) => res.json())
      .then((data) => {
        const kbList = Array.isArray(data) ? data : [];
        setKbs(kbList);
        setChatState((prev) => {
          const defaultKb = kbList.find((kb: KnowledgeBase) => kb.is_default);
          const nextSelectedKb = kbList.some((kb) => kb.name === prev.selectedKb)
            ? prev.selectedKb
            : (defaultKb?.name ?? kbList[0]?.name ?? "");

          return {
            ...prev,
            selectedKb: nextSelectedKb,
          };
        });
      })
      .catch((err) => console.error("Failed to fetch KBs:", err));
  }, [currentSubject, setChatState]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [chatState.messages]);

  useEffect(() => {
    const handleClickAway = () => setShowSessionMenu(false);
    if (showSessionMenu) {
      window.addEventListener("click", handleClickAway);
    }
    return () => window.removeEventListener("click", handleClickAway);
  }, [showSessionMenu]);

  const handleSend = () => {
    if (!inputMessage.trim() || chatState.isLoading) return;
    sendChatMessage(inputMessage);
    setInputMessage("");
  };

  const handlePromptClick = (text: string) => {
    setInputMessage(text);
  };

  const hasKnowledgeBases = kbs.length > 0;

  const formatChatForNotebook = () => {
    if (chatState.messages.length === 0) {
      return { title: "", userQuery: "", output: "" };
    }

    const firstUserMsg = chatState.messages.find((m) => m.role === "user");
    const title =
      firstUserMsg?.content.slice(0, 50) +
        (firstUserMsg && firstUserMsg.content.length > 50 ? "..." : "") ||
      t("Chat Session");

    const formattedMessages = chatState.messages
      .map((msg) => {
        const roleLabel =
          msg.role === "user" ? `**${t("User")}**` : `**${t("Assistant")}**`;
        return `### ${roleLabel}\n\n${msg.content}`;
      })
      .join("\n\n---\n\n");

    const userQueries = chatState.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");

    return {
      title: `Chat: ${title}`,
      userQuery: userQueries,
      output: formattedMessages,
    };
  };

  const hasMessages = chatState.messages.length > 0;

  useEffect(() => {
    if (!saveFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setSaveFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [saveFeedback]);

  const saveCurrentChatToKnowledgeNotebook = async () => {
    if (!chatState.enableRag || !chatState.selectedKb || chatState.messages.length === 0) {
      return;
    }

    setIsSavingNotebook(true);
    try {
      const formatted = formatChatForNotebook();
      const res = await fetch(
        apiUrl(`/api/v1/knowledge/${chatState.selectedKb}/notebook/records`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            record_type: "chat",
            title: formatted.title,
            user_query: formatted.userQuery,
            output: formatted.output,
            module: "chat",
            session_id: chatState.sessionId || "chat-session",
            message_count: chatState.messages.length,
            metadata: {
              enable_rag: chatState.enableRag,
              enable_web_search: chatState.enableWebSearch,
            },
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        console.error("Chat notebook save failed:", data);
        throw new Error(t("Failed to save chat"));
      }
      setSaveFeedback({
        type: data.created ? "success" : "info",
        message: data.created
          ? t("Saved to the current knowledge notebook")
          : t("This session state is already saved"),
      });
    } catch (error) {
      console.error("Failed to save chat notebook record:", error);
      setSaveFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : t("Failed to save chat"),
      });
    } finally {
      setIsSavingNotebook(false);
    }
  };

  return (
    <div className="tp-page">
      {!hasMessages ? (
        <>
          <PageHeader
            title={t("Start from a question and get to work")}
          />

          <div className="grid min-h-0 grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] gap-5">
            <Panel
              className="overflow-hidden bg-transparent shadow-none border-none"
              bodyClassName="flex flex-col gap-6 p-2"
            >
              <div className="flex items-center gap-5">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] shadow-[0_4px_12px_rgba(0,0,0,0.04)]">
                  <Image
                    src="/logo.png"
                    alt={t("ThinkPilot Logo")}
                    width={56}
                    height={56}
                    className="object-contain"
                  />
                </div>
                <div className="flex h-16 items-center">
                  <h2 className="text-[1.35rem] font-medium tracking-tight text-[hsl(var(--foreground))]">
                    {t("ThinkPilot")}
                  </h2>
                </div>
              </div>

              <div>
                <p className="mb-3 text-[10px] font-medium tracking-widest uppercase text-[hsl(var(--muted-foreground))]">
                  {t("Suggested Starts")}
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt.key}
                      type="button"
                      onClick={() => handlePromptClick(t(prompt.key))}
                      className="group flex items-start gap-4 rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] hover:bg-[hsl(var(--panel-muted))] px-5 py-4 text-left transition-all hover:shadow-[0_8px_30px_rgba(37,99,235,0.08)]"
                    >
                      <div className="mt-0.5 rounded-xl bg-[hsl(var(--brand-soft))] p-2 text-[hsl(var(--brand-strong))] group-hover:bg-[hsl(var(--brand))] group-hover:text-white transition-colors">
                        <prompt.icon className="h-[18px] w-[18px] stroke-[1.5]" />
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-[hsl(var(--foreground))]">
                          {t(prompt.key)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel
              title={t("Start a session")}
              bodyClassName="flex flex-col gap-3.5 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] p-1">
                  <button
                    type="button"
                    disabled={!hasKnowledgeBases}
                    onClick={() =>
                      setChatState((prev) => ({
                        ...prev,
                        enableRag: hasKnowledgeBases ? !prev.enableRag : false,
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      !hasKnowledgeBases
                        ? "cursor-not-allowed text-[hsl(var(--muted-foreground))]/50"
                        : chatState.enableRag
                          ? "bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-pressed))]"
                          : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Database className="h-3.5 w-3.5" />
                      {t("Knowledge Base")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChatState((prev) => ({
                        ...prev,
                        enableWebSearch: !prev.enableWebSearch,
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      chatState.enableWebSearch
                        ? "bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-pressed))]"
                        : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" />
                      {t("Web")}
                    </span>
                  </button>
                </div>

                {chatState.enableRag && hasKnowledgeBases ? (
                  <select
                    value={chatState.selectedKb}
                    onChange={(event) =>
                      setChatState((prev) => ({
                        ...prev,
                        selectedKb: event.target.value,
                      }))
                    }
                    className="rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] px-4 py-2 text-xs text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-[hsl(var(--brand-soft))]"
                  >
                    {kbs.map((kb) => (
                      <option key={kb.name} value={kb.name}>
                        {kb.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.72] px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2 text-[hsl(var(--muted-foreground))]">
                  <span className="font-medium text-[hsl(var(--foreground))]">
                    {t("Context")}
                  </span>
                  <span className="tp-badge max-w-[220px]">
                    <BookOpen className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {chatState.enableRag
                        ? chatState.selectedKb || t("Select Knowledge Base")
                        : hasKnowledgeBases
                          ? t("Knowledge off")
                          : t("No knowledge base selected")}
                    </span>
                  </span>
                  <span className="tp-badge">
                    <Globe className="h-3.5 w-3.5" />
                    {chatState.enableWebSearch ? t("Web on") : t("Web off")}
                  </span>
                </div>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("Ready")}
                </span>
              </div>

              <Composer
                className="mt-0.5"
                multiline
                value={inputMessage}
                onChange={setInputMessage}
                onSubmit={handleSend}
                placeholder={t("Ask a question or define a study task...")}
                disabled={chatState.isLoading}
                loading={chatState.isLoading}
                maxHeight={240}
              />
            </Panel>
          </div>
        </>
      ) : (
        <>
          <PageHeader
            title={t("Current Session")}
            actions={
              <div className="relative flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] p-1">
                  <button
                    type="button"
                    onClick={() =>
                      setChatState((prev) => ({
                        ...prev,
                        enableRag: !prev.enableRag,
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      chatState.enableRag
                        ? "bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-pressed))]"
                        : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {t("Knowledge Base")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChatState((prev) => ({
                        ...prev,
                        enableWebSearch: !prev.enableWebSearch,
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      chatState.enableWebSearch
                        ? "bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-pressed))]"
                        : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {t("Web")}
                  </button>
                </div>

                {chatState.enableRag && (
                  <select
                    value={chatState.selectedKb}
                    onChange={(event) =>
                      setChatState((prev) => ({
                        ...prev,
                        selectedKb: event.target.value,
                      }))
                    }
                    className="rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] px-4 py-2 text-xs text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-[hsl(var(--brand-soft))]"
                  >
                    {kbs.map((kb) => (
                      <option key={kb.name} value={kb.name}>
                        {kb.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowSessionMenu((prev) => !prev);
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {showSessionMenu && (
                  <div
                    className="absolute right-0 top-14 z-20 min-w-[180px] rounded-[20px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] p-2 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        saveCurrentChatToKnowledgeNotebook();
                        setShowSessionMenu(false);
                      }}
                      disabled={!chatState.enableRag || !chatState.selectedKb || isSavingNotebook}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
                    >
                      {isSavingNotebook ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--brand-strong))]" />
                      ) : (
                        <Save className="h-4 w-4 text-[hsl(var(--brand-strong))]" />
                      )}
                      {t("Save to Knowledge Notebook")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        newChatSession();
                        setShowSessionMenu(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
                    >
                      <Sparkles className="h-4 w-4 text-[hsl(var(--brand-strong))]" />
                      {t("New Session")}
                    </button>
                  </div>
                )}
              </div>
            }
          />

          <Panel className="flex-1" bodyClassName="flex h-full min-h-0 flex-col">
            <div
              ref={messagesContainerRef}
              className="flex-1 space-y-6 overflow-y-auto px-6 py-6"
            >
              {chatState.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div className="shrink-0">
                    {msg.role === "user" ? (
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[hsl(var(--panel-muted))] text-[hsl(var(--muted-foreground))]">
                        <User className="h-4 w-4" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-white/40 bg-[hsl(var(--brand-soft))] shadow-[0_18px_36px_-24px_rgba(37,99,235,0.72)]">
                        <Image
                          src="/logo.png"
                          alt={t("ThinkPilot Logo")}
                          width={34}
                          height={34}
                          className="object-contain p-1"
                        />
                      </div>
                    )}
                  </div>

                  <div
                    className={`min-w-0 max-w-[78%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}
                  >
                    <div
                      className={`w-full rounded-[26px] px-5 py-4 ${
                        msg.role === "user"
                          ? "bg-[linear-gradient(135deg,hsl(var(--brand-strong))_0%,hsl(var(--brand-pressed))_100%)] text-white shadow-[0_22px_52px_-30px_rgba(37,99,235,0.8)]"
                          : "border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.76] text-[hsl(var(--foreground))]"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="text-sm leading-7">{msg.content}</p>
                      ) : (
                        <div className="prose prose-slate max-w-none dark:prose-invert">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {processLatexContent(msg.content)}
                          </ReactMarkdown>
                        </div>
                      )}

                      {msg.isStreaming && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--brand-strong))]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{t("Generating...")}</span>
                        </div>
                      )}
                    </div>

                    {msg.role === "assistant" &&
                      msg.sources &&
                      ((msg.sources.rag?.length ?? 0) +
                        (msg.sources.web?.length ?? 0) >
                        0) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.sources.rag?.map((source, index) => (
                            <div key={`rag-${index}`} className="tp-badge">
                              <BookOpen className="h-3.5 w-3.5 text-[hsl(var(--brand-strong))]" />
                              <span className="max-w-[140px] truncate">
                                {source.kb_name}
                              </span>
                            </div>
                          ))}
                          {msg.sources.web?.slice(0, 3).map((source, index) => (
                            <a
                              key={`web-${index}`}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tp-badge max-w-[260px] hover:border-[hsl(var(--brand-soft))]"
                            >
                              <Globe className="h-3.5 w-3.5 text-[hsl(var(--brand-strong))]" />
                              <span className="truncate">
                                {source.title || source.url}
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              ))}

              {chatState.isLoading && chatState.currentStage && (
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[hsl(var(--brand-soft))]">
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--brand-strong))]" />
                  </div>
                  <div className="max-w-[60%] rounded-[24px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.76] px-5 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                    {chatState.currentStage === "rag" &&
                      t("Searching the selected knowledge base...")}
                    {chatState.currentStage === "web" &&
                      t("Searching the web for current information...")}
                    {chatState.currentStage === "generating" &&
                      t("Composing the final answer...")}
                    {!["rag", "web", "generating"].includes(
                      chatState.currentStage,
                    ) && chatState.currentStage}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Composer
            multiline
            value={inputMessage}
            onChange={setInputMessage}
            onSubmit={handleSend}
            placeholder={t("Continue the session with a focused follow-up...")}
            disabled={chatState.isLoading}
            loading={chatState.isLoading}
            context={
              <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                {chatState.enableRag ? (
                  <span className="tp-badge">
                    <Database className="h-3.5 w-3.5" />
                    {chatState.selectedKb || t("Knowledge enabled")}
                  </span>
                ) : null}
                {chatState.enableWebSearch ? (
                  <span className="tp-badge">
                    <Globe className="h-3.5 w-3.5" />
                    {t("Web on")}
                  </span>
                ) : null}
              </div>
            }
          />
        </>
      )}

      {saveFeedback ? (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${
              saveFeedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                : saveFeedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-300"
                  : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            {saveFeedback.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
