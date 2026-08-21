"use client";

import React from "react";

interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`tp-page-header flex flex-wrap items-start justify-between gap-3 md:gap-5 ${className}`.trim()}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-[hsl(var(--muted-foreground))] md:text-[10.5px] md:tracking-[0.1em]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[1.6rem] font-semibold tracking-tight text-[hsl(var(--foreground))] md:text-[1.8rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[52rem] text-sm leading-6 text-[hsl(var(--muted-foreground))] md:text-[14px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full justify-start md:w-auto md:shrink-0 md:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
