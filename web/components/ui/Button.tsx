"use client";

import React from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const variantStyles = {
  primary:
    "bg-[hsl(var(--brand-strong))] text-white hover:bg-[hsl(var(--brand-pressed))] shadow-[0_14px_34px_-18px_hsl(var(--brand-strong)/0.8)] dark:shadow-[0_16px_38px_-22px_rgba(59,130,246,0.52)]",
  secondary:
    "border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--panel-border))] dark:bg-[hsl(var(--panel-muted))] dark:text-[hsl(var(--foreground))] dark:hover:bg-[hsl(var(--panel-border))]",
  danger:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-95 shadow-[0_14px_34px_-18px_hsl(var(--destructive)/0.55)] dark:shadow-[0_16px_38px_-22px_rgba(220,38,38,0.45)]",
  ghost:
    "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--panel-muted))] hover:text-[hsl(var(--foreground))] dark:hover:bg-[hsl(var(--panel-muted))]",
};

const sizeStyles = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-all
        disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-soft))]
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
}
