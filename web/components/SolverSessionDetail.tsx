"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Calculator,
  User,
  Bot,
  Clock,
  Loader2,
  Database,
  DollarSign,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { apiUrl, API_BASE_URL } from "@/lib/api";
import { processLatexContent } from "@/lib/latex";
import { useGlobal } from "@/context/GlobalContext";
import { useTranslation } from "react-i18next";

interface SolverMessage {
  role: "user" | "assistant";
  content: string;
  output_dir?: string;
  timestamp?: number;
}

interface SolverSession {
  session_id: string;
  title: string;
  messages: SolverMessage[];
  kb_name: string;
  token_stats?: {
    model: string;
    calls: number;
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  };
  created_at: number;
  updated_at: number;
}

interface SolverSessionDetailProps {
  sessionId: string;
  onClose: () => void;
  onContinue: () => void;
}

const resolveArtifactUrl = (url?: string | null, outputDir?: string) => {
  if (!url) return "";

  // Already absolute http/https URL
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const normalized = url.replace(/^\.\//, "");

  // Backend already rewrote to /api/outputs/solve/...
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

export default function SolverSessionDetail({
  sessionId,
  onClose,
  onContinue,
}: SolverSessionDetailProps) {
  const { uiSettings } = useGlobal();
  const { t } = useTranslation();

  const [session, setSession] = useState<SolverSession | null>(null);
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
          apiUrl(`/api/v1/solve/sessions/${sessionId}`),
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
        className="relative bg-[hsl(var(--panel))] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[hsl(var(--panel-border))] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[hsl(var(--brand-soft))] flex items-center justify-center">
              <Calculator className="w-5 h-5 text-[hsl(var(--brand))]" />
            </div>
            <div>
              <h2 className="font-bold text-[hsl(var(--foreground))] text-lg">
                {session?.title || t("Solver History")}
              </h2>
              {session && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  {new Date(session.created_at * 1000).toLocaleString(
                    uiSettings.language === "zh" ? "zh-CN" : "en-US",
                  )}
                  <span className="mx-1">•</span>
                  {session.messages.length} {t("messages")}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[hsl(var(--panel-muted))] hover:bg-[hsl(var(--panel-border))] flex items-center justify-center text-[hsl(var(--muted-foreground))] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--brand))]" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500 dark:text-red-400">{error}</p>
            </div>
          ) : session ? (
            <div className="space-y-4">
              {/* Session Info */}
              <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[hsl(var(--panel-border))]">
                {session.kb_name && (
                  <span className="px-2.5 py-1 text-xs font-medium bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand))] rounded-full flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {t("KB")}: {session.kb_name}
                  </span>
                )}
                {session.token_stats && (
                  <>
                    {session.token_stats.model && (
                      <span className="px-2.5 py-1 text-xs font-medium bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded-full">
                        {session.token_stats.model}
                      </span>
                    )}
                    {session.token_stats.tokens > 0 && (
                      <span className="px-2.5 py-1 text-xs font-medium bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded-full">
                        {session.token_stats.tokens.toLocaleString()}{" "}
                        {t("tokens")}
                      </span>
                    )}
                    {session.token_stats.cost > 0 && (
                      <span className="px-2.5 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {session.token_stats.cost.toFixed(4)}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Messages */}
              {session.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand-soft))] flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-[hsl(var(--brand))]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-[hsl(var(--brand))] text-white rounded-br-none"
                        : "bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded-bl-none"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-2">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          urlTransform={(url) =>
                            resolveArtifactUrl(url, msg.output_dir)
                          }
                          components={{
                            img: ({ node, src, alt, ...props }) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                {...props}
                                src={
                                  resolveArtifactUrl(
                                    typeof src === "string" ? src : "",
                                    msg.output_dir,
                                  ) || undefined
                                }
                                alt={alt || t("Solution image")}
                                loading="lazy"
                                className="max-w-full h-auto rounded-lg"
                              />
                            ),
                            a: ({ node, href, ...props }) => (
                              <a
                                {...props}
                                href={
                                  resolveArtifactUrl(
                                    typeof href === "string" ? href : "",
                                    msg.output_dir,
                                  ) || undefined
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-[hsl(var(--brand))] hover:underline"
                              />
                            ),
                          }}
                        >
                          {processLatexContent(msg.content)}
                        </ReactMarkdown>
                      </div>
                    )}

                    {/* Timestamp */}
                    {msg.timestamp && (
                      <p
                        className={`text-xs mt-2 ${
                          msg.role === "user"
                            ? "text-white/60"
                            : "text-[hsl(var(--muted-foreground))]"
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
                    <div className="w-8 h-8 rounded-full bg-[hsl(var(--brand))] flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] rounded-b-2xl flex justify-between items-center shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded-xl font-medium hover:bg-[hsl(var(--panel-border))] transition-colors"
          >
            {t("Close")}
          </button>
          <button
            onClick={onContinue}
            className="px-6 py-2.5 bg-[hsl(var(--brand))] text-white rounded-xl font-medium hover:bg-[hsl(var(--brand-strong))] transition-colors flex items-center gap-2"
          >
            <Calculator className="w-4 h-4" />
            {t("Continue")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
