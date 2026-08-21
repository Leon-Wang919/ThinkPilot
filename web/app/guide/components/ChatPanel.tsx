"use client";

import { useRef, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { processLatexContent } from "@/lib/latex";
import { Composer, Panel } from "@/components/ui";
import { ChatMessage } from "../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isLearning: boolean;
  onSendMessage: (message: string) => void;
}

export default function ChatPanel({
  messages,
  isLearning,
  onSendMessage,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [inputMessage, setInputMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sendingMessage) return;

    setSendingMessage(true);
    const message = inputMessage;
    setInputMessage("");

    try {
      await onSendMessage(message);
    } finally {
      setSendingMessage(false);
    }
  };

  // Table components for ReactMarkdown
  const tableComponents = {
    table: ({ node, ...props }: any) => (
      <div className="my-4 overflow-x-auto rounded-lg border border-slate-200 shadow-sm dark:border-slate-700">
        <table
          className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700"
          {...props}
        />
      </div>
    ),
    thead: ({ node, ...props }: any) => (
      <thead className="bg-slate-50 dark:bg-slate-800/90" {...props} />
    ),
    th: ({ node, ...props }: any) => (
      <th
        className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
        {...props}
      />
    ),
    tbody: ({ node, ...props }: any) => (
      <tbody
        className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900/70"
        {...props}
      />
    ),
    td: ({ node, ...props }: any) => (
      <td
        className="border-b border-slate-100 px-3 py-2 text-slate-600 dark:border-slate-800 dark:text-slate-300"
        {...props}
      />
    ),
    tr: ({ node, ...props }: any) => (
      <tr
        className="transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
        {...props}
      />
    ),
  };

  return (
    <Panel
      className="flex-1"
      title={
        <span className="inline-flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[hsl(var(--brand-strong))]" />
          {t("Learning Assistant")}
        </span>
      }
      bodyClassName="flex h-full min-h-0 flex-col"
    >
      <div
        ref={chatContainerRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-[24px] px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-[linear-gradient(135deg,hsl(var(--brand-strong))_0%,hsl(var(--brand-pressed))_100%)] text-white shadow-[0_18px_40px_-26px_rgba(37,99,235,0.78)]"
                  : msg.role === "system" && msg.content.includes("⏳")
                    ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100"
                    : msg.role === "system"
                      ? "border border-[hsl(var(--brand-soft))] bg-[hsl(var(--brand-soft))/0.55] text-[hsl(var(--brand-pressed))] dark:border-[hsl(var(--panel-border))] dark:bg-[hsl(var(--panel-muted))] dark:text-[hsl(var(--foreground))/0.92]"
                      : "border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.75] text-[hsl(var(--foreground))]"
              }`}
            >
              {msg.role === "system" || msg.role === "assistant" ? (
                <div className="prose prose-sm max-w-none prose-slate dark:prose-invert">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={tableComponents}
                  >
                    {processLatexContent(msg.content)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {isLearning && (
        <div className="border-t border-[hsl(var(--panel-border))] px-4 py-4">
          <Composer
            value={inputMessage}
            onChange={setInputMessage}
            onSubmit={handleSendMessage}
            placeholder={t("Have any questions? Feel free to ask...")}
            disabled={sendingMessage}
            loading={sendingMessage}
          />
        </div>
      )}
    </Panel>
  );
}
