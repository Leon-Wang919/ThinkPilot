"use client";

import type { TFunction } from "i18next";
import { AlertCircle, BookOpen, Database, Loader2, Sparkles } from "lucide-react";
import { GuideMode, KnowledgeBaseOption } from "../types";
import { useTranslation } from "react-i18next";
import { Button, Panel } from "@/components/ui";

interface KnowledgeBaseSelectorProps {
  knowledgeBases: KnowledgeBaseOption[];
  selectedKb: string;
  mode: GuideMode;
  topic: string;
  loadingKnowledgeBases: boolean;
  isLoading: boolean;
  onSelectKb: (kbName: string) => void;
  onModeChange: (mode: GuideMode) => void;
  onTopicChange: (topic: string) => void;
  onCreateSession: () => void;
}

function getKbStatusLabel(
  t: TFunction,
  status?: KnowledgeBaseOption["statistics"]["status"],
) {
  switch (status) {
    case "ready":
      return t("Ready");
    case "processing":
      return t("Processing");
    case "initializing":
      return t("Initializing");
    case "error":
      return t("Error");
    default:
      return t("Unknown");
  }
}

function getKbStatusMessage(t: TFunction, kb?: KnowledgeBaseOption | null) {
  if (!kb) {
    return t("Select a knowledge base to start guided learning.");
  }

  const status = kb.statistics?.status;
  const progress = kb.statistics?.progress;
  const progressMessage = progress?.message?.trim();
  const errorDetail = progress?.error?.trim() || progressMessage;

  if (status === "ready") {
    return t("Ready for guided learning with {name}.", { name: kb.name });
  }

  if (status === "processing" || status === "initializing") {
    return progressMessage
      ? t("This knowledge base is not ready yet. {message}", {
          message: progressMessage,
        })
      : t("This knowledge base is not ready yet.");
  }

  if (status === "error") {
    return errorDetail
      ? t("This knowledge base failed to initialize. {detail}", {
          detail: errorDetail,
        })
      : t("This knowledge base failed to initialize.");
  }

  return t("This knowledge base is not ready yet.");
}

export default function KnowledgeBaseSelector({
  knowledgeBases,
  selectedKb,
  mode,
  topic,
  loadingKnowledgeBases,
  isLoading,
  onSelectKb,
  onModeChange,
  onTopicChange,
  onCreateSession,
}: KnowledgeBaseSelectorProps) {
  const { t } = useTranslation();
  const selectedKbInfo =
    knowledgeBases.find((kb) => kb.name === selectedKb) || knowledgeBases[0];
  const selectedStatus = selectedKbInfo?.statistics?.status;
  const hasReadyKb = knowledgeBases.some((kb) => kb.statistics?.status === "ready");
  const topicRequired = mode === "topic";
  const topicMissing =
    topicRequired && selectedStatus === "ready" && Boolean(selectedKbInfo) && !topic.trim();

  let blockingReason = "";
  if (!knowledgeBases.length) {
    blockingReason = t(
      "Create or import a knowledge base first. Guided Learning now uses knowledge bases directly.",
    );
  } else if (!selectedKbInfo) {
    blockingReason = t(
      "Select a knowledge base before creating a learning session.",
    );
  } else if (selectedStatus !== "ready") {
    blockingReason = getKbStatusMessage(t, selectedKbInfo);
  } else if (topicMissing) {
    blockingReason = t(
      "Topic Mode requires a knowledge point or chapter name.",
    );
  }

  const buttonLabel =
    mode === "curriculum"
      ? t("Generate Curriculum")
      : t("Create Learning Plan");

  return (
    <Panel className="shrink-0" bodyClassName="flex flex-col gap-5 p-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-5 h-5 text-[hsl(var(--brand-strong))]" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("Knowledge-Base Guided Learning")}
          </h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {t(
            "Guided Learning now starts from a knowledge base. Choose a ready knowledge base, then learn either a specific topic or the full curriculum.",
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onModeChange("topic")}
          className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${mode === "topic" ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50"}`}
        >
          {t("Topic Mode")}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("curriculum")}
          className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${mode === "curriculum" ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50"}`}
        >
          {t("Curriculum Mode")}
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("Knowledge Base")}
        </label>
        {loadingKnowledgeBases ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("Loading knowledge bases...")}
          </div>
        ) : (
          <select
            value={selectedKb}
            onChange={(event) => onSelectKb(event.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {knowledgeBases.length === 0 ? (
              <option value="">{t("No knowledge bases available")}</option>
            ) : (
              knowledgeBases.map((kb) => (
                <option key={kb.name} value={kb.name}>
                  {kb.name}
                  {kb.statistics?.status
                    ? ` (${getKbStatusLabel(t, kb.statistics.status)})`
                    : ""}
                </option>
              ))
            )}
          </select>
        )}
      </div>

      {mode === "topic" && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("Topic / Chapter")}
          </label>
          <input
            value={topic}
            onChange={(event) => onTopicChange(event.target.value)}
            placeholder={t("Enter a knowledge point, chapter, or topic")}
            className={`w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-100 ${
              topicMissing
                ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/20 dark:border-rose-700"
                : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700"
            }`}
          />
          {topicMissing && (
            <div className="flex items-center gap-2 px-1 text-sm text-rose-600 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t("Topic Mode requires a knowledge point or chapter name.")}</span>
            </div>
          )}
        </div>
      )}

      {selectedKbInfo && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              <BookOpen className="w-4 h-4 text-slate-500" />
              {selectedKbInfo.name}
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              {getKbStatusLabel(t, selectedKbInfo.statistics?.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {getKbStatusMessage(t, selectedKbInfo)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t("Provider")}:{" "}
            {t(selectedKbInfo.statistics?.rag_provider || "Unconfigured")}
          </p>
        </div>
      )}

      {!hasReadyKb && !loadingKnowledgeBases && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          {t(
            "No ready knowledge base was found. Initialize a knowledge base first, or switch to other modules until indexing completes.",
          )}
        </div>
      )}

      {blockingReason && !topicMissing && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{blockingReason}</span>
        </div>
      )}

      <Button
        type="button"
        onClick={onCreateSession}
        disabled={Boolean(blockingReason) || isLoading}
        className="w-full justify-center whitespace-nowrap"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("Generating...")}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {buttonLabel}
          </>
        )}
      </Button>
    </Panel>
  );
}
