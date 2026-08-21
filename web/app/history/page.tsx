"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  History,
  Clock,
  ChevronRight,
  Calculator,
  MessageCircle,
  Filter,
  Search,
  Calendar,
  X,
  MessageSquare,
  Loader2,
  Eye,
  Trash2,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { formatDate } from "@/lib/datetime";
import { useGlobal } from "@/context/GlobalContext";
import ActivityDetail from "@/components/ActivityDetail";
import ChatSessionDetail from "@/components/ChatSessionDetail";
import SolverSessionDetail from "@/components/SolverSessionDetail";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";

interface HistoryEntry {
  id: string;
  type: "solve" | "chat";
  title: string;
  summary: string;
  timestamp: number;
  content: any;
}

const TYPE_CONFIG = {
  solve: {
    icon: Calculator,
    color: "blue",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    textColor: "text-blue-600 dark:text-blue-400",
  },
  chat: {
    icon: MessageCircle,
    color: "amber",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    textColor: "text-amber-600 dark:text-amber-400",
  },
};

// Map English activity types to Chinese
const TYPE_LABELS = {
  solve: "解题",
  chat: "聊天",
};

// Chat session interface
interface ChatSession {
  session_id: string;
  title: string;
  message_count: number;
  last_message: string;
  created_at: number;
  updated_at: number;
}

// Solver session interface
interface SolverSession {
  session_id: string;
  title: string;
  message_count: number;
  kb_name: string;
  last_message: string;
  token_stats?: {
    model: string;
    calls: number;
    tokens: number;
    cost: number;
  };
  created_at: number;
  updated_at: number;
}

export default function HistoryPage() {
  const { uiSettings, loadChatSession, loadSolverSession } = useGlobal();
  const { t } = useTranslation();
  const router = useRouter();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [solverSessions, setSolverSessions] = useState<SolverSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [loadingSolverSessionId, setLoadingSolverSessionId] = useState<
    string | null
  >(null);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [selectedChatSession, setSelectedChatSession] = useState<string | null>(
    null,
  );
  const [selectedSolverSession, setSelectedSolverSession] = useState<
    string | null
  >(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [deletingChatSessionId, setDeletingChatSessionId] = useState<string | null>(null);
  const [deletingSolverSessionId, setDeletingSolverSessionId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch regular activity history
      if (filterType === "all" || filterType === "solve") {
        const typeParam = filterType === "solve" ? "&type=solve" : "";
        const res = await fetch(
          apiUrl(`/api/v1/dashboard/recent?limit=50${typeParam}`),
        );
        const data = await res.json();
        setEntries(data);
      } else {
        setEntries([]);
      }

      // Fetch chat sessions
      if (filterType === "all" || filterType === "chat") {
        try {
          const sessionsRes = await fetch(
            apiUrl("/api/v1/chat/sessions?limit=20"),
          );
          const sessionsData = await sessionsRes.json();
          // Check if response is an array
          if (Array.isArray(sessionsData)) {
            setChatSessions(sessionsData);
          } else if (sessionsData && typeof sessionsData === 'object' && 'sessions' in sessionsData) {
            // Fallback for object with sessions property
            setChatSessions(sessionsData.sessions);
          } else {
            setChatSessions([]);
          }
        } catch (err) {
          console.error("Failed to fetch chat sessions:", err);
          setChatSessions([]);
        }
      } else {
        setChatSessions([]);
      }

      // Fetch solver sessions
      if (filterType === "all" || filterType === "solve") {
        try {
          const solverRes = await fetch(
            apiUrl("/api/v1/solve/sessions?limit=20"),
          );
          const solverData = await solverRes.json();
          // Check if response is an array
          if (Array.isArray(solverData)) {
            setSolverSessions(solverData);
          } else if (solverData && typeof solverData === 'object' && 'sessions' in solverData) {
            // Fallback for object with sessions property
            setSolverSessions(solverData.sessions);
          } else {
            setSolverSessions([]);
          }
        } catch (err) {
          console.error("Failed to fetch solver sessions:", err);
          setSolverSessions([]);
        }
      } else {
        setSolverSessions([]);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleLoadChatSession = async (sessionId: string) => {
    setLoadingSessionId(sessionId);
    try {
      await loadChatSession(sessionId);
      router.push("/");
    } catch (err) {
      console.error("Failed to load session:", err);
    } finally {
      setLoadingSessionId(null);
    }
  };

  const handleLoadSolverSession = async (sessionId: string) => {
    setLoadingSolverSessionId(sessionId);
    try {
      await loadSolverSession(sessionId);
      router.push("/solver");
    } catch (err) {
      console.error("Failed to load solver session:", err);
    } finally {
      setLoadingSolverSessionId(null);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm(t("Are you sure you want to delete this entry?"))) {
      return;
    }
    
    setDeletingEntryId(entryId);
    try {
      const res = await fetch(apiUrl(`/api/v1/dashboard/${entryId}`), {
        method: "DELETE",
      });
      
      if (res.ok) {
        // Refresh history after deletion
        await fetchHistory();
      } else {
        const error = await res.json();
        console.error("Failed to delete entry:", error);
        alert(t("Failed to delete entry: ") + error.detail);
      }
    } catch (err) {
      console.error("Error deleting entry:", err);
      alert(t("An error occurred while deleting the entry"));
    } finally {
      setDeletingEntryId(null);
    }
  };

  const handleDeleteChatSession = async (sessionId: string) => {
    if (!confirm(t("Are you sure you want to delete this chat session?"))) {
      return;
    }
    
    setDeletingChatSessionId(sessionId);
    try {
      const res = await fetch(apiUrl(`/api/v1/chat/sessions/${sessionId}`), {
        method: "DELETE",
      });
      
      if (res.ok) {
        // Refresh history after deletion
        await fetchHistory();
      } else {
        const error = await res.json();
        console.error("Failed to delete chat session:", error);
        alert(t("Failed to delete chat session: ") + error.detail);
      }
    } catch (err) {
      console.error("Error deleting chat session:", err);
      alert(t("An error occurred while deleting the chat session"));
    } finally {
      setDeletingChatSessionId(null);
    }
  };

  const handleDeleteSolverSession = async (sessionId: string) => {
    if (!confirm(t("Are you sure you want to delete this solver session?"))) {
      return;
    }
    
    setDeletingSolverSessionId(sessionId);
    try {
      const res = await fetch(apiUrl(`/api/v1/solve/sessions/${sessionId}`), {
        method: "DELETE",
      });
      
      if (res.ok) {
        // Refresh history after deletion
        await fetchHistory();
      } else {
        const error = await res.json();
        console.error("Failed to delete solver session:", error);
        alert(t("Failed to delete solver session: ") + error.detail);
      }
    } catch (err) {
      console.error("Error deleting solver session:", err);
      alert(t("An error occurred while deleting the solver session"));
    } finally {
      setDeletingSolverSessionId(null);
    }
  };

  const filteredEntries = entries.filter((entry) => {
    // Keep only solver activity cards in this section.
    if (entry.type !== "solve") return false;

    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      entry.title.toLowerCase().includes(query) ||
      entry.summary?.toLowerCase().includes(query)
    );
  });

  const groupEntriesByDate = (entries: HistoryEntry[]) => {
    const groups: { [key: string]: HistoryEntry[] } = {};

    entries.forEach((entry) => {
      const date = new Date(entry.timestamp * 1000);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateKey: string;
      if (date.toDateString() === today.toDateString()) {
        dateKey = t("Today");
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = t("Yesterday");
      } else {
        dateKey = formatDate(date, uiSettings.language, {
          month: "long",
          day: "numeric",
          year:
            date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
        });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(entry);
    });

    return groups;
  };

  const groupedEntries = groupEntriesByDate(filteredEntries);

  return (
    <div className="tp-page animate-fade-in">
      <PageHeader
        title={t("History")}
      />

      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={`${t("Search")}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {[
                { value: "all", label: t("All") },
                { value: "chat", label: t("Chat") },
                { value: "solve", label: t("Solve") },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilterType(option.value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                    filterType === option.value
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Scrollable Content Area */}
      <div className="flex-1 min-h-0 space-y-3.5 overflow-y-auto pr-1">
        {/* Regular Activity History */}
        <Panel className="overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400 dark:text-slate-500">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              {t("Loading")}...
            </div>
          ) : filteredEntries.length === 0 &&
            chatSessions.length === 0 &&
            solverSessions.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <History className="w-8 h-8 text-slate-300 dark:text-slate-500" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-medium">
                {t("No history found")}
              </p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                {t("Your activities will appear here")}
              </p>
            </div>
          ) : filteredEntries.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
                <div key={dateKey}>
                  {/* Date Header */}
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                      <Calendar className="w-4 h-4" />
                      {dateKey}
                    </div>
                  </div>

                  {/* Entries for this date */}
                  {dateEntries.map((entry) => {
                    const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.chat;
                    const IconComponent = config.icon;

                    return (
                      <div
                        key={entry.id}
                        className="group px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      >
                        <div className="flex gap-4">
                          <div className="mt-0.5">
                            <div
                              className={`w-10 h-10 rounded-xl ${config.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}
                            >
                              <IconComponent
                                className={`w-5 h-5 ${config.textColor}`}
                              />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedEntry(entry)}>
                            <div className="flex justify-between items-start">
                              <span
                              className={`mb-1 text-[11px] font-semibold ${config.textColor}`}
                            >
                              {TYPE_LABELS[entry.type] || entry.type}
                            </span>
                              <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(
                                  entry.timestamp * 1000,
                                ).toLocaleTimeString(
                                  uiSettings.language === "zh"
                                    ? "zh-CN"
                                    : "en-US",
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                              </span>
                            </div>
                            <h3 className="truncate pr-4 text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                              {entry.title}
                            </h3>
                            {entry.summary && (
                              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {entry.summary}
                              </p>
                            )}
                          </div>
                          <div className="self-center flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEntry(entry.id);
                              }}
                              disabled={deletingEntryId === entry.id}
                              className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                              title={t("Delete")}
                            >
                              {deletingEntryId === entry.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                            <ChevronRight className="w-5 h-5 text-slate-400 dark:text-slate-500 cursor-pointer" onClick={() => setSelectedEntry(entry)} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        {/* Chat Sessions Section */}
        {(filterType === "all" || filterType === "chat") && (
          <Panel className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                {t("Chat History")}
              </h2>
              <span className="text-xs text-slate-400 ml-auto">
                {chatSessions.length}{" "}
                {t(chatSessions.length === 1 ? "session" : "sessions")}
              </span>
            </div>
            {chatSessions.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {chatSessions
                  .filter((session) => {
                    if (!searchQuery.trim()) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      session.title.toLowerCase().includes(query) ||
                      session.last_message?.toLowerCase().includes(query)
                    );
                  })
                  .map((session) => (
                    <div
                      key={session.session_id}
                      onClick={() => setSelectedChatSession(session.session_id)}
                      className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group cursor-pointer"
                    >
                      <div className="flex gap-4">
                        <div className="mt-0.5">
                          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                            <MessageCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
                              {t("Chat")}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(
                                new Date(session.updated_at * 1000),
                                uiSettings.language,
                              )}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate pr-4">
                            {session.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {session.message_count} {t("messages")}
                            </span>
                            {session.last_message && (
                              <p className="text-sm text-slate-500 dark:text-slate-400 truncate flex-1">
                                {session.last_message}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="self-center flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedChatSession(session.session_id);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {t("View")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadChatSession(session.session_id);
                            }}
                            disabled={loadingSessionId === session.session_id}
                            className="px-3 py-1.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {loadingSessionId === session.session_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <MessageSquare className="w-3.5 h-3.5" />
                            )}
                            {t("Continue")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChatSession(session.session_id);
                            }}
                            disabled={deletingChatSessionId === session.session_id}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            title={t("Delete")}
                          >
                            {deletingChatSessionId === session.session_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-8 h-8 text-slate-300 dark:text-slate-500" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 font-medium">
                  {t("No chat sessions found")}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                  {t("Your chat sessions will appear here")}
                </p>
              </div>
            )}
          </Panel>
        )}

        {/* Solver Sessions Section */}
        {(filterType === "all" || filterType === "solve") && (
          <Panel className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                {t("Solver History")}
              </h2>
              <span className="text-xs text-slate-400 ml-auto">
                {solverSessions.length}{" "}
                {t(solverSessions.length === 1 ? "session" : "sessions")}
              </span>
            </div>
            {solverSessions.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {solverSessions
                  .filter((session) => {
                    if (!searchQuery.trim()) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      session.title.toLowerCase().includes(query) ||
                      session.last_message?.toLowerCase().includes(query)
                    );
                  })
                  .map((session) => (
                    <div
                      key={session.session_id}
                      onClick={() =>
                        setSelectedSolverSession(session.session_id)
                      }
                      className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group cursor-pointer"
                    >
                      <div className="flex gap-4">
                        <div className="mt-0.5">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                            <Calculator className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                              {t("Solve")}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(
                                new Date(session.updated_at * 1000),
                                uiSettings.language,
                              )}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate pr-4">
                            {session.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {session.message_count} {t("messages")}
                            </span>
                            {session.kb_name && (
                              <span className="text-xs text-blue-500 dark:text-blue-400">
                                {t("Knowledge Base")}: {session.kb_name}
                              </span>
                            )}
                            {session.token_stats?.cost !== undefined &&
                              session.token_stats.cost > 0 && (
                                <span className="text-xs text-amber-500">
                                  ${session.token_stats.cost.toFixed(4)}
                                </span>
                              )}
                          </div>
                          {session.last_message && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-1">
                              {session.last_message}
                            </p>
                          )}
                        </div>
                        <div className="self-center flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSolverSession(session.session_id);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {t("View")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadSolverSession(session.session_id);
                            }}
                            disabled={
                              loadingSolverSessionId === session.session_id
                            }
                            className="px-3 py-1.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {loadingSolverSessionId === session.session_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Calculator className="w-3.5 h-3.5" />
                            )}
                            {t("Continue")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSolverSession(session.session_id);
                            }}
                            disabled={deletingSolverSessionId === session.session_id}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            title={t("Delete")}
                          >
                            {deletingSolverSessionId === session.session_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calculator className="w-8 h-8 text-slate-300 dark:text-slate-500" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 font-medium">
                  {t("No solver sessions found")}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                  {t("Your solver sessions will appear here")}
                </p>
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* Activity Detail Modal */}
      {selectedEntry && (
        <ActivityDetail
          activity={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}

      {/* Chat Session Detail Modal */}
      {selectedChatSession && (
        <ChatSessionDetail
          sessionId={selectedChatSession}
          onClose={() => setSelectedChatSession(null)}
          onContinue={() => {
            handleLoadChatSession(selectedChatSession);
            setSelectedChatSession(null);
          }}
        />
      )}

      {/* Solver Session Detail Modal */}
      {selectedSolverSession && (
        <SolverSessionDetail
          sessionId={selectedSolverSession}
          onClose={() => setSelectedSolverSession(null)}
          onContinue={() => {
            handleLoadSolverSession(selectedSolverSession);
            setSelectedSolverSession(null);
          }}
        />
      )}
    </div>
  );
}
