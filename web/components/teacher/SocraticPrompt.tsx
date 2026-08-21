"use client";

interface SocraticPromptProps {
  prompts: string[];
  title: string;
  emptyLabel: string;
}

export default function SocraticPrompt({
  prompts,
  title,
  emptyLabel,
}: SocraticPromptProps) {
  return (
    <div className="rounded-[28px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.88] px-4 py-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
        {title}
      </div>
      {prompts.length ? (
        <div className="space-y-3">
          {prompts.map((prompt, index) => (
            <p
              key={`${index}-${prompt}`}
              className="rounded-[20px] bg-[hsl(var(--brand-soft))] px-3 py-3 text-sm leading-7 text-[hsl(var(--brand-pressed))]"
            >
              {prompt}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}
