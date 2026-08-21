"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, History, Loader2, Save, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import TeacherChat, {
  type TeacherMessage,
} from "@/components/teacher/TeacherChat";
import StepDisplay from "@/components/teacher/StepDisplay";
import SocraticPrompt from "@/components/teacher/SocraticPrompt";
import { Composer, PageHeader, Panel } from "@/components/ui";
import { useGlobal } from "@/context/GlobalContext";
import { apiUrl } from "@/lib/api";
import type {
  Subject,
  SubjectKnowledgeBase,
  TeacherPageMode,
  TeacherResponse,
  TeacherSessionDetail,
  TeacherSessionState,
  TeacherSessionSummary,
} from "@/types/subject";
import { useTranslation } from "react-i18next";

function getTeacherMode(searchParams: { get: (key: string) => string | null }): TeacherPageMode {
  return searchParams.get("mode") === "solve-first"
    ? "solve-first"
    : "explain-first";
}

function getSessionMessages(detail: TeacherSessionDetail): TeacherMessage[] {
  return detail.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function TeacherPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentSubject, setSubject } = useGlobal();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSubject, setSessionSubject] = useState<Subject | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<SubjectKnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState("");
  const [teacherSessions, setTeacherSessions] = useState<TeacherSessionSummary[]>([]);
  const [teacherState, setTeacherState] = useState<TeacherSessionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isSavingNotebook, setIsSavingNotebook] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const mode = useMemo(
    () => getTeacherMode(searchParams),
    [searchParams],
  );
  const requestedSessionId = searchParams.get("session_id");
  const requestedSubject = searchParams.get("subject");

  const syncRoute = useCallback(
    (nextSessionId: string | null, nextMode: TeacherPageMode, nextSubject: Subject) => {
      const params = new URLSearchParams();
      params.set("mode", nextMode);
      params.set("subject", nextSubject);
      if (nextSessionId) {
        params.set("session_id", nextSessionId);
      }
      router.replace(`/teacher?${params.toString()}`);
    },
    [router],
  );

  const loadTeacherSessions = useCallback(async () => {
    const response = await fetch(
      apiUrl(`/api/v1/teacher/sessions?subject=${currentSubject}&limit=20`),
    );
    if (!response.ok) {
      throw new Error(`Teacher sessions request failed: ${response.status}`);
    }
    const data = (await response.json()) as TeacherSessionSummary[];
    setTeacherSessions(Array.isArray(data) ? data : []);
  }, [currentSubject]);

  const loadKnowledgeBases = useCallback(async () => {
    const response = await fetch(
      apiUrl(`/api/v1/teacher/knowledge-bases?subject=${currentSubject}`),
    );
    if (!response.ok) {
      throw new Error(`Teacher knowledge base request failed: ${response.status}`);
    }
    const data = await response.json();
    const items = (data.knowledge_bases || []) as SubjectKnowledgeBase[];
    setKnowledgeBases(items);
    setSelectedKb((previous) => {
      if (previous && items.some((item) => item.name === previous)) {
        return previous;
      }
      return data.default_kb || items[0]?.name || "";
    });
  }, [currentSubject]);

  const hydrateSession = useCallback(
    (detail: TeacherSessionDetail) => {
      setSessionId(detail.session_id);
      setSessionSubject(detail.subject);
      setMessages(getSessionMessages(detail));
      setTeacherState(detail.teacher_state);
      setSelectedKb(detail.kb_name || "");
      if (detail.subject !== currentSubject) {
        setSubject(detail.subject);
      }
    },
    [currentSubject, setSubject],
  );

  const loadTeacherSession = useCallback(
    async (targetSessionId: string) => {
      setIsLoadingSession(true);
      try {
        const response = await fetch(apiUrl(`/api/v1/teacher/sessions/${targetSessionId}`));
        if (!response.ok) {
          throw new Error(`Teacher session request failed: ${response.status}`);
        }
        const detail = (await response.json()) as TeacherSessionDetail;
        hydrateSession(detail);
      } finally {
        setIsLoadingSession(false);
      }
    },
    [hydrateSession],
  );

  useEffect(() => {
    if (
      requestedSubject &&
      requestedSubject !== currentSubject &&
      ["liberal_arts", "science", "engineering"].includes(requestedSubject)
    ) {
      setSubject(requestedSubject as Subject);
    }
  }, [requestedSubject, currentSubject, setSubject]);

  useEffect(() => {
    loadKnowledgeBases().catch((error) => {
      console.error("Failed to load teacher knowledge bases:", error);
      setKnowledgeBases([]);
      setSelectedKb("");
    });
    loadTeacherSessions().catch((error) => {
      console.error("Failed to load teacher sessions:", error);
      setTeacherSessions([]);
    });
  }, [currentSubject, loadKnowledgeBases, loadTeacherSessions]);

  useEffect(() => {
    if (!requestedSessionId) {
      setSessionId(null);
      setSessionSubject(null);
      setMessages([]);
      setTeacherState(null);
      return;
    }
    loadTeacherSession(requestedSessionId).catch((error) => {
      console.error("Failed to restore teacher session:", error);
      setSessionId(null);
      setSessionSubject(null);
      setMessages([]);
      setTeacherState(null);
      syncRoute(null, mode, currentSubject);
    });
  }, [requestedSessionId, loadTeacherSession, syncRoute, mode, currentSubject]);

  useEffect(() => {
    if (requestedSessionId) {
      return;
    }
    setSessionId(null);
    setSessionSubject(null);
    setMessages([]);
    setTeacherState(null);
  }, [currentSubject, mode, requestedSessionId]);

  const modeTitle = useMemo(
    () =>
      mode === "solve-first" ? t("Teacher Solve Mode") : t("Teacher Teach Mode"),
    [mode, t],
  );

  const modeDescription = useMemo(
    () =>
      mode === "solve-first"
        ? t(
            "Use Teacher to break a problem into steps, explain each move, and leave a checking question at the end.",
          )
        : t(
            "Use Teacher to explain a concept progressively, grounded in the selected subject knowledge base.",
          ),
    [mode, t],
  );

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((previous) => [...previous, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const endpoint =
        mode === "solve-first" ? "/api/v1/teacher/solve" : "/api/v1/teacher/chat";
      const payload =
        mode === "solve-first"
          ? {
              subject: currentSubject,
              kb_name: selectedKb || undefined,
              session_id: sessionId || undefined,
              question: userMessage,
            }
          : {
              subject: currentSubject,
              kb_name: selectedKb || undefined,
              session_id: sessionId || undefined,
              message: userMessage,
            };

      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Teacher request failed: ${response.status}`);
      }

      const data = (await response.json()) as TeacherResponse;
      setSessionId(data.session_id);
      setSessionSubject(data.subject);
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: data.response },
      ]);
      setTeacherState(data.teacher_state);
      if (!requestedSessionId || requestedSessionId !== data.session_id) {
        syncRoute(data.session_id, mode, data.subject);
      }
      await loadTeacherSessions();
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `Teacher could not complete this turn.\n\n${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenSession = (summary: TeacherSessionSummary) => {
    syncRoute(summary.session_id, summary.preferred_mode, summary.subject);
  };

  const handleDeleteSession = async (targetSessionId: string) => {
    if (!confirm(t("Are you sure you want to delete this teacher session?"))) {
      return;
    }
    setDeletingSessionId(targetSessionId);
    try {
      const response = await fetch(apiUrl(`/api/v1/teacher/sessions/${targetSessionId}`), {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Teacher delete failed: ${response.status}`);
      }
      if (sessionId === targetSessionId) {
        setSessionId(null);
        setSessionSubject(null);
        setMessages([]);
        setTeacherState(null);
        syncRoute(null, mode, currentSubject);
      }
      await loadTeacherSessions();
    } catch (error) {
      console.error("Failed to delete teacher session:", error);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const activeStepPlan = teacherState?.step_plan || [];
  const socraticQuestions = teacherState?.socratic_questions || [];

  useEffect(() => {
    if (!saveFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setSaveFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [saveFeedback]);

  const saveTeacherSessionToNotebook = async () => {
    if (!selectedKb || messages.length === 0) {
      return;
    }
    setIsSavingNotebook(true);
    try {
      const firstUserMessage = messages.find((message) => message.role === "user");
      const titleBase = firstUserMessage?.content || t("Teacher Session");
      const title =
        mode === "solve-first"
          ? `${t("Teacher Solve")}: ${titleBase.slice(0, 48)}`
          : `${t("Teacher Explain")}: ${titleBase.slice(0, 48)}`;
      const userQuery = messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n\n");
      const output = messages
        .map((message) =>
          message.role === "user"
            ? `### User\n\n${message.content}`
            : `### Teacher\n\n${message.content}`,
        )
        .join("\n\n---\n\n");

      const response = await fetch(
        apiUrl(`/api/v1/knowledge/${selectedKb}/notebook/records`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            record_type: mode === "solve-first" ? "solve" : "chat",
            title,
            user_query: userQuery,
            output,
            module: "teacher",
            session_id: sessionId || "teacher-session",
            message_count: messages.length,
            metadata: {
              preferred_mode: mode,
              subject: currentSubject,
              teacher_state: teacherState,
            },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        console.error("Teacher notebook save failed:", data);
        throw new Error(t("Failed to save teacher notebook record"));
      }
      setSaveFeedback({
        type: data.created ? "success" : "info",
        message: data.created
          ? t("Saved to the current knowledge notebook")
          : t("This session state is already saved"),
      });
    } catch (error) {
      console.error("Failed to save teacher notebook record:", error);
      setSaveFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : t("Failed to save teacher notebook record"),
      });
    } finally {
      setIsSavingNotebook(false);
    }
  };

  return (
    <div className="tp-page animate-fade-in">
      <PageHeader
        eyebrow={t("Teacher")}
        title={modeTitle}
        description={modeDescription}
        actions={
          messages.length > 0 && selectedKb ? (
            <button
              type="button"
              onClick={saveTeacherSessionToNotebook}
              disabled={isSavingNotebook}
              className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--brand-strong))] px-4 py-2 text-sm font-medium text-white shadow-[0_18px_36px_-28px_hsl(var(--brand-strong)/0.82)] transition-colors hover:bg-[hsl(var(--brand-pressed))] disabled:opacity-60"
            >
              {isSavingNotebook ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("Save to Knowledge Notebook")}
            </button>
          ) : null
        }
      />

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.18fr)_360px]">
        <Panel
          className="min-h-0 overflow-hidden"
          bodyClassName="flex h-full min-h-0 flex-col overflow-hidden"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <GraduationCap className="mb-5 h-16 w-16 text-[hsl(var(--brand-soft))]" />
              <h3 className="text-xl font-semibold text-[hsl(var(--foreground))]">
                {modeTitle}
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-[hsl(var(--muted-foreground))]">
                {modeDescription}
              </p>
            </div>
          ) : (
            <TeacherChat
              messages={messages}
              isLoading={isLoading || isLoadingSession}
              loadingLabel={
                isLoadingSession ? t("Restoring teacher session...") : t("Teacher is thinking...")
              }
            />
          )}

          <div className="border-t border-[hsl(var(--panel-border))] p-4">
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={sendMessage}
              multiline
              loading={isLoading}
              placeholder={t("Ask Teacher to explain or solve...")}
              helperText={t(
                "Enter sends the request. Shift+Enter adds a new line.",
              )}
              context={
                <div className="flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                  <span>
                    {t("Current Subject")}:{" "}
                    {t(
                      currentSubject === "liberal_arts"
                        ? "Liberal Arts"
                        : currentSubject === "science"
                          ? "Science"
                          : "Engineering",
                    )}
                  </span>
                  <span>
                    {t("Mode")}: {modeTitle}
                  </span>
                  {teacherState ? (
                    <span>
                      {t("Current Step")}: {teacherState.current_step || 0}
                    </span>
                  ) : null}
                  {teacherState?.awaiting_student_response ? (
                    <span>{t("Teacher is waiting for your answer.")}</span>
                  ) : null}
                </div>
              }
            />
          </div>
        </Panel>

        <div className="flex min-h-0 flex-col gap-5">
          <Panel
            title={t("Recent Teacher Sessions")}
            bodyClassName="flex max-h-[240px] flex-col gap-3 overflow-y-auto p-4"
          >
            {teacherSessions.length ? (
              teacherSessions.map((summary) => (
                <div
                  key={summary.session_id}
                  onClick={() => handleOpenSession(summary)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpenSession(summary);
                    }
                  }}
                  className={`rounded-[22px] border px-4 py-3 text-left transition ${
                    sessionId === summary.session_id
                      ? "border-[hsl(var(--brand-soft))] bg-[hsl(var(--brand-soft))/0.14]"
                      : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.84] hover:bg-[hsl(var(--panel))/0.95]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <History className="mt-0.5 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                        {summary.title}
                      </div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                        {summary.message_count} {t("messages")}
                        {summary.kb_name ? ` · ${summary.kb_name}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteSession(summary.session_id);
                      }}
                      disabled={deletingSessionId === summary.session_id}
                      className="rounded-full p-2 text-[hsl(var(--muted-foreground))] transition hover:text-red-500 disabled:opacity-50"
                      aria-label={t("Delete")}
                    >
                      {deletingSessionId === summary.session_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("No teacher sessions for this subject yet.")}
              </p>
            )}
          </Panel>

          <Panel
            title={t("Subject Knowledge Base")}
            bodyClassName="flex flex-col gap-3 p-4"
          >
            <select
              value={selectedKb}
              onChange={(event) => setSelectedKb(event.target.value)}
              className="rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] px-3 py-3 text-sm text-[hsl(var(--foreground))]"
            >
              {knowledgeBases.map((knowledgeBase) => (
                <option key={knowledgeBase.name} value={knowledgeBase.name}>
                  {knowledgeBase.name}
                  {knowledgeBase.is_default ? ` · ${t("Default")}` : ""}
                </option>
              ))}
            </select>
            {!knowledgeBases.length ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("No subject knowledge base is linked yet.")}
              </p>
            ) : null}
            {sessionSubject && sessionSubject !== currentSubject ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t("The loaded session was created under a different subject tab.")}
              </p>
            ) : null}
          </Panel>

          <Panel title={t("Step Plan")} bodyClassName="p-4">
            <StepDisplay
              steps={activeStepPlan}
              currentStep={teacherState?.current_step || 0}
              emptyLabel={t("No step plan yet.")}
            />
          </Panel>

          <SocraticPrompt
            prompts={socraticQuestions}
            title={t("Socratic Check")}
            emptyLabel={t("Teacher will add a checking question after the next turn.")}
          />
        </div>
      </div>

      {saveFeedback ? (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${
              saveFeedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                : saveFeedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-300"
                  : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            {saveFeedback.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TeacherPage() {
  return (
    <Suspense
      fallback={<div className="tp-page animate-fade-in" aria-busy="true" />}
    >
      <TeacherPageContent />
    </Suspense>
  );
}
