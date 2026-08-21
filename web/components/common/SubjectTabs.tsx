"use client";

import {
  Atom,
  BookText,
  CheckCircle2,
  Cpu,
  LucideIcon,
  MoveRight,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGlobal } from "@/context/GlobalContext";
import { SUBJECT_OPTIONS, type Subject } from "@/types/subject";

const SUBJECT_VISUALS: Record<
  Subject,
  {
    icon: LucideIcon;
    descriptionKey: string;
    activeCardClassName: string;
    activeIconWrapClassName: string;
    activeIconClassName: string;
    accentBarClassName: string;
    pillClassName: string;
  }
> = {
  liberal_arts: {
    icon: BookText,
    descriptionKey: "Reading, discourse, and analytical writing",
    activeCardClassName:
      "border-amber-200/90 bg-amber-50/90 shadow-[0_20px_44px_-34px_rgba(217,119,6,0.45)] dark:border-amber-900/80 dark:bg-amber-950/22 dark:shadow-[0_20px_44px_-34px_rgba(245,158,11,0.24)]",
    activeIconWrapClassName:
      "border-amber-200/90 bg-amber-100 dark:border-amber-900/80 dark:bg-amber-950/45",
    activeIconClassName: "text-amber-600 dark:text-amber-300",
    accentBarClassName: "bg-amber-500/85 dark:bg-amber-400/85",
    pillClassName:
      "border-amber-200/90 bg-amber-50 text-amber-700 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-300",
  },
  science: {
    icon: Atom,
    descriptionKey: "Formulas, experiments, and scientific models",
    activeCardClassName:
      "border-cyan-200/90 bg-cyan-50/90 shadow-[0_20px_44px_-34px_rgba(8,145,178,0.42)] dark:border-cyan-900/80 dark:bg-cyan-950/22 dark:shadow-[0_20px_44px_-34px_rgba(34,211,238,0.24)]",
    activeIconWrapClassName:
      "border-cyan-200/90 bg-cyan-100 dark:border-cyan-900/80 dark:bg-cyan-950/45",
    activeIconClassName: "text-cyan-600 dark:text-cyan-300",
    accentBarClassName: "bg-cyan-500/85 dark:bg-cyan-400/85",
    pillClassName:
      "border-cyan-200/90 bg-cyan-50 text-cyan-700 dark:border-cyan-900/80 dark:bg-cyan-950/40 dark:text-cyan-300",
  },
  engineering: {
    icon: Cpu,
    descriptionKey: "Systems, design, and applied problem solving",
    activeCardClassName:
      "border-emerald-200/90 bg-emerald-50/90 shadow-[0_20px_44px_-34px_rgba(5,150,105,0.42)] dark:border-emerald-900/80 dark:bg-emerald-950/22 dark:shadow-[0_20px_44px_-34px_rgba(52,211,153,0.22)]",
    activeIconWrapClassName:
      "border-emerald-200/90 bg-emerald-100 dark:border-emerald-900/80 dark:bg-emerald-950/45",
    activeIconClassName: "text-emerald-600 dark:text-emerald-300",
    accentBarClassName: "bg-emerald-500/85 dark:bg-emerald-400/85",
    pillClassName:
      "border-emerald-200/90 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
};

export default function SubjectTabs() {
  const { currentSubject, setSubject } = useGlobal();
  const { t } = useTranslation();
  const currentSubjectLabel =
    SUBJECT_OPTIONS.find((subject) => subject.value === currentSubject)?.labelKey ??
    "Science";
  const currentVisual = SUBJECT_VISUALS[currentSubject];

  return (
    <div className="px-4 py-2 md:px-5">
      <div className="relative overflow-hidden rounded-2xl border border-[hsl(var(--panel-border))/0.92] bg-[hsl(var(--panel))/0.96] shadow-[0_16px_40px_-34px_rgba(15,23,42,0.34)] backdrop-blur">
        <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-[hsl(var(--brand))/0.05] blur-2xl" />
        <div className="relative flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3 lg:min-w-[280px] lg:max-w-[320px]">
            <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.72] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
              <Sparkles className="h-3 w-3" />
              {t("Subjects")}
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${currentVisual.pillClassName}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentVisual.accentBarClassName}`} />
              {t(currentSubjectLabel)}
            </span>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            {SUBJECT_OPTIONS.map((subject) => {
              const active = subject.value === currentSubject;
              const visual = SUBJECT_VISUALS[subject.value];
              const SubjectIcon = visual.icon;

              return (
                <button
                  key={subject.value}
                  type="button"
                  onClick={() => setSubject(subject.value)}
                  aria-pressed={active}
                  className={`group relative overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28] ${
                    active
                      ? `${visual.activeCardClassName}`
                      : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.52] hover:border-[hsl(var(--panel-border))/0.96] hover:bg-[hsl(var(--panel))/0.98] hover:shadow-[0_18px_38px_-34px_rgba(15,23,42,0.26)]"
                  }`}
                >
                  <div
                    className={`absolute inset-x-0 top-0 h-1 ${
                      active ? visual.accentBarClassName : "bg-transparent"
                    }`}
                  />

                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                        active
                          ? visual.activeIconWrapClassName
                          : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.96]"
                      }`}
                    >
                      <SubjectIcon
                        className={`h-4 w-4 ${
                          active
                            ? visual.activeIconClassName
                            : "text-[hsl(var(--muted-foreground))] transition-colors group-hover:text-[hsl(var(--foreground))]"
                        }`}
                      />
                    </div>
                    {active ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--brand))/0.16] bg-[hsl(var(--brand-soft))] px-2 py-1 text-[10px] font-semibold text-[hsl(var(--brand))]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("Active")}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2.5">
                    <div className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
                      {t(subject.labelKey)}
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between">
                    <span
                      className={`h-1.5 w-12 rounded-full transition-all ${
                        active
                          ? visual.accentBarClassName
                          : "bg-[hsl(var(--panel-border))] group-hover:bg-[hsl(var(--muted-foreground))/0.28]"
                      }`}
                    />
                    <MoveRight
                      className={`h-4 w-4 transition-all ${
                        active
                          ? "translate-x-0 text-[hsl(var(--foreground))]"
                          : "text-[hsl(var(--muted-foreground))] group-hover:translate-x-0.5 group-hover:text-[hsl(var(--foreground))]"
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
