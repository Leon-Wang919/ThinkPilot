"use client";

import { CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { processLatexContent } from "@/lib/latex";

interface CompletionSummaryProps {
  summary: string;
  sourceLabel?: string;
  onExit: () => void;
}

export default function CompletionSummary({
  summary,
  sourceLabel,
  onExit,
}: CompletionSummaryProps) {
  const { t } = useTranslation();
  // Table components for ReactMarkdown
  const tableComponents = {
    table: ({ node, ...props }: any) => (
      <div className="my-6 overflow-x-auto rounded-lg border border-[hsl(var(--panel-border))] shadow-sm">
        <table
          className="min-w-full divide-y divide-[hsl(var(--panel-border))] text-sm"
          {...props}
        />
      </div>
    ),
    thead: ({ node, ...props }: any) => (
      <thead className="bg-[hsl(var(--panel-muted))]" {...props} />
    ),
    th: ({ node, ...props }: any) => (
      <th
        className="whitespace-nowrap border-b border-[hsl(var(--panel-border))] px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]"
        {...props}
      />
    ),
    tbody: ({ node, ...props }: any) => (
      <tbody
        className="divide-y divide-[hsl(var(--panel-border))] bg-[hsl(var(--panel))]"
        {...props}
      />
    ),
    td: ({ node, ...props }: any) => (
      <td
        className="border-b border-[hsl(var(--panel-border))] px-4 py-3 text-[hsl(var(--muted-foreground))]"
        {...props}
      />
    ),
    tr: ({ node, ...props }: any) => (
      <tr
        className="transition-colors hover:bg-[hsl(var(--panel-muted))]/50"
        {...props}
      />
    ),
  };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] shadow-sm">
      {/* Summary Header */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[hsl(var(--panel-border))] bg-[hsl(var(--brand-soft))] p-4">
        <div className="min-w-0">
          <h2 className="font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            {t("Learning Summary")}
          </h2>
          {sourceLabel && (
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {t("Source Knowledge Base")}: {sourceLabel}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-xl bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-medium text-[hsl(var(--panel))] transition-colors hover:opacity-90"
        >
          {t("Finish & Exit")}
        </button>
      </div>
      {/* Summary Content */}
      <div className="flex-1 overflow-y-auto bg-[hsl(var(--panel))] p-8">
        <div className="prose prose-slate dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={tableComponents}
          >
            {processLatexContent(summary || "")}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
