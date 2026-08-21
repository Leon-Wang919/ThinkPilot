"use client";

import React from "react";

interface PanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  muted?: boolean;
  style?: React.CSSProperties;
}

export default function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
  headerClassName = "",
  muted = false,
  style,
}: PanelProps) {
  return (
    <section
      className={`tp-panel ${muted ? "tp-panel-muted" : ""} ${className}`.trim()}
      style={style}
    >
      {(title || description || actions) && (
        <header
          className={`flex items-start justify-between gap-3 border-b border-[hsl(var(--panel-border))] px-4 py-3.5 ${headerClassName}`.trim()}
        >
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-tight text-[hsl(var(--panel-foreground))]">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm leading-5 text-[hsl(var(--muted-foreground))]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      )}
      <div className={`min-h-0 ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}
