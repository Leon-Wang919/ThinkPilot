"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  MessageCircle,
  User,
  Bot,
  Clock,
  Loader2,
  MessageSquare,
  ExternalLink,
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  sources?: {
    rag?: Array<{ kb_name: string; content: string }>;
    web?: Array<{ url: string; title?: string }>;
  };
}

interface ChatSession {
  session_id: string;
  title: string;
  messages: ChatMessage[];
  settings?: {
    kb_name?: string;
    enable_rag?: boolean;
    enable_web_search?: boolean;
  };
  created_at: number;
  updated_at: number;
}

interface ChatSessionDetailProps {
  sessionId: string;
  onClose: () => void;
  onContinue: () => void;
}

export default function ChatSessionDetail({
  sessionId,
  onClose,
  onContinue,
}: ChatSessionDetailProps) {
  const { uiSettings } = useGlobal();
  const { t } = useTranslation();

  const [session, setSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Ensure we're on the client before rendering portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    const fetchSession = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          apiUrl(`/api/v1/chat/sessions/${sessionId}`),
        );
        if (!response.ok) {
          throw new Error("Failed to load session");
        }
        const data = await response.json();
        setSession(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(
          msg === "Failed to load session" ? t("Failed to load session") : msg,
        );
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, t]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Don't render until mounted (client-side only)
  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-[hsl(var(--panel))] rounded-[24px] shadow-lg border border-[hsl(var(--panel-border))] w-full max-w-3xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[hsl(var(--panel-border))] flex justify-between items-center shrink-0 bg-[hsl(var(--panel))]/50 rounded-t-[24px] backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-[hsl(var(--panel-muted))] border border-[hsl(var(--panel-border))] flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-[hsl(var(--foreground))]" />
            </div>
            <div>
              <h2 className="font-semibold tracking-wide text-[hsl(var(--foreground))] text-lg">
                {session?.title || t("Chat History")}
              </h2>
              {session && (
                <p className="text-[11px] font-medium tracking-wide text-[hsl(var(--muted-foreground))] flex items-center gap-2 mt-1">
                  <Clock className="w-3 h-3" />
                  {new Date(session.created_at * 1000).toLocaleString(
                    uiSettings.language === "zh" ? "zh-CN" : "en-US",
                  )}
                  <span className="mx-1.5 opacity-50">•</span>
                  {session.messages.length} {t("messages")}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[hsl(var(--panel))] hover:bg-[hsl(var(--panel-muted))] flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors border border-[hsl(var(--panel-border))] shadow-sm"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-[hsl(var(--panel))]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--foreground))]" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500 dark:text-red-400">{error}</p>
            </div>
          ) : session ? (
            <div className="space-y-6">
              {/* Settings Info */}
              {session.settings &&
                (session.settings.kb_name ||
                  session.settings.enable_rag ||
                  session.settings.enable_web_search) && (
                  <div className="flex flex-wrap gap-2 mb-6 pb-6 border-b border-[hsl(var(--panel-border))]">
                    {session.settings.kb_name && (
                      <span className="px-3 py-1 text-[11px] font-medium border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] text-[hsl(var(--muted-foreground))] rounded-full">
                        {t("KB")}: {session.settings.kb_name}
                      </span>
                    )}
                    {session.settings.enable_rag && (
                      <span className="px-3 py-1 text-[11px] font-medium border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] text-[hsl(var(--muted-foreground))] rounded-full">
                        {t("RAG")}
                      </span>
                    )}
                    {session.settings.enable_web_search && (
                      <span className="px-3 py-1 text-[11px] font-medium border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] text-[hsl(var(--muted-foreground))] rounded-full">
                        {t("Web")}
                      </span>
                    )}
                  </div>
                )}

              {/* Messages */}
              {session.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 px-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] flex items-center justify-center shrink-0 shadow-sm">
                      <Bot className="w-4 h-4 text-[hsl(var(--foreground))]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                      msg.role === "user"
                        ? "bg-[hsl(var(--brand))] text-white dark:bg-[hsl(var(--brand))] dark:text-white rounded-tr-sm"
                        : "bg-[hsl(var(--panel-muted))] border border-[hsl(var(--panel-border))] text-[hsl(var(--foreground))] rounded-tl-sm shadow-sm"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</p>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {processLatexContent(msg.content)}
                        </ReactMarkdown>
                      </div>
                    )}

                    {/* Sources */}
                    {msg.sources &&
                      (msg.sources.rag?.length || msg.sources.web?.length) && (
                        <div className="mt-4 pt-3 border-t border-[hsl(var(--panel-border))]">
                          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wide">
                            {t("Sources")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {msg.sources.rag?.map((src, i) => (
                              <span
                                key={`rag-${i}`}
                                className="px-2.5 py-1 text-[11px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--muted-foreground))] rounded-md"
                              >
                                📚 {src.kb_name}
                              </span>
                            ))}
                            {msg.sources.web?.map((src, i) => (
                              <a
                                key={`web-${i}`}
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 text-[11px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--muted-foreground))] rounded-md hover:bg-[hsl(var(--panel-muted))] transition-colors flex items-center gap-1.5"
                              >
                                🌐 {src.title || new URL(src.url).hostname}
                                <ExternalLink className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Timestamp */}
                    {msg.timestamp && (
                      <p
                        className={`text-[10px] mt-2 font-medium tracking-wide text-[hsl(var(--muted-foreground))] ${
                          msg.role === "user" ? "opacity-70" : ""
                        }`}
                      >
                        {new Date(msg.timestamp * 1000).toLocaleTimeString(
                          uiSettings.language === "zh" ? "zh-CN" : "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </p>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand))] border border-[hsl(var(--brand-strong))] flex items-center justify-center shrink-0 shadow-sm">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] rounded-b-2xl flex justify-between items-center shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium border border-[hsl(var(--panel-border))] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--panel))] rounded-xl hover:bg-[hsl(var(--panel-muted))] transition-colors"
          >
            {t("Close")}
          </button>
          <button
            onClick={onContinue}
            className="px-6 py-2.5 bg-[hsl(var(--brand))] text-white text-sm font-medium rounded-xl hover:bg-[hsl(var(--brand-strong))] transition-all shadow-sm flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            {t("Continue")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
