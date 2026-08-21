"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { BookOpen, FileUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui";
import { useGlobal } from "@/context/GlobalContext";
import { apiUrl } from "@/lib/api";
import { useGuideSession } from "@/app/guide/hooks/useGuideSession";
import {
  ChatPanel,
  CompletionSummary,
  DebugModal,
  HTMLViewer,
  NotebookSelector,
  ProgressPanel,
} from "@/app/guide/components";
import {
  GuideMode,
  Notebook,
  NotebookRecord,
  SelectedRecord,
} from "@/app/guide/types";

type KnowledgeBaseItem = {
  name: string;
  is_default?: boolean;
};

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 560;

const clampSidebarWidth = (value: number) =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));

export default function SmartReviewPage() {
  const { t } = useTranslation();
  const { currentSubject } = useGlobal();

  const {
    sessionState,
    chatMessages,
    isLoading,
    loadingMessage,
    canStart,
    canNext,
    canPrevious,
    isCompleted,
    isLastKnowledge,
    createSession,
    startLearning,
    nextKnowledge,
    previousKnowledge,
    sendMessage,
    fixHtml,
    resetGuideSession,
  } = useGuideSession();

  const [mode, setMode] = useState<GuideMode>("topic");
  const [topic, setTopic] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKb, setSelectedKb] = useState("");
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(false);
  const [kbHint, setKbHint] = useState("");

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loadingNotebooks, setLoadingNotebooks] = useState(false);
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [loadingRecordsFor, setLoadingRecordsFor] = useState<Set<string>>(new Set());
  const [notebookRecordsMap, setNotebookRecordsMap] = useState<Map<string, NotebookRecord[]>>(
    new Map(),
  );
  const [selectedRecords, setSelectedRecords] = useState<Map<string, SelectedRecord>>(
    new Map(),
  );

  const [uploading, setUploading] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [reviewEntryIds, setReviewEntryIds] = useState<string[]>([]);
  const [createSessionError, setCreateSessionError] = useState("");
  const [leftPaneWidth, setLeftPaneWidth] = useState(360);
  const [rightPaneWidth, setRightPaneWidth] = useState(360);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartLeftRef = useRef(360);
  const dragStartRightRef = useRef(360);

  const selectedRecordList = useMemo(() => Array.from(selectedRecords.values()), [selectedRecords]);

  const loadKnowledgeBases = useCallback(async () => {
    setLoadingKnowledgeBases(true);
    try {
      const params = new URLSearchParams({ subject: currentSubject });
      const res = await fetch(apiUrl(`/api/v1/knowledge/list?${params.toString()}`));
      const data = await res.json();
      let items = Array.isArray(data) ? (data as KnowledgeBaseItem[]) : [];

      // Fallback: if no KB under current subject, surface all KBs to avoid hard blocking review.
      if (items.length === 0) {
        const fallbackRes = await fetch(apiUrl("/api/v1/knowledge/list"));
        const fallbackData = await fallbackRes.json();
        const fallbackItems = Array.isArray(fallbackData)
          ? (fallbackData as KnowledgeBaseItem[])
          : [];
        if (fallbackItems.length > 0) {
          items = fallbackItems;
          setKbHint(t("No knowledge base found under current subject; showing all available knowledge bases."));
        } else {
          setKbHint(t("No knowledge bases available. Please create or import one first."));
        }
      } else {
        setKbHint("");
      }

      setKnowledgeBases(items);
      const defaultKb = items.find((kb) => kb.is_default)?.name || items[0]?.name || "";
      setSelectedKb((prev) => (prev && items.some((kb) => kb.name === prev) ? prev : defaultKb));
    } catch (error) {
      console.error("Failed to load knowledge bases:", error);
      setKnowledgeBases([]);
      setSelectedKb("");
      setKbHint(t("Failed to load knowledge bases. Please retry or check backend status."));
    } finally {
      setLoadingKnowledgeBases(false);
    }
  }, [currentSubject, t]);

  const inferKbFromRecords = useCallback((records: SelectedRecord[]) => {
    const candidateKeys = ["selected_kb", "kb_name", "knowledge_base", "kb"];
    const counts = new Map<string, number>();

    for (const record of records) {
      const metadata = (record.metadata || {}) as Record<string, unknown>;
      for (const key of candidateKeys) {
        const value = metadata[key];
        if (typeof value === "string" && value.trim()) {
          const kb = value.trim();
          counts.set(kb, (counts.get(kb) || 0) + 1);
        }
      }
      if (typeof record.kb_name === "string" && record.kb_name.trim()) {
        const kb = record.kb_name.trim();
        counts.set(kb, (counts.get(kb) || 0) + 1);
      }
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }, []);

  const loadNotebooks = useCallback(async () => {
    setLoadingNotebooks(true);
    try {
      const res = await fetch(apiUrl("/api/v1/review/notebooks"));
      const data = await res.json();
      const list = (data.notebooks || []) as Notebook[];
      const usable = list.filter((item) => (item.record_count || 0) > 0);
      setNotebooks(usable);
    } catch (error) {
      console.error("Failed to load review notebooks:", error);
      setNotebooks([]);
    } finally {
      setLoadingNotebooks(false);
    }
  }, []);

  useEffect(() => {
    loadKnowledgeBases();
    loadNotebooks();
  }, [loadKnowledgeBases, loadNotebooks]);

  const toggleExpanded = useCallback(
    async (notebookId: string) => {
      setExpandedNotebooks((prev) => {
        const next = new Set(prev);
        if (next.has(notebookId)) {
          next.delete(notebookId);
        } else {
          next.add(notebookId);
        }
        return next;
      });

      if (notebookRecordsMap.has(notebookId)) {
        return;
      }

      setLoadingRecordsFor((prev) => new Set(prev).add(notebookId));
      try {
        const res = await fetch(apiUrl(`/api/v1/review/notebooks/${notebookId}/records`));
        const data = await res.json();
        const records = (data.records || []) as NotebookRecord[];
        setNotebookRecordsMap((prev) => {
          const next = new Map(prev);
          next.set(notebookId, records);
          return next;
        });
      } catch (error) {
        console.error("Failed to load notebook records:", error);
      } finally {
        setLoadingRecordsFor((prev) => {
          const next = new Set(prev);
          next.delete(notebookId);
          return next;
        });
      }
    },
    [notebookRecordsMap],
  );

  const toggleRecord = useCallback(
    (record: NotebookRecord, notebookId: string, notebookName: string) => {
      setSelectedRecords((prev) => {
        const next = new Map(prev);
        if (next.has(record.id)) {
          next.delete(record.id);
        } else {
          next.set(record.id, {
            ...record,
            notebookId,
            notebookName,
          });
        }
        return next;
      });
    },
    [],
  );

  const selectAll = useCallback(
    (notebookId: string, notebookName: string) => {
      const records = notebookRecordsMap.get(notebookId) || [];
      setSelectedRecords((prev) => {
        const next = new Map(prev);
        for (const record of records) {
          next.set(record.id, { ...record, notebookId, notebookName });
        }
        return next;
      });
    },
    [notebookRecordsMap],
  );

  const deselectAll = useCallback(
    (notebookId: string) => {
      setSelectedRecords((prev) => {
        const next = new Map(prev);
        for (const item of Array.from(next.values())) {
          if (item.notebookId === notebookId) {
            next.delete(item.id);
          }
        }
        return next;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setSelectedRecords(new Map());
  }, []);

  const buildReviewNotes = useCallback((records: SelectedRecord[]) => {
    return records
      .slice(0, 8)
      .map((record, index) => {
        const title = record.title || `Record ${index + 1}`;
        const query = (record.user_query || "").slice(0, 600);
        const output = (record.output || "").slice(0, 1200);
        return [
          `### ${title}`,
          query ? `Question/Context:\n${query}` : "",
          output ? `Notes/Answer:\n${output}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      })
      .join("\n\n---\n\n");
  }, []);

  const extractEntryIds = useCallback((records: SelectedRecord[]) => {
    const ids = new Set<string>();
    for (const record of records) {
      const metadata = (record.metadata || {}) as Record<string, any>;
      const direct = metadata.error_entry_id || metadata.entry_id;
      if (typeof direct === "string" && direct.trim()) {
        ids.add(direct.trim());
      }
      const arr = metadata.error_entry_ids;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string" && item.trim()) {
            ids.add(item.trim());
          }
        }
      }
    }
    return Array.from(ids);
  }, []);

  const handleCreateSession = useCallback(async () => {
    if (selectedRecordList.length === 0) {
      setCreateSessionError(
        t("Please select at least one notebook record first."),
      );
      return;
    }

    const resolvedKb = selectedKb || inferKbFromRecords(selectedRecordList) || "";

    if (!selectedKb && resolvedKb) {
      setSelectedKb(resolvedKb);
    }

    setCreateSessionError("");

    const fallbackTopic = selectedRecordList
      .slice(0, 3)
      .map((r) => r.title)
      .filter(Boolean)
      .join(" / ")
      .slice(0, 140);

    const resolvedTopic = mode === "topic" ? (topic.trim() || fallbackTopic) : undefined;
    if (mode === "topic" && !resolvedTopic) {
      setCreateSessionError(t("Please enter a topic or pick records with valid titles."));
      return;
    }

    setReviewEntryIds(extractEntryIds(selectedRecordList));

    await createSession({
      kbName: resolvedKb,
      mode,
      topic: resolvedTopic,
      reviewNotes: buildReviewNotes(selectedRecordList),
      sourceLabel: `${t("Error Review")} · ${selectedRecordList.length} records`,
      sessionKind: "review",
    });
  }, [
    selectedKb,
    selectedRecordList,
    mode,
    topic,
    createSession,
    buildReviewNotes,
    extractEntryIds,
    inferKbFromRecords,
    t,
  ]);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !selectedKb) return;
      setUploading(true);
      try {
        const formData = new FormData();
        for (const file of Array.from(files)) {
          formData.append("files", file);
        }
        const res = await fetch(
          apiUrl(`/api/v1/review/upload?kb_name=${encodeURIComponent(selectedKb)}`),
          {
            method: "POST",
            body: formData,
          },
        );
        if (!res.ok) {
          throw new Error(`upload failed: ${res.status}`);
        }
        await loadNotebooks();
      } catch (error) {
        console.error("Failed to upload review files:", error);
      } finally {
        setUploading(false);
      }
    },
    [selectedKb, loadNotebooks],
  );

  const handleExitSummary = useCallback(async () => {
    if (reviewEntryIds.length > 0) {
      try {
        await fetch(apiUrl("/api/v1/review/mark_mastered"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_ids: reviewEntryIds, mastered: true }),
        });
      } catch (error) {
        console.error("Failed to mark entries mastered:", error);
      }
    }
    resetGuideSession();
    setSelectedRecords(new Map());
    setReviewEntryIds([]);
  }, [reviewEntryIds, resetGuideSession]);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - dragStartXRef.current;
      if (dragging === "left") {
        setLeftPaneWidth(clampSidebarWidth(dragStartLeftRef.current + deltaX));
        return;
      }
      setRightPaneWidth(clampSidebarWidth(dragStartRightRef.current - deltaX));
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  const startDrag = (side: "left" | "right", event: ReactMouseEvent<HTMLDivElement>) => {
    dragStartXRef.current = event.clientX;
    dragStartLeftRef.current = leftPaneWidth;
    dragStartRightRef.current = rightPaneWidth;
    setDragging(side);
  };

  return (
    <div className="tp-page">
      <div
        className="grid h-full min-h-0 gap-2"
        style={{
          gridTemplateColumns: `${leftPaneWidth}px 10px minmax(0,1fr) 10px ${rightPaneWidth}px`,
        }}
      >
        <div className="flex min-h-0 flex-col gap-4">
          <Panel title={t("Review Source")} bodyClassName="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
                {t("Knowledge Base (Optional)")}
              </label>
              <select
                value={selectedKb}
                onChange={(event) => setSelectedKb(event.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm"
                disabled={loadingKnowledgeBases}
              >
                <option value="">{t("Select Knowledge Base")}</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.name} value={kb.name}>
                    {kb.name}
                  </option>
                ))}
              </select>
              {kbHint ? (
                <p className="mt-1 text-xs text-amber-600">{kbHint}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("topic")}
                className={`rounded-lg border px-2 py-1.5 text-xs ${
                  mode === "topic"
                    ? "border-[hsl(var(--brand))] bg-[hsl(var(--brand-soft))]"
                    : "border-[hsl(var(--panel-border))]"
                }`}
              >
                {t("Topic Mode")}
              </button>
              <button
                type="button"
                onClick={() => setMode("curriculum")}
                className={`rounded-lg border px-2 py-1.5 text-xs ${
                  mode === "curriculum"
                    ? "border-[hsl(var(--brand))] bg-[hsl(var(--brand-soft))]"
                    : "border-[hsl(var(--panel-border))]"
                }`}
              >
                {t("Curriculum Mode")}
              </button>
            </div>

            {mode === "topic" ? (
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder={t("Optional topic (auto-filled from selected records if empty)")}
                className="w-full rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm"
              />
            ) : null}

            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm hover:bg-[hsl(var(--panel-muted))]">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {uploading ? t("Uploading...") : t("Upload Notes")}
              <input
                type="file"
                accept=".md,.markdown,.txt,.pdf,.docx"
                multiple
                className="hidden"
                disabled={uploading || !selectedKb}
                onChange={(event) => {
                  handleUpload(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {!selectedKb ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("Upload to KB notebook requires selecting a knowledge base.")}
              </p>
            ) : null}
          </Panel>

          <NotebookSelector
            notebooks={notebooks}
            expandedNotebooks={expandedNotebooks}
            notebookRecordsMap={notebookRecordsMap}
            selectedRecords={selectedRecords}
            loadingNotebooks={loadingNotebooks}
            loadingRecordsFor={loadingRecordsFor}
            isLoading={isLoading}
            onToggleExpanded={toggleExpanded}
            onToggleRecord={toggleRecord}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onClearAll={clearAll}
            onCreateSession={handleCreateSession}
          />
          {createSessionError ? (
            <p className="mt-1 px-1 text-xs text-red-500">{createSessionError}</p>
          ) : null}

          <Panel bodyClassName="p-3">
            <Link
              href="/notebook"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2.5 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
            >
              <BookOpen className="h-4 w-4" />
              {t("Open My Notebooks")}
            </Link>
          </Panel>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          className="group flex h-full cursor-col-resize items-center justify-center"
          onMouseDown={(event) => startDrag("left", event)}
        >
          <div className="h-16 w-1 rounded-full bg-[hsl(var(--panel-border))] transition-colors group-hover:bg-[hsl(var(--brand))]" />
        </div>

        <div className="flex min-h-0 w-full">
          {isCompleted ? (
            <CompletionSummary
              summary={sessionState.summary}
              sourceLabel={sessionState.source_label || sessionState.kb_name}
              onExit={handleExitSummary}
            />
          ) : !sessionState.current_html && !isLoading ? (
            <div className="flex h-full min-h-[320px] w-full flex-col items-center justify-center rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-8 text-center">
              <h3 className="text-2xl font-semibold text-[hsl(var(--foreground))]">
                {t("Hi! 今天想要复习些什么呢？")}
              </h3>
              <p className="mt-3 max-w-md text-sm text-[hsl(var(--muted-foreground))]">
                {t("Pick records on the left, then start a focused error review session with guided steps.")}
              </p>
            </div>
          ) : (
            <HTMLViewer
              html={sessionState.current_html}
              currentIndex={sessionState.current_index}
              loadingMessage={loadingMessage || t("Waiting for learning content...")}
              onOpenDebugModal={() => setShowDebugModal(true)}
            />
          )}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          className="group flex h-full cursor-col-resize items-center justify-center"
          onMouseDown={(event) => startDrag("right", event)}
        >
          <div className="h-16 w-1 rounded-full bg-[hsl(var(--panel-border))] transition-colors group-hover:bg-[hsl(var(--brand))]" />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <ProgressPanel
            sessionState={sessionState}
            isLoading={isLoading}
            canStart={canStart}
            canNext={canNext}
            canPrevious={canPrevious}
            isLastKnowledge={isLastKnowledge}
            onStartLearning={startLearning}
            onNextKnowledge={nextKnowledge}
            onPreviousKnowledge={previousKnowledge}
          />
          <ChatPanel
            messages={chatMessages}
            isLearning={sessionState.status === "learning"}
            onSendMessage={sendMessage}
          />
        </div>
      </div>

      <DebugModal
        isOpen={showDebugModal}
        onClose={() => setShowDebugModal(false)}
        onFix={fixHtml}
      />
    </div>
  );
}
