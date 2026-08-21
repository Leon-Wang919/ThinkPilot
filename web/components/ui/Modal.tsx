"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  showCloseButton?: boolean;
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  className?: string;
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  footer,
  closeOnBackdrop = true,
  className = "",
}: ModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Modal Content */}
      <div
        className={`
        relative mx-4 w-full rounded-[28px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--panel-foreground))] shadow-[0_32px_80px_-30px_rgba(15,23,42,0.55)]
        animate-in zoom-in-95 fade-in
        ${sizeStyles[size]}
        ${className}
      `}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between border-b border-[hsl(var(--panel-border))] px-5 py-4">
            {title && (
              <h3 className="text-base font-semibold tracking-tight text-[hsl(var(--panel-foreground))]">
                {title}
              </h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="ml-auto rounded-xl p-2 transition-colors hover:bg-[hsl(var(--panel-muted))]"
              >
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="max-h-[80vh] overflow-y-auto">{children}</div>
        {footer ? (
          <div className="border-t border-[hsl(var(--panel-border))] px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
