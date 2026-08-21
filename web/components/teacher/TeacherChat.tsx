"use client";

import MarkdownRenderer from "@/components/common/MarkdownRenderer";

export interface TeacherMessage {
  role: "user" | "assistant";
  content: string;
}

interface TeacherChatProps {
  messages: TeacherMessage[];
  isLoading: boolean;
  loadingLabel: string;
}

export default function TeacherChat({
  messages,
  isLoading,
  loadingLabel,
}: TeacherChatProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
      {messages.map((message, index) => (
        <div
          key={`${message.role}-${index}`}
          className={`max-w-[88%] rounded-[24px] px-4 py-3 ${
            message.role === "user"
              ? "ml-auto bg-[hsl(var(--brand-strong))] text-white"
              : "border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] text-[hsl(var(--foreground))]"
          }`}
        >
          {message.role === "assistant" ? (
            <MarkdownRenderer content={message.content} variant="prose" />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7">
              {message.content}
            </p>
          )}
        </div>
      ))}
      {isLoading ? (
        <div className="max-w-[88%] rounded-[24px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          {loadingLabel}
        </div>
      ) : null}
    </div>
  );
}
