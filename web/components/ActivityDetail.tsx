"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X, HelpCircle, Search, Clock, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { processLatexContent } from "@/lib/latex";

// Map English activity types to Chinese
const TYPE_LABELS = {
  solve: "解题",
  research: "研究",
  chat: "聊天",
};

type ActivityType = keyof typeof TYPE_LABELS;

// Hook to safely detect client-side rendering
const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface ActivityDetailProps {
  activity: {
    type: ActivityType | string;
    timestamp: number;
    content?: any;
    [key: string]: any;
  } | null;
  onClose: () => void;
}

export default function ActivityDetail({
  activity,
  onClose,
}: ActivityDetailProps) {
  const mounted = useIsClient();
  const { t } = useTranslation();

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

  if (!activity || !mounted) return null;

  const activityTypeLabel =
    activity.type in TYPE_LABELS
      ? TYPE_LABELS[activity.type as ActivityType]
      : activity.type;

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
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                activity.type === "solve"
                  ? "bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand))]"
                  : "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {activity.type === "solve" && <HelpCircle className="w-5 h-5" />}
              {activity.type === "research" && <Search className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-bold text-[hsl(var(--foreground))] text-lg">
                {t("Activity Details")}
              </h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {new Date(activity.timestamp * 1000).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[hsl(var(--panel-muted))] hover:bg-[hsl(var(--panel-border))] flex items-center justify-center text-[hsl(var(--muted-foreground))] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Meta Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[hsl(var(--panel-muted))] rounded-xl border border-[hsl(var(--panel-border))]">
              <div className="text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                {t("Type")}
              </div>
              <div className="font-medium text-[hsl(var(--foreground))] capitalize">
                {activityTypeLabel}
              </div>
            </div>
            <div className="p-4 bg-[hsl(var(--panel-muted))] rounded-xl border border-[hsl(var(--panel-border))]">
              <div className="text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                {t("Knowledge Base")}
              </div>
              <div className="font-medium text-[hsl(var(--foreground))] flex items-center gap-2">
                <Database className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                {activity.content?.kb_name || t("Unknown")}
              </div>
            </div>
          </div>

          {/* Activity Specific Content */}

          {/* 1. SOLVE */}
          {activity.type === "solve" && (
            <>
              <div className="space-y-2">
                <h3 className="font-bold text-[hsl(var(--foreground))]">
                  {t("Question")}
                </h3>
                <div className="p-4 bg-[hsl(var(--panel-muted))] rounded-xl border border-[hsl(var(--panel-border))] text-[hsl(var(--foreground))] leading-relaxed">
                  {activity.content.question}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-[hsl(var(--foreground))]">
                  {t("Final Answer")}
                </h3>
                <div className="p-6 bg-[hsl(var(--panel))] rounded-xl border border-[hsl(var(--panel-border))] shadow-sm">
                  <div className="prose prose-slate dark:prose-invert max-w-none prose-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {processLatexContent(activity.content.answer)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 2. RESEARCH */}
          {activity.type === "research" && (
            <>
              <div className="space-y-2">
                <h3 className="font-bold text-[hsl(var(--foreground))]">
                  {t("Topic")}
                </h3>
                <div className="text-lg font-medium text-[hsl(var(--foreground))]">
                  {activity.content.topic}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-[hsl(var(--foreground))]">
                  {t("Report Preview")}
                </h3>
                <div className="p-6 bg-[hsl(var(--panel))] rounded-xl border border-[hsl(var(--panel-border))] shadow-sm max-h-96 overflow-y-auto font-mono text-xs text-[hsl(var(--muted-foreground))]">
                  {activity.content.report}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] rounded-b-2xl flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[hsl(var(--foreground))] text-[hsl(var(--panel))] rounded-xl font-medium hover:opacity-90 transition-colors"
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
