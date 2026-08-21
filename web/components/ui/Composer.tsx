"use client";

import React, { useRef } from "react";
import { Loader2, Send } from "lucide-react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  submitDisabled?: boolean;
  multiline?: boolean;
  maxHeight?: number;
  helperText?: React.ReactNode;
  context?: React.ReactNode;
  className?: string;
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  loading = false,
  submitDisabled = false,
  multiline = false,
  maxHeight = 200,
  helperText,
  context,
  className = "",
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  };

  return (
    <div className={className}>
      <div className="tp-composer">
        {context ? (
          <div className="border-b border-[hsl(var(--panel-border))] px-4 py-2.5">
            {context}
          </div>
        ) : null}
        <div className="relative">
          {multiline ? (
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(event) => {
                onChange(event.target.value);
                resizeTextarea(event.target);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              className="tp-composer-input min-h-[68px] pr-16"
              style={{ maxHeight }}
            />
          ) : (
            <input
              type="text"
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              className="tp-composer-input min-h-[52px] pr-16"
            />
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || loading || submitDisabled || !value.trim()}
            className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-[20px] bg-[hsl(var(--brand-strong))] text-white shadow-[0_12px_30px_-18px_hsl(var(--brand-strong)/0.8)] transition-all hover:bg-[hsl(var(--brand-pressed))] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {helperText ? (
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
