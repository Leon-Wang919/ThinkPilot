"use client";

interface StepDisplayProps {
  steps: string[];
  emptyLabel: string;
  currentStep?: number;
}

export default function StepDisplay({
  steps,
  emptyLabel,
  currentStep = 0,
}: StepDisplayProps) {
  if (!steps.length) {
    return (
      <div className="rounded-[24px] border border-dashed border-[hsl(var(--panel-border))] px-4 py-5 text-sm text-[hsl(var(--muted-foreground))]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div
          key={`${index}-${step}`}
          className={`rounded-[24px] border px-4 py-4 ${
            currentStep === index + 1
              ? "border-[hsl(var(--brand-soft))] bg-[hsl(var(--brand-soft))/0.16]"
              : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.82]"
          }`}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Step {index + 1}
            {currentStep === index + 1 ? <span>Active</span> : null}
          </div>
          <p className="text-sm leading-7 text-[hsl(var(--foreground))]">
            {step}
          </p>
        </div>
      ))}
    </div>
  );
}
