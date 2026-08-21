import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "@/lib/api";
import {
  SessionState,
  ChatMessage,
  KnowledgePoint,
  GuideMode,
  INITIAL_SESSION_STATE,
} from "../types";
import {
  loadFromStorage,
  saveToStorage,
  persistState,
  mergeWithDefaults,
  STORAGE_KEYS,
  removeFromStorage,
} from "@/lib/persistence";
import { debounce } from "@/lib/debounce";

// Storage key for guide chat messages
const GUIDE_CHAT_KEY = "guide_chat_messages";

// Fields to exclude from guide session persistence
const GUIDE_SESSION_EXCLUDE: (keyof SessionState)[] = [];

/**
 * Hook for managing guide session state and API interactions
 */
export function useGuideSession() {
  const { t } = useTranslation();
  // Track hydration to avoid SSR mismatch
  const isHydrated = useRef(false);

  // Initialize with defaults (same on server and client)
  const [sessionState, setSessionState] = useState<SessionState>(
    INITIAL_SESSION_STATE,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Debounced save functions
  const saveSessionState = useMemo(
    () =>
      debounce((state: SessionState) => {
        if (
          state.status === "idle" &&
          !state.session_id &&
          state.knowledge_points.length === 0 &&
          !state.summary &&
          !state.current_html
        ) {
          removeFromStorage(STORAGE_KEYS.GUIDE_SESSION);
          return;
        }
        const toSave = persistState(state, GUIDE_SESSION_EXCLUDE);
        saveToStorage(STORAGE_KEYS.GUIDE_SESSION, toSave);
      }, 500),
    [],
  );

  const saveChatMessages = useMemo(
    () =>
      debounce((messages: ChatMessage[]) => {
        if (messages.length === 0) {
          removeFromStorage(GUIDE_CHAT_KEY);
          return;
        }
        saveToStorage(GUIDE_CHAT_KEY, messages);
      }, 500),
    [],
  );

  // Restore persisted state after hydration
  useEffect(() => {
    if (typeof window === "undefined") return;

    const persistedSession = loadFromStorage<Partial<SessionState>>(
      STORAGE_KEYS.GUIDE_SESSION,
      {},
    );
    const persistedChat = loadFromStorage<ChatMessage[]>(GUIDE_CHAT_KEY, []);

    if (Object.keys(persistedSession).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration restore from local storage
      setSessionState((prev) =>
        mergeWithDefaults(persistedSession, prev, GUIDE_SESSION_EXCLUDE),
      );
    }

    if (persistedChat.length > 0) {
      setChatMessages(persistedChat);
    }

    isHydrated.current = true;
  }, []);

  // Auto-save session state (only after hydration)
  useEffect(() => {
    if (isHydrated.current) {
      saveSessionState(sessionState);
    }
  }, [sessionState, saveSessionState]);

  // Auto-save chat messages (only after hydration)
  useEffect(() => {
    if (isHydrated.current) {
      saveChatMessages(chatMessages);
    }
  }, [chatMessages, saveChatMessages]);

  const addLoadingMessage = useCallback((message: string) => {
    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: "system",
      content: `⏳ ${message}`,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, loadingMsg]);
    return loadingMsg.id;
  }, []);

  const removeLoadingMessage = useCallback((id: string) => {
    setChatMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const addChatMessage = useCallback(
    (role: "user" | "assistant" | "system", content: string, id?: string) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: id || `${role}-${Date.now()}`,
          role,
          content,
          timestamp: Date.now(),
        },
      ]);
    },
    [],
  );

  const addGroundingWarning = useCallback(
    (warning: unknown, prefix: string) => {
      if (typeof warning !== "string" || !warning.trim()) {
        return;
      }
      addChatMessage("system", `⚠️ ${warning.trim()}`, `${prefix}-${Date.now()}`);
    },
    [addChatMessage],
  );

  const getErrorMessage = useCallback((payload: unknown, fallback: string) => {
    if (
      payload &&
      typeof payload === "object" &&
      "detail" in payload &&
      payload.detail &&
      typeof payload.detail === "object" &&
      "message" in payload.detail &&
      typeof payload.detail.message === "string"
    ) {
      return payload.detail.message;
    }

    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return payload.message;
    }

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }

    return fallback;
  }, []);

  const createSession = useCallback(
    async ({
      kbName,
      mode,
      topic,
      reviewNotes,
      sourceLabel,
      sessionKind,
    }: {
      kbName?: string;
      mode: GuideMode;
      topic?: string;
      reviewNotes?: string;
      sourceLabel?: string;
      sessionKind?: "guide" | "review";
    }) => {
      const normalizedKbName = (kbName || "").trim();
      const isReviewNoKb = sessionKind === "review" && !normalizedKbName;
      if (sessionKind !== "review" && !normalizedKbName) return;
      if (mode === "topic" && !topic?.trim()) return;

      const createLoadingMessage = isReviewNoKb
        ? t("Analyzing notebook notes and generating learning plan...")
        : t("Analyzing knowledge base and generating learning plan...");

      setIsLoading(true);
      setLoadingMessage(createLoadingMessage);
      const loadingId = addLoadingMessage(
        createLoadingMessage,
      );

      try {
        const endpoint =
          sessionKind === "review"
            ? "/api/v1/review/create_session"
            : "/api/v1/guide/create_session";

        const res = await fetch(apiUrl(endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            sessionKind === "review"
              ? {
                  kb_name: normalizedKbName || undefined,
                  mode,
                  topic: mode === "topic" ? topic?.trim() : undefined,
                  review_notes: reviewNotes,
                  source_label: sourceLabel,
                }
              : {
                  kb_name: normalizedKbName || undefined,
                  mode,
                  topic: mode === "topic" ? topic?.trim() : undefined,
                  source_notes: reviewNotes,
                  source_label: sourceLabel,
                },
          ),
        });
        const data = await res.json();

        removeLoadingMessage(loadingId);
        setIsLoading(false);
        setLoadingMessage("");

        if (res.ok && data.success) {
          const resolvedKbLabel =
            data.kb_name || normalizedKbName || sourceLabel || t("Notebook Review");

          setSessionState({
            session_id: data.session_id,
            kb_name: data.kb_name || normalizedKbName || t("Notebook Review"),
            mode: data.mode || mode,
            topic: data.topic || topic?.trim() || "",
            source_label:
              data.source_label || data.kb_name || normalizedKbName || sourceLabel || t("Notebook Review"),
            knowledge_points: data.knowledge_points || [],
            current_index: -1,
            current_html: "",
            status: "initialized",
            progress: 0,
            summary: "",
          });

          const sourceMode =
            (data.mode || mode) === "curriculum"
              ? t("full knowledge-base curriculum")
              : t('topic "{topic}"', {
                  topic: data.topic || topic?.trim() || "",
                });
          const planMessage = `${t(
            "📚 Learning plan generated from **{kb}** ({mode}) with **{count}** knowledge points:",
            {
              kb: resolvedKbLabel,
              mode: sourceMode,
              count: data.total_points,
            },
          )}\n\n${data.knowledge_points
            .map(
              (kp: KnowledgePoint, idx: number) =>
                `${idx + 1}. ${kp.knowledge_title}`,
            )
            .join("\n")}\n\n${t('Click "Start Learning" above to begin.')}`;
          setChatMessages([
            {
              id: "plan",
              role: "system",
              content: planMessage,
              timestamp: Date.now(),
            },
          ]);
          addGroundingWarning(data.grounding_warning, "grounding-plan");
        } else {
          addChatMessage(
            "system",
            `❌ ${t("Failed to create session")}: ${getErrorMessage(
              data,
              t("Unknown error"),
            )}`,
            `error-${Date.now()}`,
          );
        }
      } catch (err) {
        removeLoadingMessage(loadingId);
        setIsLoading(false);
        setLoadingMessage("");
        console.error("Failed to create session:", err);
        addChatMessage(
          "system",
          t("❌ Failed to create session, please try again later"),
          `error-${Date.now()}`,
        );
      }
    },
    [
      addLoadingMessage,
      removeLoadingMessage,
      addChatMessage,
      addGroundingWarning,
      getErrorMessage,
      t,
    ],
  );

  const startLearning = useCallback(async () => {
    if (!sessionState.session_id) return;

    setIsLoading(true);
    setLoadingMessage(t("Generating interactive learning page..."));
    const loadingId = addLoadingMessage(
      t("Generating interactive learning page..."),
    );

    try {
      const res = await fetch(apiUrl("/api/v1/guide/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionState.session_id }),
      });
      const data = await res.json();

      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");

      if (data.success) {
        const htmlContent = data.html || "";
        console.log("Start learning - HTML length:", htmlContent.length);

        setSessionState((prev) => ({
          ...prev,
          current_index: data.current_index,
          current_html: htmlContent,
          status: "learning",
          progress: data.progress || 0,
          source_label: data.source_label || prev.source_label,
        }));

        addChatMessage(
          "system",
          data.message || t("Starting the first knowledge point"),
          `start-${Date.now()}`,
        );
        addGroundingWarning(data.grounding_warning, "grounding-start");
      } else {
        addChatMessage(
          "system",
          `❌ ${t("Failed to start learning")}: ${data.error || t("Unknown error")}`,
          `error-${Date.now()}`,
        );
      }
    } catch (err) {
      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");
      console.error("Failed to start learning:", err);
      addChatMessage(
        "system",
        t("❌ Failed to start learning, please try again later"),
        `error-${Date.now()}`,
      );
    }
  }, [
    sessionState.session_id,
    addLoadingMessage,
    removeLoadingMessage,
    addChatMessage,
    addGroundingWarning,
    t,
  ]);

  const nextKnowledge = useCallback(async () => {
    if (!sessionState.session_id) return;

    setIsLoading(true);
    setLoadingMessage(t("Generating next knowledge point..."));
    const loadingId = addLoadingMessage(t("Generating next knowledge point..."));

    try {
      const res = await fetch(apiUrl("/api/v1/guide/next"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionState.session_id }),
      });
      const data = await res.json();

      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");

      if (data.success) {
        if (data.status === "completed") {
          setSessionState((prev) => ({
            ...prev,
            status: "completed",
            summary: data.summary || "",
            progress: 100,
            source_label: data.source_label || prev.source_label,
          }));

          addChatMessage(
            "system",
            data.message ||
              t("🎉 Congratulations on completing all knowledge points!"),
            `complete-${Date.now()}`,
          );
        } else {
          setSessionState((prev) => ({
            ...prev,
            current_index: data.current_index,
            current_html: data.html || "",
            progress: data.progress || 0,
            source_label: data.source_label || prev.source_label,
          }));

          addChatMessage(
            "system",
            data.message || t("Moving to next knowledge point"),
            `next-${Date.now()}`,
          );
          addGroundingWarning(data.grounding_warning, "grounding-next");
        }
      } else {
        addChatMessage(
          "system",
          `❌ ${t("Failed to move to next")}: ${data.error || t("Unknown error")}`,
          `error-${Date.now()}`,
        );
      }
    } catch (err) {
      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");
      console.error("Failed to move to next:", err);
      addChatMessage(
        "system",
        t("❌ Failed to move to next, please try again later"),
        `error-${Date.now()}`,
      );
    }
  }, [
    sessionState.session_id,
    addLoadingMessage,
    removeLoadingMessage,
    addChatMessage,
    addGroundingWarning,
    t,
  ]);

  const previousKnowledge = useCallback(async () => {
    if (!sessionState.session_id) return;

    setIsLoading(true);
    setLoadingMessage(t("Generating previous knowledge point..."));
    const loadingId = addLoadingMessage(t("Generating previous knowledge point..."));

    try {
      const res = await fetch(apiUrl("/api/v1/guide/previous"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionState.session_id }),
      });
      const data = await res.json();

      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");

      if (data.success) {
        setSessionState((prev) => ({
          ...prev,
          status: "learning",
          current_index: data.current_index,
          current_html: data.html || "",
          progress: data.progress || 0,
          source_label: data.source_label || prev.source_label,
        }));

        addChatMessage(
          "system",
          data.message || t("Moving to previous knowledge point"),
          `prev-${Date.now()}`,
        );
        addGroundingWarning(data.grounding_warning, "grounding-prev");
      } else {
        addChatMessage(
          "system",
          `❌ ${t("Failed to move to previous")}: ${data.error || t("Unknown error")}`,
          `error-${Date.now()}`,
        );
      }
    } catch (err) {
      removeLoadingMessage(loadingId);
      setIsLoading(false);
      setLoadingMessage("");
      console.error("Failed to move to previous:", err);
      addChatMessage(
        "system",
        t("❌ Failed to move to previous, please try again later"),
        `error-${Date.now()}`,
      );
    }
  }, [
    sessionState.session_id,
    addLoadingMessage,
    removeLoadingMessage,
    addChatMessage,
    addGroundingWarning,
    t,
  ]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || !sessionState.session_id) return;

      addChatMessage("user", message, `user-${Date.now()}`);
      const loadingId = addLoadingMessage(t("Thinking..."));

      try {
        const res = await fetch(apiUrl("/api/v1/guide/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionState.session_id,
            message,
          }),
        });
        const data = await res.json();

        removeLoadingMessage(loadingId);

        if (data.success) {
          addChatMessage(
            "assistant",
            data.answer || "",
            `assistant-${Date.now()}`,
          );
          addGroundingWarning(data.grounding_warning, "grounding-chat");
        } else {
          addChatMessage(
            "assistant",
            `❌ ${t("Error")}: ${data.error || t("Failed to respond")}`,
            `error-${Date.now()}`,
          );
        }
      } catch (err) {
        removeLoadingMessage(loadingId);
        console.error("Failed to send message:", err);
        addChatMessage(
          "assistant",
          t("❌ Failed to send message, please try again later"),
          `error-${Date.now()}`,
        );
      }
    },
    [
      sessionState.session_id,
      addLoadingMessage,
      removeLoadingMessage,
      addChatMessage,
      addGroundingWarning,
      t,
    ],
  );

  const resetGuideSession = useCallback(() => {
    saveSessionState.cancel();
    saveChatMessages.cancel();
    removeFromStorage(STORAGE_KEYS.GUIDE_SESSION);
    removeFromStorage(GUIDE_CHAT_KEY);
    setIsLoading(false);
    setLoadingMessage("");
    setSessionState(INITIAL_SESSION_STATE);
    setChatMessages([]);
  }, [saveChatMessages, saveSessionState]);

  const fixHtml = useCallback(
    async (bugDescription: string) => {
      if (!sessionState.session_id || !bugDescription.trim()) return false;

      const loadingId = addLoadingMessage(t("Fixing HTML page..."));

      try {
        const res = await fetch(apiUrl("/api/v1/guide/fix_html"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionState.session_id,
            bug_description: bugDescription,
          }),
        });
        const data = await res.json();

        removeLoadingMessage(loadingId);

        if (data.success) {
          setSessionState((prev) => ({
            ...prev,
            current_html: data.html || prev.current_html,
          }));
          addChatMessage(
            "system",
            t("✅ HTML page has been fixed!"),
            `fix-${Date.now()}`,
          );
          return true;
        } else {
          addChatMessage(
            "system",
            `❌ ${t("Fix failed")}: ${data.error || t("Unknown error")}`,
            `error-${Date.now()}`,
          );
          return false;
        }
      } catch (err) {
        removeLoadingMessage(loadingId);
        console.error("Failed to fix HTML:", err);
        addChatMessage(
          "system",
          t("❌ Fix failed, please try again later"),
          `error-${Date.now()}`,
        );
        return false;
      }
    },
    [
      sessionState.session_id,
      addLoadingMessage,
      removeLoadingMessage,
      addChatMessage,
      t,
    ],
  );

  // Computed states
  const canStart =
    sessionState.status === "initialized" &&
    sessionState.knowledge_points.length > 0;
  const canNext =
    sessionState.status === "learning" &&
    sessionState.current_index < sessionState.knowledge_points.length - 1;
  const canPrevious =
    (sessionState.status === "learning" && sessionState.current_index > 0) ||
    (sessionState.status === "completed" && sessionState.knowledge_points.length > 0);
  const isCompleted = sessionState.status === "completed";
  const isLastKnowledge =
    sessionState.status === "learning" &&
    sessionState.current_index === sessionState.knowledge_points.length - 1;

  return {
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
  };
}
