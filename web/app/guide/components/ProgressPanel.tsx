"use client";

import { Loader2, Play, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { SessionState } from "../types";
import { useTranslation } from "react-i18next";
import { Button, Panel } from "@/components/ui";

interface ProgressPanelProps {
  sessionState: SessionState;
  isLoading: boolean;
  canStart: boolean;
  canNext: boolean;
  canPrevious: boolean;
  isLastKnowledge: boolean;
  onStartLearning: () => void;
  onNextKnowledge: () => void;
  onPreviousKnowledge: () => void;
}

export default function ProgressPanel({
  sessionState,
  isLoading,
  canStart,
  canNext,
  canPrevious,
  isLastKnowledge,
  onStartLearning,
  onNextKnowledge,
  onPreviousKnowledge,
}: ProgressPanelProps) {
  const { t } = useTranslation();
  return (
    <Panel bodyClassName="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {t("Learning Progress")}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {sessionState.progress}%
        </span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${sessionState.progress}%` }}
        />
      </div>
      {sessionState.knowledge_points.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          {t("Knowledge Point {n} / {total}")
            .replace("{n}", String(sessionState.current_index + 1))
            .replace("{total}", String(sessionState.knowledge_points.length))}
        </p>
      )}
      {(sessionState.source_label || sessionState.kb_name) && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <span className="font-medium text-slate-700 dark:text-slate-100">
            {t("Source Knowledge Base")}:
          </span>{" "}
          {sessionState.source_label || sessionState.kb_name}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {canPrevious && (
          <Button
            onClick={onPreviousKnowledge}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Loading...")}
              </>
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                {t("Previous")}
              </>
            )}
          </Button>
        )}

        {canStart && (
          <Button
            onClick={onStartLearning}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Generating...")}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {t("Start Learning")}
              </>
            )}
          </Button>
        )}

        {canNext && (
          <Button
            onClick={onNextKnowledge}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Loading...")}
              </>
            ) : (
              <>
                <ChevronRight className="w-4 h-4" />
                {t("Next")}
              </>
            )}
          </Button>
        )}

        {isLastKnowledge && (
          <Button
            onClick={onNextKnowledge}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Generating Summary...")}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {t("Complete Learning")}
              </>
            )}
          </Button>
        )}
      </div>
    </Panel>
  );
}
