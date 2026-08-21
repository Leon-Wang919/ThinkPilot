"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { processLatexContent } from "@/lib/latex";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: "default" | "compact" | "prose";
}

/**
 * Shared MarkdownRenderer component with KaTeX support and consistent table styling
 */
export default function MarkdownRenderer({
  content,
  className = "",
  variant = "default",
}: MarkdownRendererProps) {
  // Table components with consistent styling
  const tableComponents = {
    table: ({ node, ...props }: any) => (
      <div
        className={`overflow-x-auto rounded-lg border border-[hsl(var(--panel-border))] shadow-sm ${
          variant === "compact" ? "my-2" : "my-4"
        }`}
      >
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
        className={`text-left font-semibold text-[hsl(var(--foreground))] whitespace-nowrap border-b border-[hsl(var(--panel-border))] ${
          variant === "compact" ? "px-2 py-1.5" : "px-3 py-2"
        }`}
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
        className={`text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--panel-border))] ${
          variant === "compact" ? "px-2 py-1.5" : "px-3 py-2"
        }`}
        {...props}
      />
    ),
    tr: ({ node, ...props }: any) => (
      <tr
        className="hover:bg-[hsl(var(--panel-muted))]/50 transition-colors"
        {...props}
      />
    ),
  };

  // Code block styling
  const codeComponents = {
    code: ({
      node,
      inline,
      className: codeClassName,
      children,
      ...props
    }: any) => {
      if (inline) {
        return (
          <code
            className="px-1.5 py-0.5 bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] rounded text-sm font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          className={`block p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-lg overflow-x-auto text-sm font-mono ${codeClassName || ""}`}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ node, children, ...props }: any) => (
      <pre className="my-4" {...props}>
        {children}
      </pre>
    ),
  };

  const proseClasses =
    variant === "prose"
      ? "prose prose-slate dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl max-w-none"
      : "prose prose-sm max-w-none";

  return (
    <div className={`${proseClasses} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          ...tableComponents,
          ...codeComponents,
        }}
      >
        {processLatexContent(content)}
      </ReactMarkdown>
    </div>
  );
}
