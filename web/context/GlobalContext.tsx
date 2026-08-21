"use client";

import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { wsUrl, apiUrl } from "@/lib/api";
import {
  initializeTheme,
  setTheme,
  getStoredTheme,
  type Theme,
} from "@/lib/theme";
import {
  loadFromStorage,
  saveToStorage,
  persistState,
  mergeWithDefaults,
  STORAGE_KEYS,
  EXCLUDE_FIELDS,
} from "@/lib/persistence";
import { debounce } from "@/lib/debounce";
import { DEFAULT_SUBJECT, type Subject } from "@/types/subject";

// Language storage key
const LANGUAGE_STORAGE_KEY = "thinkpilot-language";

// --- Types ---
interface LogEntry {
  type: string;
  content: string;
  timestamp?: number;
  level?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  outputDir?: string;
  verificationPassed?: boolean;
  verificationConfidence?: number;
  groundingStrength?: "high" | "medium" | "low";
  usedWebFallback?: boolean;
}

// Agent Status
interface AgentStatus {
  [key: string]: "pending" | "running" | "done" | "error";
}

// Token Stats
interface TokenStats {
  model: string;
  calls: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

// Progress Info
interface ProgressInfo {
  stage: "investigate" | "solve" | "response" | null;
  progress: {
    round?: number;
    queries?: string[];
    step_index?: number;
    step_id?: string;
    step_target?: string;
  };
}

// Solver State
interface SolverState {
  sessionId: string | null;
  isSolving: boolean;
  logs: LogEntry[];
  messages: ChatMessage[];
  question: string;
  selectedKb: string;
  agentStatus: AgentStatus;
  tokenStats: TokenStats;
  progress: ProgressInfo;
}

// Chat Types
interface ChatSource {
  rag?: Array<{ kb_name: string; content: string }>;
  web?: Array<{ url: string; title?: string; snippet?: string }>;
}

interface HomeChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource;
  isStreaming?: boolean;
}

interface ChatState {
  sessionId: string | null;
  messages: HomeChatMessage[];
  isLoading: boolean;
  selectedKb: string;
  enableRag: boolean;
  enableWebSearch: boolean;
  currentStage: string | null;
}

// Sidebar Navigation Order Type
export interface SidebarNavOrder {
  start: string[]; // Array of href paths for START group
  learnResearch: string[]; // Array of href paths for LEARN & RESEARCH group
}

const HIDDEN_SIDEBAR_ROUTES = new Set(["/notebook"]);
const DEFAULT_SIDEBAR_DESCRIPTION = "✨ AI-Powered Learning Assistant";
const DEFAULT_SIDEBAR_NAV_ORDER: SidebarNavOrder = {
  start: ["/", "/knowledge"],
  learnResearch: ["/teacher", "/feynman", "/settings"],
};

function sanitizeSidebarNavOrder(
  order?: Partial<SidebarNavOrder> | null,
): SidebarNavOrder {
  const sanitizeList = (items: string[] | undefined, fallback: string[]) => {
    const next: string[] = [];
    const seen = new Set<string>();

    for (const item of items || fallback) {
      if (!item || HIDDEN_SIDEBAR_ROUTES.has(item) || seen.has(item)) {
        continue;
      }
      seen.add(item);
      next.push(item);
    }

    return next.length > 0 ? next : [...fallback];
  };

  return {
    start: sanitizeList(order?.start, DEFAULT_SIDEBAR_NAV_ORDER.start),
    learnResearch: sanitizeList(
      order?.learnResearch,
      DEFAULT_SIDEBAR_NAV_ORDER.learnResearch,
    ),
  };
}

interface GlobalContextType {
  currentSubject: Subject;
  setSubject: (subject: Subject) => void;

  // Solver
  solverState: SolverState;
  setSolverState: React.Dispatch<React.SetStateAction<SolverState>>;
  startSolver: (question: string, kb: string) => void;
  stopSolver: () => void;
  newSolverSession: () => void;
  loadSolverSession: (sessionId: string) => Promise<void>;

  // Chat
  chatState: ChatState;
  setChatState: React.Dispatch<React.SetStateAction<ChatState>>;
  sendChatMessage: (message: string) => void;
  clearChatHistory: () => void;
  loadChatSession: (sessionId: string) => Promise<void>;
  newChatSession: () => void;

  // UI Settings
  uiSettings: { theme: "light" | "dark"; language: "en" | "zh" };
  refreshSettings: () => Promise<void>;
  updateTheme: (theme: "light" | "dark") => Promise<void>;
  updateLanguage: (language: "en" | "zh") => Promise<void>;

  // Sidebar
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Sidebar Customization
  sidebarDescription: string;
  setSidebarDescription: (description: string) => Promise<void>;
  sidebarNavOrder: SidebarNavOrder;
  setSidebarNavOrder: (order: SidebarNavOrder) => Promise<void>;

  // Persistence utilities
  clearAllPersistence: () => void;
}

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

// --- Default State Constants ---
// These are used for both initialization and state restoration

const DEFAULT_SOLVER_STATE: SolverState = {
  sessionId: null,
  isSolving: false,
  logs: [],
  messages: [],
  question: "",
  selectedKb: "",
  agentStatus: {
    InvestigateAgent: "pending",
    NoteAgent: "pending",
    ManagerAgent: "pending",
    SolveAgent: "pending",
    ToolAgent: "pending",
    ResponseAgent: "pending",
    VerificationAgent: "pending",
    PrecisionAnswerAgent: "pending",
  },
  tokenStats: {
    model: "Unknown",
    calls: 0,
    tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost: 0.0,
  },
  progress: {
    stage: null,
    progress: {},
  },
};

const DEFAULT_CHAT_STATE: ChatState = {
  sessionId: null,
  messages: [],
  isLoading: false,
  selectedKb: "",
  enableRag: false,
  enableWebSearch: false,
  currentStage: null,
};

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  const [currentSubject, setCurrentSubjectState] =
    useState<Subject>(DEFAULT_SUBJECT);

  // --- UI Settings Logic ---
  const [uiSettings, setUiSettings] = useState<{
    theme: "light" | "dark";
    language: "en" | "zh";
  }>({ theme: "light", language: "en" });

  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const storedSubject = loadFromStorage<Subject>(
      STORAGE_KEYS.CURRENT_SUBJECT,
      DEFAULT_SUBJECT,
    );
    setCurrentSubjectState(storedSubject);
  }, []);

  const setSubject = (subject: Subject) => {
    setCurrentSubjectState(subject);
    saveToStorage(STORAGE_KEYS.CURRENT_SUBJECT, subject);
  };

  const refreshSettings = async () => {
    // Try to load from backend API first, fallback to localStorage
    try {
      const res = await fetch(apiUrl("/api/v1/settings"));
      if (res.ok) {
        const data = await res.json();
        const serverTheme = data.ui?.theme || "light";
        const serverLanguage = data.ui?.language || "en";
        setUiSettings({
          theme: serverTheme,
          language: serverLanguage,
        });
        setTheme(serverTheme);
        // Sync to localStorage as cache
        if (typeof window !== "undefined") {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, serverLanguage);
        }
        return;
      }
    } catch (e) {
      console.warn(
        "Failed to load settings from server, using localStorage:",
        e,
      );
    }

    // Fallback to localStorage
    const storedTheme = getStoredTheme();
    const storedLanguage =
      typeof window !== "undefined"
        ? (localStorage.getItem(LANGUAGE_STORAGE_KEY) as "en" | "zh") || "en"
        : "en";

    const themeToUse = storedTheme || "light";
    setUiSettings({
      theme: themeToUse,
      language: storedLanguage,
    });
    setTheme(themeToUse);
  };

  const updateTheme = async (newTheme: "light" | "dark") => {
    // Update UI immediately
    setTheme(newTheme);
    setUiSettings((prev) => ({ ...prev, theme: newTheme }));

    // Persist to backend
    try {
      await fetch(apiUrl("/api/v1/settings/theme"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      });
    } catch (e) {
      console.warn("Failed to save theme to server:", e);
    }
  };

  const updateLanguage = async (newLanguage: "en" | "zh") => {
    // Update UI immediately
    setUiSettings((prev) => ({ ...prev, language: newLanguage }));
    if (typeof window !== "undefined") {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, newLanguage);
    }

    // Persist to backend
    try {
      await fetch(apiUrl("/api/v1/settings/language"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: newLanguage }),
      });
    } catch (e) {
      console.warn("Failed to save language to server:", e);
    }
  };

  useEffect(() => {
    // Initialize settings on first render
    if (!isInitialized) {
      // First apply localStorage theme immediately to avoid flash
      const initialTheme = initializeTheme();
      const storedLanguage =
        typeof window !== "undefined"
          ? (localStorage.getItem(LANGUAGE_STORAGE_KEY) as "en" | "zh") || "en"
          : "en";

      setUiSettings({
        theme: initialTheme,
        language: storedLanguage,
      });
      setIsInitialized(true);

      // Then async load from server (which may override)
      refreshSettings();
    }
  }, [isInitialized]);

  // --- Sidebar State ---
  const SIDEBAR_MIN_WIDTH = 64;
  const SIDEBAR_MAX_WIDTH = 320;
  const SIDEBAR_DEFAULT_WIDTH = 256;
  const SIDEBAR_COLLAPSED_WIDTH = 64;

  const [sidebarWidth, setSidebarWidthState] = useState<number>(
    SIDEBAR_DEFAULT_WIDTH,
  );
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);

  // Initialize sidebar state from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedWidth = localStorage.getItem("sidebarWidth");
      const storedCollapsed = localStorage.getItem("sidebarCollapsed");

      if (storedWidth) {
        const width = parseInt(storedWidth, 10);
        if (
          !isNaN(width) &&
          width >= SIDEBAR_MIN_WIDTH &&
          width <= SIDEBAR_MAX_WIDTH
        ) {
          setSidebarWidthState(width);
        }
      }

      if (storedCollapsed) {
        setSidebarCollapsedState(storedCollapsed === "true");
      }
    }
  }, []);

  const setSidebarWidth = (width: number) => {
    const clampedWidth = Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, width),
    );
    setSidebarWidthState(clampedWidth);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarWidth", clampedWidth.toString());
    }
  };

  const setSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarCollapsed", collapsed.toString());
    }
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // --- Sidebar Customization State ---
  const [sidebarDescription, setSidebarDescriptionState] =
    useState<string>(DEFAULT_SIDEBAR_DESCRIPTION);
  const [sidebarNavOrder, setSidebarNavOrderState] =
    useState<SidebarNavOrder>(
      sanitizeSidebarNavOrder(DEFAULT_SIDEBAR_NAV_ORDER),
    );

  // Initialize sidebar customization from backend API
  useEffect(() => {
    const loadSidebarSettings = async () => {
      try {
        const response = await fetch(apiUrl("/api/v1/settings/sidebar"));
        if (response.ok) {
          const data = await response.json();
          if (data.description) {
            setSidebarDescriptionState(data.description);
          }
          if (data.nav_order) {
            setSidebarNavOrderState(sanitizeSidebarNavOrder(data.nav_order));
          }
        }
      } catch (e) {
        console.error("Failed to load sidebar settings from backend:", e);
      }
    };
    loadSidebarSettings();
  }, []);

  const setSidebarDescription = async (description: string) => {
    setSidebarDescriptionState(description);
    // Save to backend
    try {
      await fetch(apiUrl("/api/v1/settings/sidebar/description"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
    } catch (e) {
      console.error("Failed to save sidebar description:", e);
    }
  };

  const setSidebarNavOrder = async (order: SidebarNavOrder) => {
    const sanitizedOrder = sanitizeSidebarNavOrder(order);
    setSidebarNavOrderState(sanitizedOrder);
    // Save to backend
    try {
      await fetch(apiUrl("/api/v1/settings/sidebar/nav-order"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nav_order: sanitizedOrder }),
      });
    } catch (e) {
      console.error("Failed to save sidebar nav order:", e);
    }
  };

  // --- Hydration tracking for persistence ---
  // We need to restore state from localStorage AFTER hydration to avoid SSR mismatch
  const isHydrated = useRef(false);

  // --- Solver Logic ---
  const [solverState, setSolverState] =
    useState<SolverState>(DEFAULT_SOLVER_STATE);
  const solverWs = useRef<WebSocket | null>(null);

  // Debounced save for solver state
  const saveSolverState = useCallback(
    debounce((state: SolverState) => {
      if (!isHydrated.current) return;
      const toSave = persistState(
        state,
        EXCLUDE_FIELDS.SOLVER as unknown as (keyof SolverState)[],
      );
      saveToStorage(STORAGE_KEYS.SOLVER_STATE, toSave);
    }, 500),
    [],
  );

  // Auto-save solver state on change (only after hydration)
  useEffect(() => {
    if (isHydrated.current) {
      saveSolverState(solverState);
    }
  }, [solverState, saveSolverState]);

  // Use ref to always have the latest sessionId in WebSocket callbacks
  const solverSessionIdRef = useRef<string | null>(null);

  const startSolver = (question: string, kb: string) => {
    if (solverWs.current) solverWs.current.close();

    setSolverState((prev) => ({
      ...prev,
      isSolving: true,
      logs: [],
      messages: [...prev.messages, { role: "user", content: question }],
      question,
      selectedKb: kb,
      agentStatus: {
        InvestigateAgent: "pending",
        NoteAgent: "pending",
        ManagerAgent: "pending",
        SolveAgent: "pending",
        ToolAgent: "pending",
        ResponseAgent: "pending",
        VerificationAgent: "pending",
        PrecisionAnswerAgent: "pending",
      },
      tokenStats: {
        model: "Unknown",
        calls: 0,
        tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost: 0.0,
      },
      progress: {
        stage: null,
        progress: {},
      },
    }));

    const ws = new WebSocket(wsUrl("/api/v1/solve"));
    solverWs.current = ws;

    ws.onopen = () => {
      // Send question with current session_id (if any)
      ws.send(
        JSON.stringify({
          question,
          kb_name: kb,
          session_id: solverSessionIdRef.current,
        }),
      );
      addSolverLog({ type: "system", content: "Initializing connection..." });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "session") {
        // Update session ID from backend
        solverSessionIdRef.current = data.session_id;
        setSolverState((prev) => ({
          ...prev,
          sessionId: data.session_id,
        }));
      } else if (data.type === "log") {
        addSolverLog(data);
      } else if (data.type === "agent_status") {
        setSolverState((prev) => ({
          ...prev,
          agentStatus: data.all_agents || {
            ...prev.agentStatus,
            [data.agent]: data.status,
          },
        }));
      } else if (data.type === "token_stats") {
        setSolverState((prev) => ({
          ...prev,
          tokenStats: data.stats || prev.tokenStats,
        }));
      } else if (data.type === "progress") {
        setSolverState((prev) => ({
          ...prev,
          progress: {
            stage: data.stage,
            progress: data.progress || {},
          },
        }));
      } else if (data.type === "result") {
        // Use output_dir_name from backend if available, otherwise extract from output_dir
        let dirName = data.output_dir_name || "";
        if (!dirName && data.output_dir) {
          const parts = data.output_dir.split(/[/\\]/);
          dirName = parts[parts.length - 1];
        }

        setSolverState((prev) => ({
          ...prev,
          sessionId: data.session_id || prev.sessionId,
          messages: [
            ...prev.messages,
            {
              role: "assistant",
              content: data.final_answer,
              outputDir: dirName,
              verificationPassed: data.metadata?.verification_passed,
              verificationConfidence: data.metadata?.verification_confidence,
              groundingStrength: data.metadata?.grounding_strength,
              usedWebFallback: data.metadata?.used_web_fallback,
            },
          ],
          isSolving: false,
          progress: {
            stage: null,
            progress: {},
          },
        }));
        ws.close();
      } else if (data.type === "error") {
        addSolverLog({
          type: "error",
          content: `Error: ${data.content || data.message || "Unknown error"}`,
        });
        setSolverState((prev) => ({
          ...prev,
          isSolving: false,
          progress: {
            stage: null,
            progress: {},
          },
        }));
      }
    };

    ws.onerror = () => {
      addSolverLog({ type: "error", content: "Connection error" });
      setSolverState((prev) => ({
        ...prev,
        isSolving: false,
        agentStatus: {
          InvestigateAgent: "error",
          NoteAgent: "error",
          ManagerAgent: "error",
          SolveAgent: "error",
          ToolAgent: "error",
          ResponseAgent: "error",
          VerificationAgent: "error",
          PrecisionAnswerAgent: "error",
        },
        progress: {
          stage: null,
          progress: {},
        },
      }));
    };

    ws.onclose = () => {
      // Clean up WebSocket reference on close
      if (solverWs.current === ws) {
        solverWs.current = null;
      }
    };
  };

  // Stop the current solving process
  const stopSolver = () => {
    if (solverWs.current) {
      // Close the WebSocket to signal cancellation to backend
      solverWs.current.close();
      solverWs.current = null;
    }
    // Reset solving state but keep logs for user reference if desired
    setSolverState((prev) => ({
      ...prev,
      isSolving: false,
      progress: {
        stage: null,
        progress: {},
      },
      // Optionally clear logs or keep them; here we keep existing logs
    }));
    addSolverLog({ type: "system", content: "Solver stopped by user." });
  };

  // Start a new solver session (clear current state)
  const newSolverSession = () => {
    if (solverWs.current) {
      solverWs.current.close();
      solverWs.current = null;
    }
    solverSessionIdRef.current = null;
    setSolverState({
      ...DEFAULT_SOLVER_STATE,
      selectedKb: solverState.selectedKb, // Keep the selected KB
    });
  };

  // Load a solver session from history
  const loadSolverSession = async (sessionId: string) => {
    try {
      const response = await fetch(
        apiUrl(`/api/v1/solve/sessions/${sessionId}`),
      );
      if (!response.ok) {
        throw new Error("Session not found");
      }
      const session = await response.json();

      // Map session messages to ChatMessage format
      const messages: ChatMessage[] = session.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        outputDir: msg.output_dir,
        verificationPassed: msg.verification_passed,
        verificationConfidence: msg.verification_confidence,
        groundingStrength: msg.grounding_strength,
        usedWebFallback: msg.used_web_fallback,
      }));

      solverSessionIdRef.current = session.session_id;

      setSolverState((prev) => ({
        ...prev,
        sessionId: session.session_id,
        messages,
        selectedKb: session.kb_name || prev.selectedKb,
        tokenStats: session.token_stats || prev.tokenStats,
        question:
          messages.length > 0 && messages[0].role === "user"
            ? messages[0].content
            : "",
        isSolving: false,
        logs: [],
        progress: { stage: null, progress: {} },
      }));
    } catch (error) {
      console.error("Failed to load solver session:", error);
      throw error;
    }
  };

  const addSolverLog = (log: LogEntry) => {
    setSolverState((prev) => ({ ...prev, logs: [...prev.logs, log] }));
  };

  // --- Chat Logic ---
  const [chatState, setChatState] = useState<ChatState>(DEFAULT_CHAT_STATE);
  const chatWs = useRef<WebSocket | null>(null);
  // Use ref to always have the latest sessionId in WebSocket callbacks (avoid closure issues)
  const sessionIdRef = useRef<string | null>(null);

  // Debounced save for chat state
  const saveChatState = useCallback(
    debounce((state: ChatState) => {
      if (!isHydrated.current) return;
      const toSave = persistState(
        state,
        EXCLUDE_FIELDS.CHAT as unknown as (keyof ChatState)[],
      );
      saveToStorage(STORAGE_KEYS.CHAT_STATE, toSave);
    }, 500),
    [],
  );

  // Auto-save chat state on change (only after hydration)
  useEffect(() => {
    if (isHydrated.current) {
      saveChatState(chatState);
    }
  }, [chatState, saveChatState]);

  // --- Restore persisted state after hydration ---
  useEffect(() => {
    // This runs only on client after hydration
    if (typeof window === "undefined") return;

    // Load persisted states
    const persistedSolver = loadFromStorage<Partial<SolverState>>(
      STORAGE_KEYS.SOLVER_STATE,
      {},
    );
    const persistedChat = loadFromStorage<Partial<ChatState>>(
      STORAGE_KEYS.CHAT_STATE,
      {},
    );

    // Restore solver state
    if (Object.keys(persistedSolver).length > 0) {
      setSolverState((prev) =>
        mergeWithDefaults(
          persistedSolver,
          prev,
          EXCLUDE_FIELDS.SOLVER as unknown as (keyof SolverState)[],
        ),
      );
    }

    // Restore chat state
    if (Object.keys(persistedChat).length > 0) {
      setChatState((prev) => {
        const merged = mergeWithDefaults(
          persistedChat,
          prev,
          EXCLUDE_FIELDS.CHAT as unknown as (keyof ChatState)[],
        );
        // Also update sessionIdRef
        if (merged.sessionId) {
          sessionIdRef.current = merged.sessionId;
        }
        return merged;
      });
    }

    // Mark as hydrated after restoring state
    isHydrated.current = true;
  }, []);

  const sendChatMessage = (message: string) => {
    if (!message.trim() || chatState.isLoading) return;

    // Add user message
    setChatState((prev) => ({
      ...prev,
      isLoading: true,
      currentStage: "connecting",
      messages: [...prev.messages, { role: "user", content: message }],
    }));

    // Close existing connection if any
    if (chatWs.current) {
      chatWs.current.close();
    }

    const ws = new WebSocket(wsUrl("/api/v1/chat/chat"));
    chatWs.current = ws;

    let assistantMessage = "";

    ws.onopen = () => {
      // Build history from current messages (excluding the one just added)
      const history = chatState.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      ws.send(
        JSON.stringify({
          message,
          // Use ref to get the latest sessionId (avoids closure capturing stale state)
          session_id: sessionIdRef.current,
          history,
          kb_name: chatState.selectedKb,
          enable_rag: chatState.enableRag,
          enable_web_search: chatState.enableWebSearch,
        }),
      );
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "session") {
        // Store session ID from backend - update both ref and state
        sessionIdRef.current = data.session_id;
        setChatState((prev) => ({
          ...prev,
          sessionId: data.session_id,
        }));
      } else if (data.type === "status") {
        setChatState((prev) => ({
          ...prev,
          currentStage: data.stage || data.message,
        }));
      } else if (data.type === "stream") {
        assistantMessage += data.content;
        setChatState((prev) => {
          const messages = [...prev.messages];
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === "assistant" && lastMessage?.isStreaming) {
            // Update existing streaming message
            messages[messages.length - 1] = {
              ...lastMessage,
              content: assistantMessage,
            };
          } else {
            // Add new streaming message
            messages.push({
              role: "assistant",
              content: assistantMessage,
              isStreaming: true,
            });
          }
          return { ...prev, messages, currentStage: "generating" };
        });
      } else if (data.type === "sources") {
        setChatState((prev) => {
          const messages = [...prev.messages];
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === "assistant") {
            messages[messages.length - 1] = {
              ...lastMessage,
              sources: { rag: data.rag, web: data.web },
            };
          }
          return { ...prev, messages };
        });
      } else if (data.type === "result") {
        setChatState((prev) => {
          const messages = [...prev.messages];
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role === "assistant") {
            messages[messages.length - 1] = {
              ...lastMessage,
              content: data.content,
              isStreaming: false,
            };
          }
          return {
            ...prev,
            messages,
            isLoading: false,
            currentStage: null,
          };
        });
        ws.close();
      } else if (data.type === "error") {
        setChatState((prev) => ({
          ...prev,
          isLoading: false,
          currentStage: null,
          messages: [
            ...prev.messages,
            { role: "assistant", content: `Error: ${data.message}` },
          ],
        }));
        ws.close();
      }
    };

    ws.onerror = () => {
      setChatState((prev) => ({
        ...prev,
        isLoading: false,
        currentStage: null,
        messages: [
          ...prev.messages,
          { role: "assistant", content: "Connection error. Please try again." },
        ],
      }));
    };

    ws.onclose = () => {
      if (chatWs.current === ws) {
        chatWs.current = null;
      }
      setChatState((prev) => ({
        ...prev,
        isLoading: false,
        currentStage: null,
      }));
    };
  };

  const clearChatHistory = () => {
    // Clear both ref and state
    sessionIdRef.current = null;
    setChatState((prev) => ({
      ...prev,
      sessionId: null,
      messages: [],
      currentStage: null,
    }));
  };

  const newChatSession = () => {
    // Close any existing WebSocket
    if (chatWs.current) {
      chatWs.current.close();
      chatWs.current = null;
    }
    // Reset to new session - clear both ref and state
    sessionIdRef.current = null;
    setChatState((prev) => ({
      ...prev,
      sessionId: null,
      messages: [],
      isLoading: false,
      currentStage: null,
    }));
  };

  const loadChatSession = async (sessionId: string) => {
    try {
      const response = await fetch(
        apiUrl(`/api/v1/chat/sessions/${sessionId}`),
      );
      if (!response.ok) {
        throw new Error("Session not found");
      }
      const session = await response.json();

      // Convert session messages to HomeChatMessage format
      const messages: HomeChatMessage[] = session.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
        isStreaming: false,
      }));

      // Restore session settings
      const settings = session.settings || {};

      // Update ref with loaded session ID for continued conversation
      sessionIdRef.current = session.session_id;

      setChatState((prev) => ({
        ...prev,
        sessionId: session.session_id,
        messages,
        selectedKb: settings.kb_name || prev.selectedKb,
        enableRag: settings.enable_rag ?? prev.enableRag,
        enableWebSearch: settings.enable_web_search ?? prev.enableWebSearch,
        isLoading: false,
        currentStage: null,
      }));
    } catch (error) {
      console.error("Failed to load session:", error);
      throw error;
    }
  };

  // --- Clear All Persistence ---
  const clearAllPersistence = useCallback(() => {
    // Import clearAllStorage dynamically to avoid circular dependencies
    import("@/lib/persistence").then(({ clearAllStorage }) => {
      clearAllStorage();
    });

    // Reset all states to defaults
    setSolverState(DEFAULT_SOLVER_STATE);
    setChatState(DEFAULT_CHAT_STATE);
    setCurrentSubjectState(DEFAULT_SUBJECT);
    sessionIdRef.current = null;
  }, []);

  return (
    <GlobalContext.Provider
      value={{
        currentSubject,
        setSubject,
        solverState,
        setSolverState,
        startSolver,
        stopSolver,
        newSolverSession,
        loadSolverSession,
        chatState,
        setChatState,
        sendChatMessage,
        clearChatHistory,
        loadChatSession,
        newChatSession,
        uiSettings,
        refreshSettings,
        updateTheme,
        updateLanguage,
        sidebarWidth,
        setSidebarWidth,
        sidebarCollapsed,
        setSidebarCollapsed,
        toggleSidebar,
        sidebarDescription,
        setSidebarDescription,
        sidebarNavOrder,
        setSidebarNavOrder,
        clearAllPersistence,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
}

export const useGlobal = () => {
  const context = useContext(GlobalContext);
  if (!context) throw new Error("useGlobal must be used within GlobalProvider");
  return context;
};
