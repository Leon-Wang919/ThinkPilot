"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Type declarations for FileSystem Entry API (drag & drop folder support)
interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntry extends FileSystemEntry {
  file(
    successCallback: (file: File) => void,
    errorCallback?: (error: Error) => void,
  ): void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader(): FileSystemDirectoryReader;
}

interface FileSystemDirectoryReader {
  readEntries(
    successCallback: (entries: FileSystemEntry[]) => void,
    errorCallback?: (error: Error) => void,
  ): void;
}

import {
  ArrowRight,
  BookOpen,
  Database,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Plus,
  Upload,
  Trash2,
  Loader2,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Star,
} from "lucide-react";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { apiUrl, wsUrl } from "@/lib/api";
import { useGlobal } from "@/context/GlobalContext";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import { useTranslation } from "react-i18next";
import { SUBJECT_OPTIONS, type Subject } from "@/types/subject";

interface ProgressInfo {
  stage: string;
  message: string;
  percent?: number;
  progress_percent?: number; // Legacy field from WebSocket
  current: number;
  total: number;
  file_name?: string;
  error?: string;
  timestamp?: string;
}

interface KnowledgeBase {
  name: string;
  subject: Subject;
  is_default: boolean;
  status?: string; // "initializing", "processing", "ready", "error"
  progress?: ProgressInfo;
  notebook?: NotebookSummary | null;
  statistics: {
    raw_documents: number;
    images: number;
    content_lists: number;
    rag_initialized: boolean;
    rag_provider?: string;
    status?: string;
    progress?: ProgressInfo;
    rag?: {
      chunks?: number;
      entities?: number;
      relations?: number;
    };
  };
}

interface UploadFile {
  file: File;
  id: string;
  name: string;
  type: string;
  size: number;
}

type NotebookRecordType =
  | "solve"
  | "question"
  | "research"
  | "co_writer"
  | "chat"
  | "upload";

interface NotebookSummary {
  id: string;
  name: string;
  description: string;
  updated_at: number;
  record_count: number;
  color: string;
  icon: string;
  managed: boolean;
  binding?: {
    kind: string;
    kb_name?: string | null;
  };
}

interface NotebookRecord {
  id: string;
  type: NotebookRecordType;
  title: string;
  user_query: string;
  output: string;
  metadata: Record<string, any>;
  created_at: number;
  kb_name?: string | null;
}

interface NotebookDetail extends NotebookSummary {
  created_at: number;
  pinned?: boolean;
  records: NotebookRecord[];
}

interface NotebookUploadResult {
  success: boolean;
  status: "success" | "partial" | "failure";
  filename: string;
  record?: NotebookRecord;
  error?: string;
}

interface NotebookUploadResponse {
  success: boolean;
  notebook: NotebookSummary;
  results: NotebookUploadResult[];
  success_count: number;
  partial_count: number;
  failure_count: number;
}

export default function KnowledgePage() {
  const { t } = useTranslation();
  const { currentSubject } = useGlobal();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [targetKb, setTargetKb] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [newKbName, setNewKbName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [ragProvider, setRagProvider] = useState<string>("llamaindex");
  const [ragProviders, setRagProviders] = useState<
    Array<{ id: string; name: string; description: string }>
  >([]);
  const [progressMap, setProgressMap] = useState<Record<string, ProgressInfo>>(
    {},
  );
  const [notebookPanelKb, setNotebookPanelKb] = useState<string | null>(null);
  const [notebookDetail, setNotebookDetail] = useState<NotebookDetail | null>(
    null,
  );
  const [selectedNotebookRecord, setSelectedNotebookRecord] =
    useState<NotebookRecord | null>(null);
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  const [notebookUploadFiles, setNotebookUploadFiles] = useState<UploadFile[]>(
    [],
  );
  const [uploadingNotebookFiles, setUploadingNotebookFiles] = useState(false);

  // Toast notification system
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [socketStates, setSocketStates] = useState<
    Record<string, "connecting" | "open" | "closed" | "error">
  >({});

  // Helper function to generate unique ID
  const generateFileId = () => Math.random().toString(36).substring(2, 15);

  const getSubjectLabel = (subject: Subject) =>
    t(SUBJECT_OPTIONS.find((item) => item.value === subject)?.labelKey || subject);

  const NOTEBOOK_UPLOAD_EXTENSIONS = ["pdf", "docx", "txt", "md"];

  // Helper function to get file extension
  const getFileExtension = (filename: string): string => {
    const parts = filename.split(".");
    return parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
  };

  // Supported file extensions per RAG provider (based on actual backend capabilities)
  const PROVIDER_SUPPORTED_EXTENSIONS: Record<string, string[]> = {
    // LlamaIndex: PDF + plain text files only (uses PyMuPDF for PDF, direct read for text)
    llamaindex: [
      "pdf",
      "txt",
      "md",
      "markdown",
      "json",
      "csv",
      "html",
      "htm",
      "xml",
      "yaml",
      "yml",
      "toml",
      "tex",
      "rst",
      "log",
    ],
    // LightRAG: Same as LlamaIndex - PDF + plain text files (uses FileTypeRouter + PDFParser)
    lightrag: [
      "pdf",
      "txt",
      "md",
      "markdown",
      "json",
      "csv",
      "html",
      "htm",
      "xml",
      "yaml",
      "yml",
      "toml",
      "tex",
      "rst",
      "log",
    ],
    // RAGAnything: Full multimodal support - PDF, Word, Images, and plain text (uses MinerU)
    raganything: [
      "pdf",
      "doc",
      "docx",
      "txt",
      "md",
      "markdown",
      "json",
      "csv",
      "html",
      "htm",
      "xml",
      "yaml",
      "yml",
      "toml",
      "tex",
      "rst",
      "log",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "tiff",
      "tif",
    ],
  };

  // Human-readable file type hints for each provider
  const PROVIDER_FILE_HINTS: Record<string, string> = {
    llamaindex: "PDF, TXT, MD, JSON, CSV, HTML, XML...",
    lightrag: "PDF, TXT, MD, JSON, CSV, HTML, XML...",
    raganything: "PDF, Word, 图片, TXT, MD, JSON, CSV, HTML...",
  };

  // Get supported extensions for current provider
  const getSupportedExtensions = (provider: string): string[] => {
    return (
      PROVIDER_SUPPORTED_EXTENSIONS[provider] ||
      PROVIDER_SUPPORTED_EXTENSIONS.llamaindex
    );
  };

  // Get file type hint for current provider
  const getFileTypeHint = (provider: string): string => {
    return PROVIDER_FILE_HINTS[provider] || PROVIDER_FILE_HINTS.llamaindex;
  };

  // Get accept attribute for file input based on provider
  const getAcceptAttribute = (provider: string): string => {
    const extensions = getSupportedExtensions(provider);
    return extensions.map((ext) => `.${ext}`).join(",");
  };

  const isSupportedFile = (filename: string): boolean => {
    const ext = getFileExtension(filename);
    const supportedExtensions = getSupportedExtensions(ragProvider);
    return supportedExtensions.includes(ext);
  };

  // Helper function to convert File to UploadFile
  const fileToUploadFile = (file: File): UploadFile => ({
    file,
    id: generateFileId(),
    name: file.name,
    type: getFileExtension(file.name),
    size: file.size,
  });

  // Helper function to add files (avoiding duplicates)
  const addFiles = (newFiles: File[]) => {
    setUploadFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const uniqueNewFiles = newFiles
        .filter((f) => !existingNames.has(f.name))
        .map(fileToUploadFile);
      return [...prev, ...uniqueNewFiles];
    });
  };

  // Helper function to remove a file
  const removeFile = (fileId: string) => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Helper function to clear all files
  const clearAllFiles = () => {
    setUploadFiles([]);
  };

  // Helper function to recursively read directory entries
  const readDirectoryRecursively = async (
    dirEntry: FileSystemDirectoryEntry,
  ): Promise<File[]> => {
    const files: File[] = [];
    const reader = dirEntry.createReader();

    const readEntries = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
    };

    const getFile = (fileEntry: FileSystemFileEntry): Promise<File> => {
      return new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
    };

    let entries: FileSystemEntry[];
    do {
      entries = await readEntries();
      for (const entry of entries) {
        if (entry.isFile) {
          const file = await getFile(entry as FileSystemFileEntry);
          // Filter supported file types
          if (isSupportedFile(file.name)) {
            files.push(file);
          }
        } else if (entry.isDirectory) {
          const subFiles = await readDirectoryRecursively(
            entry as FileSystemDirectoryEntry,
          );
          files.push(...subFiles);
        }
      }
    } while (entries.length > 0);

    return files;
  };

  // Helper function to process dropped items (files and folders)
  const processDroppedItems = async (dataTransfer: DataTransfer) => {
    const items = dataTransfer.items;
    const allFiles: File[] = [];

    const processItem = async (item: DataTransferItem): Promise<File[]> => {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) {
        // Fallback: try to get as file
        const file = item.getAsFile();
        if (file && isSupportedFile(file.name)) {
          return [file];
        }
        return [];
      }

      if (entry.isFile) {
        return new Promise((resolve) => {
          (entry as unknown as FileSystemFileEntry).file(
            (file) => {
              if (isSupportedFile(file.name)) {
                resolve([file]);
              } else {
                resolve([]);
              }
            },
            () => resolve([]),
          );
        });
      } else if (entry.isDirectory) {
        return readDirectoryRecursively(
          entry as unknown as FileSystemDirectoryEntry,
        );
      }
      return [];
    };

    // Process all items in parallel
    const promises: Promise<File[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      promises.push(processItem(items[i]));
    }

    const results = await Promise.all(promises);
    results.forEach((files) => allFiles.push(...files));

    return allFiles;
  };

  // Helper function to format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Helper function to get file icon based on type
  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf":
        return <FileText className="w-4 h-4 text-red-500" />;
      case "md":
        return <FileText className="w-4 h-4 text-blue-500" />;
      case "txt":
        return <FileText className="w-4 h-4 text-slate-500" />;
      case "doc":
      case "docx":
      case "rtf":
        return <FileText className="w-4 h-4 text-blue-600" />;
      case "html":
      case "htm":
      case "xml":
        return <FileText className="w-4 h-4 text-orange-500" />;
      case "json":
        return <FileText className="w-4 h-4 text-yellow-600" />;
      case "csv":
      case "xlsx":
      case "xls":
        return <FileText className="w-4 h-4 text-green-600" />;
      case "pptx":
      case "ppt":
        return <FileText className="w-4 h-4 text-orange-600" />;
      default:
        return <FileText className="w-4 h-4 text-slate-400" />;
    }
  };

  // Helper function to get file type label
  const getFileTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      pdf: "PDF",
      md: "Markdown",
      txt: "Text",
      doc: "Word",
      docx: "Word",
      rtf: "RTF",
      html: "HTML",
      htm: "HTML",
      xml: "XML",
      json: "JSON",
      csv: "CSV",
      xlsx: "Excel",
      xls: "Excel",
      pptx: "PowerPoint",
      ppt: "PowerPoint",
    };
    return labels[type] || type.toUpperCase();
  };

  const isNotebookUploadSupported = (filename: string): boolean => {
    return NOTEBOOK_UPLOAD_EXTENSIONS.includes(getFileExtension(filename));
  };

  const getNotebookRecordLabel = (type: NotebookRecordType): string => {
    switch (type) {
      case "solve":
        return t("Solver");
      case "question":
        return t("Question");
      case "research":
        return t("Research");
      case "co_writer":
        return t("Co-Writer");
      case "chat":
        return t("Chat");
      case "upload":
        return t("Upload");
      default:
        return t("Record");
    }
  };

  const getNotebookRecordColor = (type: NotebookRecordType): string => {
    switch (type) {
      case "solve":
        return "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
      case "question":
        return "border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
      case "research":
        return "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
      case "co_writer":
        return "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
      case "chat":
        return "border-cyan-200 bg-cyan-50 text-cyan-600 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300";
      case "upload":
        return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
      default:
        return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
    }
  };

  const getAttachment = (record: NotebookRecord | null) => {
    if (!record) {
      return null;
    }
    const attachment = record.metadata?.attachment;
    return attachment && typeof attachment === "object" ? attachment : null;
  };

  const getAttachmentStatusLabel = (status?: string | null) => {
    switch (status) {
      case "success":
        return t("Extracted");
      case "empty":
        return t("No extracted content");
      case "error":
        return t("Extraction unavailable");
      default:
        return status || t("Unknown");
    }
  };

  const formatNotebookTimestamp = (timestamp?: number | null) => {
    if (!timestamp) {
      return t("No notebook activity yet");
    }
    return new Date(timestamp * 1000).toLocaleString();
  };

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Use ref only for WebSocket connections (no need for state as it's not used in render)
  const wsConnectionsRef = useRef<Record<string, WebSocket>>({});
  const lastTerminalRefreshRef = useRef<Record<string, string>>({});

  const setSocketState = useCallback(
    (kbName: string, nextState: "connecting" | "open" | "closed" | "error") => {
      setSocketStates((prev) =>
        prev[kbName] === nextState ? prev : { ...prev, [kbName]: nextState },
      );
    },
    [],
  );

  const removeSocketState = useCallback((kbName: string) => {
    setSocketStates((prev) => {
      if (!(kbName in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[kbName];
      return next;
    });
  }, []);

  // Restore progress state from localStorage (with cleanup of stuck states)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kb_progress_map");
      if (saved) {
        const parsed = JSON.parse(saved);

        // Clean up stuck progress states (older than 30 minutes and not completed/error)
        const now = new Date().getTime();
        const thirtyMinutes = 30 * 60 * 1000;
        const cleaned: Record<string, ProgressInfo> = {};

        Object.entries(parsed).forEach(([kbName, progress]: [string, any]) => {
          if (progress.timestamp) {
            const progressTime = new Date(progress.timestamp).getTime();
            const age = now - progressTime;

            // Keep if: completed, error, or recent (< 30 min)
            if (
              progress.stage === "completed" ||
              progress.stage === "error" ||
              age < thirtyMinutes
            ) {
              cleaned[kbName] = progress;
            } else {
              console.log(
                `[KB Progress] Clearing stuck progress for ${kbName} (age: ${Math.round(age / 60000)} min)`,
              );
            }
          } else {
            // No timestamp, keep completed/error, clear others
            if (progress.stage === "completed" || progress.stage === "error") {
              cleaned[kbName] = progress;
            }
          }
        });

        setProgressMap(cleaned);
        localStorage.setItem("kb_progress_map", JSON.stringify(cleaned));
      }
    } catch (e) {
      console.error("Failed to load progress from localStorage:", e);
    }
  }, []);

  // Persist progress state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("kb_progress_map", JSON.stringify(progressMap));
    } catch (e) {
      console.error("Failed to save progress to localStorage:", e);
    }
  }, [progressMap]);

  // Define fetchKnowledgeBases using useCallback to ensure it's available
  const fetchKnowledgeBases = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);

      const params = new URLSearchParams({ subject: currentSubject });
      const listUrl = apiUrl(`/api/v1/knowledge/list?${params.toString()}`);

      const res = await fetch(listUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(
          t("HTTP {status}: Failed to fetch knowledge bases").replace(
            "{status}",
            String(res.status),
          ),
        );
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error(
          t("Invalid response format: expected array, got {type}").replace(
            "{type}",
            typeof data,
          ),
        );
      }

      setKbs(data);
      setError(null); // Clear previous error - empty list is not an error, it's just empty state
    } catch (err: any) {
      console.error("Failed to fetch knowledge bases:", err);

      let errorMessage =
        err.message ||
        t("Failed to load knowledge bases. Please ensure the backend is running.");

      // Provide more detailed message for network errors
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        errorMessage = t(
          "Network error: Cannot connect to backend at {url}. Please ensure the backend is running.",
        ).replace("{url}", apiUrl(""));
      }

      setError(errorMessage);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [currentSubject, t]);

  useEffect(() => {
    fetchKnowledgeBases();
  }, [fetchKnowledgeBases]);

  useEffect(() => {
    if (notebookPanelKb && !kbs.some((kb) => kb.name === notebookPanelKb)) {
      closeNotebookPanel();
    }
  }, [kbs, notebookPanelKb]);

  // Auto-poll when a KB is processing and its socket is not stable yet.
  useEffect(() => {
    const hasUnstableProcessingKb = kbs.some((kb) => {
      const status = kb.statistics.status || kb.status;
      const isProcessing = status === "initializing" || status === "processing";
      return isProcessing && socketStates[kb.name] !== "open";
    });

    if (!hasUnstableProcessingKb) {
      return;
    }

    const intervalId = setInterval(() => {
      void fetchKnowledgeBases({ showLoading: false });
    }, 3000);

    return () => clearInterval(intervalId);
  }, [kbs, socketStates, fetchKnowledgeBases]);

  // Fetch RAG providers
  useEffect(() => {
    const fetchRagProviders = async () => {
      try {
        const res = await fetch(apiUrl("/api/v1/knowledge/rag-providers"));
        if (res.ok) {
          const data = await res.json();
          setRagProviders(data.providers || []);
        }
      } catch (err) {
        console.error("Failed to fetch RAG providers:", err);
      }
    };
    fetchRagProviders();
  }, []);

  // Keep one progress socket per KB and re-establish unhealthy connections.
  useEffect(() => {
    if (loading || !kbs) {
      return;
    }

    if (kbs.length === 0) {
      if (Object.keys(wsConnectionsRef.current).length > 0) {
        Object.values(wsConnectionsRef.current).forEach((ws) => {
          if (
            ws &&
            (ws.readyState === WebSocket.OPEN ||
              ws.readyState === WebSocket.CONNECTING)
          ) {
            ws.close();
          }
        });
        wsConnectionsRef.current = {};
      }
      setSocketStates({});
      lastTerminalRefreshRef.current = {};
      return;
    }

    const kbNames = new Set(kbs.map((kb) => kb.name));
    Object.entries(wsConnectionsRef.current).forEach(([kbName, ws]) => {
      if (!kbNames.has(kbName)) {
        if (
          ws &&
          (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING ||
            ws.readyState === WebSocket.CLOSING)
        ) {
          ws.close();
        }
        delete wsConnectionsRef.current[kbName];
        delete lastTerminalRefreshRef.current[kbName];
        removeSocketState(kbName);
      }
    });

    kbs.forEach((kb) => {
      const existing = wsConnectionsRef.current[kb.name];
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN ||
          existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const ws = new WebSocket(
        wsUrl(`/api/v1/knowledge/${kb.name}/progress/ws`),
      );
      wsConnectionsRef.current[kb.name] = ws;
      setSocketState(kb.name, "connecting");

      ws.onopen = () => {
        console.log(`[Progress WS] Connected for KB: ${kb.name}`);
        setSocketState(kb.name, "open");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "progress" && data.data) {
            // If KB is already initialized (ready), ignore stale in-progress updates
            // Only accept 'completed' or 'error' or recent updates (within 5 minutes)
            if (kb.statistics.rag_initialized) {
              const progressStage = data.data.stage;
              const progressTime = data.data.timestamp
                ? new Date(data.data.timestamp).getTime()
                : 0;
              const now = new Date().getTime();
              const fiveMinutes = 5 * 60 * 1000;

              // Skip stale in-progress updates for already-ready KBs
              if (progressStage !== "completed" && progressStage !== "error") {
                if (!progressTime || now - progressTime > fiveMinutes) {
                  console.log(
                    `[Progress WS] Ignoring stale progress for ready KB: ${kb.name}`,
                  );
                  return;
                }
              }
            }

            setProgressMap((prev) => {
              const updated = {
                ...prev,
                [kb.name]: data.data,
              };
              // Auto-persist to localStorage
              try {
                localStorage.setItem(
                  "kb_progress_map",
                  JSON.stringify(updated),
                );
              } catch (e) {
                console.error("Failed to save progress to localStorage:", e);
              }
              return updated;
            });

            if (data.data.stage === "completed" || data.data.stage === "error") {
              const refreshToken = `${data.data.stage}:${data.data.timestamp || ""}`;
              if (lastTerminalRefreshRef.current[kb.name] !== refreshToken) {
                lastTerminalRefreshRef.current[kb.name] = refreshToken;
                void fetchKnowledgeBases({ showLoading: false });
              }
            } else {
              delete lastTerminalRefreshRef.current[kb.name];
            }
          } else if (data.type === "error") {
            console.error(
              `[Progress WS] Error for KB ${kb.name}:`,
              data.message,
            );
          }
        } catch (e) {
          console.error(
            `[Progress WS] Error parsing message for ${kb.name}:`,
            e,
          );
        }
      };

      ws.onerror = (error) => {
        console.error(`[Progress WS] Error for ${kb.name}:`, error);
        setSocketState(kb.name, "error");
      };

      ws.onclose = () => {
        console.log(`[Progress WS] Closed for KB: ${kb.name}`);
        if (wsConnectionsRef.current[kb.name] === ws) {
          delete wsConnectionsRef.current[kb.name];
        }
        setSocketState(kb.name, "closed");
      };
    });
  }, [kbs, loading, fetchKnowledgeBases, removeSocketState, setSocketState]);

  // Cleanup all connections on component unmount
  useEffect(() => {
    return () => {
      Object.values(wsConnectionsRef.current).forEach((ws) => {
        if (
          ws &&
          (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING)
        ) {
          ws.close();
        }
      });
      wsConnectionsRef.current = {};
      lastTerminalRefreshRef.current = {};
    };
  }, []);

  const handleDelete = async (name: string) => {
    if (
      !confirm(
        t(
          'Are you sure you want to delete knowledge base "{name}"? This cannot be undone.',
        ).replace("{name}", name),
      )
    )
      return;

    try {
      const res = await fetch(apiUrl(`/api/v1/knowledge/${name}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete knowledge base");

      // Also clear progress state for this KB
      clearProgress(name);

      fetchKnowledgeBases();
    } catch (err) {
      console.error(err);
      showToast(t("Failed to delete knowledge base"), "error");
    }
  };

  // Clear progress state for a specific KB (frontend + backend)
  const clearProgress = async (kbName: string) => {
    // Clear frontend state
    setProgressMap((prev) => {
      const updated = { ...prev };
      delete updated[kbName];
      try {
        localStorage.setItem("kb_progress_map", JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save progress to localStorage:", e);
      }
      return updated;
    });

    // Clear backend progress file
    try {
      await fetch(apiUrl(`/api/v1/knowledge/${kbName}/progress/clear`), {
        method: "POST",
      });
      console.log(`[Progress] Cleared backend progress for KB: ${kbName}`);
    } catch (e) {
      console.error("Failed to clear backend progress:", e);
    }
  };

  // Clear all stuck progress states
  const clearAllStuckProgress = () => {
    setProgressMap((prev) => {
      const cleaned: Record<string, ProgressInfo> = {};
      Object.entries(prev).forEach(([kbName, progress]) => {
        // Only keep completed and error states
        if (progress.stage === "completed" || progress.stage === "error") {
          cleaned[kbName] = progress;
        }
      });
      try {
        localStorage.setItem("kb_progress_map", JSON.stringify(cleaned));
      } catch (e) {
        console.error("Failed to save progress to localStorage:", e);
      }
      return cleaned;
    });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadFiles.length === 0 || !targetKb) return;

    setUploading(true);
    const formData = new FormData();
    uploadFiles.forEach((uploadFile) => {
      formData.append("files", uploadFile.file);
    });

    // Add rag_provider to form data if user selected one different from KB's existing provider
    if (ragProvider) {
      formData.append("rag_provider", ragProvider);
    }

    try {
      const res = await fetch(apiUrl(`/api/v1/knowledge/${targetKb}/upload`), {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(t("Upload failed"));

      setUploadModalOpen(false);
      clearAllFiles();
      // Refresh immediately to establish WebSocket connection
      await fetchKnowledgeBases();
      showToast(
        t("Files uploaded successfully! Processing started in background."),
        "success",
      );
    } catch (err) {
      console.error(err);
      showToast(t("Failed to upload files"), "error");
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKbName || uploadFiles.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("name", newKbName);
    formData.append("rag_provider", ragProvider);
    formData.append("subject", currentSubject);
    uploadFiles.forEach((uploadFile) => {
      formData.append("files", uploadFile.file);
    });

    try {
      const res = await fetch(apiUrl("/api/v1/knowledge/create"), {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        showToast(t("Creation failed"), "error");
        setUploading(false);
        return;
      }

      const result = await res.json();

      setCreateModalOpen(false);
      clearAllFiles();
      setNewKbName("");
      setRagProvider("llamaindex"); // Reset to default

      // Immediately refresh to get the new KB from backend
      // (Backend now registers KB to kb_config.json immediately with status)
      await fetchKnowledgeBases();

      showToast(t("Knowledge base created successfully!"), "success");
    } catch (err: any) {
      console.error(err);
      showToast(
        t("Failed to create knowledge base: {message}").replace(
          "{message}",
          err.message || t("Unknown error"),
        ),
        "error",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      // Use the new folder-aware processing
      const droppedFiles = await processDroppedItems(e.dataTransfer);
      if (droppedFiles.length > 0) {
        addFiles(droppedFiles);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Fallback for browsers that don't support DataTransferItem
      const validFiles = Array.from(e.dataTransfer.files).filter((file) =>
        isSupportedFile(file.name),
      );
      if (validFiles.length > 0) {
        addFiles(validFiles);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Helper functions are stable
  }, []);

  const handleChangeKbSubject = async (kbName: string, nextSubject: Subject) => {
    try {
      const res = await fetch(apiUrl(`/api/v1/knowledge/${kbName}/subject`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject: nextSubject }),
      });
      if (!res.ok) {
        throw new Error(t("Failed to update knowledge base subject"));
      }
      showToast(
        t('Moved "{name}" to {subject}')
          .replace("{name}", kbName)
          .replace("{subject}", getSubjectLabel(nextSubject)),
        "success",
      );
      await fetchKnowledgeBases();
    } catch (err) {
      console.error(err);
      showToast(t("Failed to update knowledge base subject"), "error");
    }
  };

  const openNotebookPanel = async (kbName: string) => {
    setNotebookPanelKb(kbName);
    setLoadingNotebook(true);
    setSelectedNotebookRecord(null);
    setNotebookUploadFiles([]);
    try {
      const res = await fetch(apiUrl(`/api/v1/knowledge/${kbName}/notebook`));
      if (!res.ok) {
        throw new Error(t("Failed to load notebook"));
      }
      const data = (await res.json()) as NotebookDetail;
      setNotebookDetail(data);
      setSelectedNotebookRecord(data.records[0] || null);
    } catch (err) {
      console.error("Failed to fetch knowledge notebook:", err);
      showToast(t("Failed to load notebook"), "error");
    } finally {
      setLoadingNotebook(false);
    }
  };

  const closeNotebookPanel = () => {
    setNotebookPanelKb(null);
    setNotebookDetail(null);
    setSelectedNotebookRecord(null);
    setNotebookUploadFiles([]);
    setUploadingNotebookFiles(false);
  };

  const refreshNotebookPanel = async () => {
    if (!notebookPanelKb) {
      return;
    }
    await openNotebookPanel(notebookPanelKb);
    await fetchKnowledgeBases();
  };

  const handleNotebookFileSelection = (files: FileList | File[] | null) => {
    if (!files) {
      return;
    }
    setNotebookUploadFiles((prev) => {
      const existingNames = new Set(prev.map((item) => item.name));
      const next = Array.from(files)
        .filter((file) => isNotebookUploadSupported(file.name))
        .filter((file) => !existingNames.has(file.name))
        .map(fileToUploadFile);
      return [...prev, ...next];
    });
  };

  const handleNotebookUpload = async () => {
    if (!notebookPanelKb || notebookUploadFiles.length === 0) {
      return;
    }

    setUploadingNotebookFiles(true);
    try {
      const formData = new FormData();
      notebookUploadFiles.forEach((file) => {
        formData.append("files", file.file);
      });

      const res = await fetch(
        apiUrl(`/api/v1/knowledge/${notebookPanelKb}/notebook/upload`),
        {
          method: "POST",
          body: formData,
        },
      );

      const data = (await res.json()) as NotebookUploadResponse | { detail?: { message?: string } };
      if (!res.ok) {
        console.error("Notebook upload failed:", data);
        throw new Error(
          data && "detail" in data && data.detail?.message
            ? t("No notebook files were uploaded successfully")
            : t("Failed to upload notebook files"),
        );
      }

      const uploadResult = data as NotebookUploadResponse;
      const failures = uploadResult.failure_count || 0;
      const partials = uploadResult.partial_count || 0;
      setNotebookUploadFiles([]);
      await refreshNotebookPanel();
      showToast(
        partials > 0 && failures > 0
          ? t("Notebook upload completed with extraction issues and failed files")
          : partials > 0
            ? t("Attachment saved, but text extraction failed for some files")
            : failures > 0
          ? t("Uploaded with partial failures")
          : t("Notebook files uploaded successfully"),
        partials > 0 || failures > 0 ? "info" : "success",
      );
    } catch (err) {
      console.error("Failed to upload notebook files:", err);
      showToast(
        err instanceof Error
          ? err.message
          : t("Failed to upload notebook files"),
        "error",
      );
    } finally {
      setUploadingNotebookFiles(false);
    }
  };

  const handleDeleteNotebookRecord = async (recordId: string) => {
    if (!notebookDetail) {
      return;
    }
    try {
      const res = await fetch(
        apiUrl(`/api/v1/notebook/${notebookDetail.id}/records/${recordId}`),
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        throw new Error(t("Failed to delete notebook record"));
      }
      await refreshNotebookPanel();
    } catch (err) {
      console.error("Failed to delete notebook record:", err);
      showToast(t("Failed to delete notebook record"), "error");
    }
  };

  const notebookKnowledgeBases = kbs.filter((kb) => Boolean(kb.notebook?.id));
  const totalNotebookRecords = notebookKnowledgeBases.reduce(
    (total, kb) => total + (kb.notebook?.record_count ?? 0),
    0,
  );
  const featuredNotebookKb =
    notebookKnowledgeBases.find((kb) => kb.is_default) ||
    [...notebookKnowledgeBases].sort(
      (left, right) =>
        (right.notebook?.updated_at ?? 0) - (left.notebook?.updated_at ?? 0),
    )[0] ||
    null;

  return (
    <div className="tp-page animate-fade-in">
      <PageHeader
        title={t("Knowledge Bases")}
        actions={
          <div className="flex gap-2.5">
          <button
            onClick={async () => {
              setLoading(true);
              await fetchKnowledgeBases();
            }}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800"
            title={t("Refresh knowledge bases")}
          >
            <RefreshCw className="w-4 h-4" />
            {t("Refresh")}
          </button>
          <button
            onClick={() => {
              clearAllFiles();
              setNewKbName("");
              setRagProvider("llamaindex");
              setCreateModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition-colors hover:bg-slate-800 dark:bg-[hsl(var(--brand-strong))] dark:text-white dark:shadow-[0_16px_40px_-24px_rgba(59,130,246,0.52)] dark:hover:bg-[hsl(var(--brand-pressed))]"
          >
            <Plus className="w-4 h-4" />
            {t("New Knowledge Base")}
          </button>
          </div>
        }
      />

      <Panel className="flex-1" bodyClassName="flex-1 overflow-y-auto p-5">
      {!loading && (
        <div className="mb-6 overflow-hidden rounded-[28px] border border-blue-200 bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.58),_transparent_42%),linear-gradient(135deg,rgba(239,246,255,0.98),rgba(248,250,252,0.92))] p-6 shadow-[0_24px_60px_-40px_rgba(37,99,235,0.45)] dark:border-blue-900/60 dark:bg-[radial-gradient(circle_at_top_left,_rgba(30,64,175,0.35),_transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 shadow-sm dark:border-blue-800 dark:bg-slate-900/80 dark:text-blue-300">
                <BookOpen className="h-3.5 w-3.5" />
                {t("Knowledge Notebook")}
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {t("Every knowledge base includes a dedicated notebook")}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t(
                  "Save chat and teacher sessions here, or upload your own notes for each knowledge base.",
                )}
              </p>
            </div>

            {featuredNotebookKb ? (
              <button
                type="button"
                onClick={() => openNotebookPanel(featuredNotebookKb.name)}
                className="group w-full max-w-sm rounded-[24px] border border-white/80 bg-white/90 p-5 text-left shadow-[0_20px_48px_-32px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_28px_60px_-36px_rgba(37,99,235,0.45)] dark:border-slate-700 dark:bg-slate-900/88 dark:hover:border-blue-800"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {t("Latest notebook activity")}
                </p>
                <h3 className="mt-3 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {featuredNotebookKb.name}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  {t("Last updated")}:{" "}
                  {formatNotebookTimestamp(featuredNotebookKb.notebook?.updated_at)}
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-700 transition group-hover:gap-3 dark:text-blue-300">
                  {t("Open notebook")}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 dark:bg-[hsl(var(--brand-strong))] dark:hover:bg-[hsl(var(--brand-pressed))]"
              >
                {t("New Knowledge Base")}
              </button>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {t("Notebook-enabled knowledge bases")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {notebookKnowledgeBases.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {t("Total notebook records")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {totalNotebookRecords}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {t("Latest notebook activity")}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                {featuredNotebookKb
                  ? formatNotebookTimestamp(featuredNotebookKb.notebook?.updated_at)
                  : t("No notebook activity yet")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-800 mb-6 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse dark:border-slate-700 dark:bg-slate-900/80"
            />
          ))}
        </div>
      )}

      {/* KB Grid */}
	      {!loading && (
	        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {kbs.map((kb) => (
            <div
              key={kb.name}
              className="group flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/80"
            >
              {/* Card Header */}
              <div className="relative border-b border-slate-100 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/90">
                <div className="flex min-w-0 items-start gap-3 pr-24">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <Database className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                      {kb.name}
                    </h3>
	                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
	                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
	                        {getSubjectLabel(kb.subject)}
	                      </span>
	                      {kb.is_default && (
	                        <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-400">
	                          {t("Subject Default")}
	                        </span>
	                      )}
                      {kb.statistics.rag_provider && (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            kb.statistics.rag_provider === "raganything"
                              ? "bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800"
                              : kb.statistics.rag_provider === "lightrag"
                                ? "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800"
                                : "bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800"
                          }`}
                        >
                          {kb.statistics.rag_provider === "raganything"
                            ? t("RAG-Anything")
                            : kb.statistics.rag_provider === "lightrag"
                              ? t("LightRAG")
                              : kb.statistics.rag_provider === "llamaindex"
                                ? t("LlamaIndex")
                                : kb.statistics.rag_provider}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="absolute right-5 top-5 flex items-center gap-1">
	                  {!kb.is_default && (
	                    <button
	                      onClick={async () => {
	                        try {
	                          const params = new URLSearchParams({
	                            subject: currentSubject,
	                          });
	                          const res = await fetch(
	                            apiUrl(
	                              `/api/v1/knowledge/default/${kb.name}?${params.toString()}`,
	                            ),
	                            {
	                              method: "PUT",
	                            },
                          );
                          if (!res.ok) {
                            throw new Error(t("Failed to set default knowledge base"));
                          }
	                          showToast(
	                            t('Set "{name}" as the {subject} default')
                                .replace("{name}", kb.name)
                                .replace("{subject}", getSubjectLabel(currentSubject)),
	                            "success",
	                          );
                          fetchKnowledgeBases();
                        } catch (err) {
                          console.error(err);
                          showToast(
                            t("Failed to set default knowledge base"),
                            "error",
                          );
                        }
                      }}
                      className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-amber-100 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-400"
                      title={t("Set as Default")}
                    >
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setTargetKb(kb.name);
                      clearAllFiles();
                      // Set RAG provider to KB's existing provider or default
                      setRagProvider(
                        kb.statistics.rag_provider || "llamaindex",
                      );
                      setUploadModalOpen(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-blue-400"
                    title={t("Upload Documents")}
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(kb.name)}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/40 dark:hover:text-red-400"
                    title={t("Delete Knowledge Base")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

	              {/* Stats */}
	              <div className="flex-1 space-y-3.5 p-5">
	                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
	                  <div>
	                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
	                      {t("Subject")}
	                    </p>
	                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
	                      {getSubjectLabel(kb.subject)}
	                    </p>
	                  </div>
	                  <select
	                    value={kb.subject}
	                    onChange={(event) =>
	                      handleChangeKbSubject(
	                        kb.name,
	                        event.target.value as Subject,
	                      )
	                    }
	                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
	                  >
	                    {SUBJECT_OPTIONS.map((subjectOption) => (
	                      <option
	                        key={subjectOption.value}
	                        value={subjectOption.value}
	                      >
	                        {t(subjectOption.labelKey)}
	                      </option>
	                    ))}
	                  </select>
	                </div>

                  <button
                    type="button"
                    onClick={() => openNotebookPanel(kb.name)}
                    className="w-full rounded-[22px] border border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.98),rgba(224,242,254,0.96))] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_18px_40px_-30px_rgba(37,99,235,0.5)] dark:border-blue-900/70 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(12,74,110,0.6))] dark:hover:border-blue-700"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 shadow-sm dark:border-blue-900 dark:bg-slate-900/80 dark:text-blue-300">
                          <BookOpen className="h-3.5 w-3.5" />
                          {t("Knowledge Notebook")}
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                          {t("Open notebook")}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {t(
                            "Conversation saves and uploaded notes stay with this knowledge base.",
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 rounded-2xl border border-white/70 bg-white/85 px-3 py-2 text-right shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          {t("records")}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                          {kb.notebook?.record_count ?? 0}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-blue-100/80 pt-4 text-sm dark:border-blue-900/60">
                      <span className="text-slate-600 dark:text-slate-300">
                        {kb.notebook?.updated_at
                          ? `${t("Last updated")}: ${formatNotebookTimestamp(kb.notebook.updated_at)}`
                          : t("No notebook activity yet")}
                      </span>
                      <span className="inline-flex items-center gap-2 font-medium text-blue-700 dark:text-blue-300">
                        {t("Open Notebook")}
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </button>

	                <div className="grid grid-cols-2 gap-3.5">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <FileText className="w-3 h-3" /> {t("Documents")}
                    </p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                      {kb.statistics.raw_documents}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <ImageIcon className="w-3 h-3" /> {t("Images")}
                    </p>
                    <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                      {kb.statistics.images}
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                      <Layers className="w-3 h-3" /> {t("Status")}
                    </span>
                    {(() => {
                      // Priority: API progress > WebSocket progressMap > rag_initialized
                      const apiProgress = kb.statistics.progress || kb.progress;
                      const wsProgress = progressMap[kb.name];
                      const progress = apiProgress || wsProgress;
                      const status = kb.statistics.status || kb.status;

                      if (
                        status === "ready" ||
                        progress?.stage === "completed"
                      ) {
                        return (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {t("Ready")}
                          </span>
                        );
                      } else if (
                        status === "error" ||
                        progress?.stage === "error"
                      ) {
                        return (
                          <span className="text-red-600 dark:text-red-400 font-bold">
                            {t("Error")}
                          </span>
                        );
                      } else if (
                        status === "initializing" ||
                        status === "processing" ||
                        progress
                      ) {
                        // Display current stage and progress
                        const stageLabels: Record<string, string> = {
                          initializing: t("Initializing"),
                          processing_documents: t("Processing"),
                          processing_file: t("Processing File"),
                          extracting_items: t("Extracting Items"),
                        };
                        const stage =
                          progress?.stage || status || "initializing";
                        const stageLabel = stageLabels[stage] || stage;
                        const percent =
                          progress?.percent ?? progress?.progress_percent ?? 0;
                        return (
                          <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {stageLabel} {percent}%
                          </span>
                        );
                      }
                      return (
                        <span
                          className={
                            kb.statistics.rag_initialized
                              ? "text-emerald-600 dark:text-emerald-400 font-bold"
                              : "text-slate-400 dark:text-slate-500"
                          }
                        >
                          {kb.statistics.rag_initialized
                            ? t("Ready")
                            : t("Not Indexed")}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                    {(() => {
                      const apiProgress = kb.statistics.progress || kb.progress;
                      const wsProgress = progressMap[kb.name];
                      const progress = apiProgress || wsProgress;
                      const status = kb.statistics.status || kb.status;

                      if (
                        progress ||
                        status === "initializing" ||
                        status === "processing"
                      ) {
                        const percent =
                          progress?.percent ?? progress?.progress_percent ?? 0;
                        let bgColor = "bg-blue-500";
                        if (
                          status === "ready" ||
                          progress?.stage === "completed"
                        ) {
                          bgColor = "bg-emerald-500";
                        } else if (
                          status === "error" ||
                          progress?.stage === "error"
                        ) {
                          bgColor = "bg-red-500";
                        }
                        return (
                          <div
                            className={`h-full rounded-full ${bgColor} transition-all duration-300`}
                            style={{
                              width: `${Math.max(percent, status === "initializing" ? 5 : 0)}%`,
                            }}
                          />
                        );
                      }
                      return (
                        <div
                          className={`h-full rounded-full ${kb.statistics.rag_initialized ? "bg-emerald-500 w-full" : "bg-slate-300 w-0"}`}
                        />
                      );
                    })()}
                  </div>
                  {(() => {
                    const apiProgress = kb.statistics.progress || kb.progress;
                    const wsProgress = progressMap[kb.name];
                    const progress = apiProgress || wsProgress;
                    const status = kb.statistics.status || kb.status;

                    if (
                      progress?.message ||
                      (status && status !== "ready" && status !== "unknown")
                    ) {
                      return (
                        <div className="mt-2 space-y-1">
                          <div className="text-[10px] text-slate-600 dark:text-slate-400 font-medium flex items-center justify-between">
                            <span>
                              {progress?.message || `Status: ${status}`}
                            </span>
                            {/* Clear button for stuck states */}
                            {progress?.stage !== "completed" &&
                              status !== "ready" && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await clearProgress(kb.name);
                                    // Refresh KB list to show correct status
                                    fetchKnowledgeBases();
                                  }}
                                  className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                  title={t("Clear progress status")}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                          </div>
                          {progress?.file_name && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              <span className="truncate">
                                {progress.file_name}
                              </span>
                            </div>
                          )}
                          {progress &&
                            progress.current > 0 &&
                            progress.total > 0 && (
                              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                {t("File {current} of {total}")
                                  .replace("{current}", String(progress.current))
                                  .replace("{total}", String(progress.total))}
                              </div>
                            )}
                          {progress?.error && (
                            <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                              {t("Error")}: {progress.error}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (kb.statistics.rag) {
                      return (
                        <div className="mt-2 space-y-1">
                          <div className="flex gap-3 text-[10px] text-slate-400 dark:text-slate-500">
                            <span>
                              {kb.statistics.rag.chunks} {t("chunks")}
                            </span>
                            <span>•</span>
                            <span>
                              {kb.statistics.rag.entities} {t("entities")}
                            </span>
                          </div>
                          {kb.statistics.rag_provider && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {t("Provider")}:{" "}
                              <span className="font-semibold text-slate-600 dark:text-slate-300">
                                {kb.statistics.rag_provider}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (kb.statistics.rag_provider) {
                      return (
                        <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {t("Provider")}:{" "}
                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                            {kb.statistics.rag_provider}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            </div>
          ))}

          {/* Empty State */}
	          {kbs.length === 0 && (
	            <div className="col-span-full text-center py-12 text-slate-400 dark:text-slate-500">
	              <Database className="w-12 h-12 mx-auto mb-4 opacity-20" />
	              <p>
	                {t("No knowledge bases found. Create one to get started.")}{" "}
	                {getSubjectLabel(currentSubject)}
	              </p>
	            </div>
	          )}
        </div>
      )}

      {/* Create KB Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 ">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t("Create Knowledge Base")}
              </h3>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
	              <div>
	                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
	                  {t("Knowledge Base Name")}
	                </label>
                <input
                  type="text"
                  required
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  placeholder={t("e.g., Math101")}
	                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
	                />
	                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
	                  {t("This knowledge base will be created under")}{" "}
	                  {getSubjectLabel(currentSubject)}.
	                </p>
	              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t("RAG Provider")}
                </label>
                <select
                  value={ragProvider}
                  onChange={(e) => setRagProvider(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                >
                  {ragProviders.length > 0 ? (
                    ragProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="llamaindex">{t("LlamaIndex")}</option>
                      <option value="lightrag">{t("LightRAG")}</option>
                      <option value="raganything">{t("RAG-Anything")}</option>
                    </>
                  )}
                </select>
                {/* Provider description */}
                <div className="mt-2 p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-100 dark:border-slate-600">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {(() => {
                      const selectedProvider = ragProviders.find(
                        (p) => p.id === ragProvider,
                      );
                      if (selectedProvider?.description) {
                        return selectedProvider.description;
                      }
                      // Fallback descriptions
                      const fallbackDescriptions: Record<string, string> = {
                        llamaindex: t(
                          "Pure vector retrieval, fastest processing speed.",
                        ),
                        lightrag: t(
                          "Lightweight knowledge graph retrieval, fast processing of text documents.",
                        ),
                        raganything: t(
                          "Multimodal document processing with chart and formula extraction, builds knowledge graphs.",
                        ),
                      };
                      return (
                        fallbackDescriptions[ragProvider] ||
                        t(
                          "Select a RAG pipeline suitable for your document type",
                        )
                      );
                    })()}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t("Upload Documents")}
                </label>
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                    dragActive
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                      : "border-slate-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50 dark:bg-slate-700/50"
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    id="kb-file-upload"
                    onChange={(e) => {
                      if (e.target.files) {
                        const validFiles = Array.from(e.target.files).filter(
                          (file) => isSupportedFile(file.name),
                        );
                        addFiles(validFiles);
                      }
                      e.target.value = ""; // Reset input to allow re-selecting same files
                    }}
                    accept={getAcceptAttribute(ragProvider)}
                  />

                  {/* Drop zone / Click to upload area */}
                  <label
                    htmlFor="kb-file-upload"
                    className={`cursor-pointer flex flex-col items-center gap-2 ${uploadFiles.length > 0 ? "p-4" : "p-8"}`}
                  >
                    <Upload
                      className={`w-6 h-6 ${dragActive ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"}`}
                    />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      {uploadFiles.length > 0
                        ? t("Click or drop to add more files")
                        : t("Drag & drop files or folders here")}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {getFileTypeHint(ragProvider)}
                    </span>
                  </label>

                  {/* File list */}
                  {uploadFiles.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-600 px-3 py-2 max-h-48 overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {uploadFiles.length === 1
                            ? t("{n} file selected").replace(
                                "{n}",
                                String(uploadFiles.length),
                              )
                            : t("{n} files selected").replace(
                                "{n}",
                                String(uploadFiles.length),
                              )}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            clearAllFiles();
                          }}
                          className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium"
                        >
                          {t("Clear all")}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {uploadFiles.map((file) => (
                          <div
                            key={file.id}
                            className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-700 rounded-lg border border-slate-100 dark:border-slate-600 group"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {getFileIcon(file.type)}
                              <div className="min-w-0 flex-1">
                                <p
                                  className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"
                                  title={file.name}
                                >
                                  {file.name}
                                </p>
                                <p className="text-xs text-slate-400 dark:text-slate-500">
                                  {getFileTypeLabel(file.type)} •{" "}
                                  {formatFileSize(file.size)}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                removeFile(file.id);
                              }}
                              className="p-1 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              title={t("Remove file")}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!newKbName || uploadFiles.length === 0 || uploading}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t("Create & Initialize")
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {notebookPanelKb && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={t("Close notebook panel")}
            onClick={closeNotebookPanel}
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-6xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <BookOpen className="h-3.5 w-3.5" />
                  {t("Knowledge Notebook")}
                </div>
                <h3 className="mt-3 truncate text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {notebookDetail?.name || notebookPanelKb}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {t("Dedicated to this knowledge base")}: {notebookPanelKb}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {(notebookDetail?.records.length || 0)} {t("records")}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {t("Last updated")}:{" "}
                    {formatNotebookTimestamp(notebookDetail?.updated_at)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closeNotebookPanel}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col border-r border-slate-200 dark:border-slate-700">
                <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {t("Upload Notes")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {t("PDF, DOCX, TXT, MD")}
                        </p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Upload className="h-3.5 w-3.5" />
                        {t("Select Files")}
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          accept=".pdf,.docx,.txt,.md"
                          onChange={(event) => {
                            handleNotebookFileSelection(event.target.files);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {notebookUploadFiles.length > 0 ? (
                      <div className="space-y-2">
                        <div className="max-h-40 space-y-2 overflow-y-auto">
                          {notebookUploadFiles.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                  {file.name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatFileSize(file.size)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setNotebookUploadFiles((prev) =>
                                    prev.filter((entry) => entry.id !== file.id),
                                  )
                                }
                                className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={handleNotebookUpload}
                          disabled={uploadingNotebookFiles}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          {uploadingNotebookFiles ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          {t("Upload to Notebook")}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t("Uploaded files become notebook records and stay attached for download.")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {loadingNotebook ? (
                    <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : notebookDetail?.records.length ? (
                    <div className="space-y-2">
                      {notebookDetail.records.map((record) => {
                        const selected = selectedNotebookRecord?.id === record.id;
                        return (
                          <div
                            key={record.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedNotebookRecord(record)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedNotebookRecord(record);
                              }
                            }}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                              selected
                                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                    selected
                                      ? "border-white/20 bg-white/10 text-white dark:border-slate-300 dark:bg-slate-200 dark:text-slate-900"
                                      : getNotebookRecordColor(record.type)
                                  }`}
                                >
                                  {getNotebookRecordLabel(record.type)}
                                </div>
                                <p className="mt-2 truncate text-sm font-semibold">
                                  {record.title}
                                </p>
                                <p
                                  className={`mt-1 line-clamp-2 text-xs ${
                                    selected
                                      ? "text-white/75 dark:text-slate-700"
                                      : "text-slate-500 dark:text-slate-400"
                                  }`}
                                >
                                  {record.user_query ||
                                    getAttachment(record)?.original_filename ||
                                    t("No preview available")}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteNotebookRecord(record.id);
                                }}
                                className={`rounded-lg p-2 transition ${
                                  selected
                                    ? "text-white/70 hover:bg-white/10 hover:text-white dark:text-slate-700 dark:hover:bg-slate-200"
                                    : "text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                                }`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <p
                              className={`mt-2 text-[11px] ${
                                selected
                                  ? "text-white/60 dark:text-slate-700"
                                  : "text-slate-400 dark:text-slate-500"
                              }`}
                            >
                              {new Date(record.created_at * 1000).toLocaleString()}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <BookOpen className="mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t("No notebook records yet")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t("Save a KB conversation or upload notes to start building this notebook.")}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto px-6 py-5">
                {selectedNotebookRecord ? (
                  <div className="mx-auto flex max-w-4xl flex-col gap-5">
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getNotebookRecordColor(
                              selectedNotebookRecord.type,
                            )}`}
                          >
                            {getNotebookRecordLabel(selectedNotebookRecord.type)}
                          </div>
                          <h4 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                            {selectedNotebookRecord.title}
                          </h4>
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            {new Date(
                              selectedNotebookRecord.created_at * 1000,
                            ).toLocaleString()}
                          </p>
                        </div>
                        {getAttachment(selectedNotebookRecord)?.url ? (
                          <a
                            href={apiUrl(getAttachment(selectedNotebookRecord)!.url)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Download className="h-4 w-4" />
                            {t("Download Attachment")}
                          </a>
                        ) : null}
                      </div>

                      {selectedNotebookRecord.user_query ? (
                        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            {t("User Query")}
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-200">
                            {selectedNotebookRecord.user_query}
                          </p>
                        </div>
                      ) : null}

                      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                          {t("Output")}
                        </p>
                        <div className="mt-4">
                          <MarkdownRenderer
                            content={
                              selectedNotebookRecord.output || t("No extracted content")
                            }
                            variant="prose"
                          />
                        </div>
                      </div>

                      {getAttachment(selectedNotebookRecord) ? (
                        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            {t("Attachment")}
                          </p>
                          <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <p>
                              {getAttachment(selectedNotebookRecord)?.original_filename}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {getAttachment(selectedNotebookRecord)?.mime_type} •{" "}
                              {formatFileSize(
                                Number(
                                  getAttachment(selectedNotebookRecord)?.size_bytes || 0,
                                ),
                              )}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {t("Extraction status")}:{" "}
                              {getAttachmentStatusLabel(
                                getAttachment(selectedNotebookRecord)?.extract_status,
                              )}
                            </p>
                          </div>
                          {getAttachment(selectedNotebookRecord)?.extract_status ===
                          "error" ? (
                            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                              {t("Attachment saved, but text extraction failed.")}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-center">
                    <div>
                      <FileText className="mx-auto mb-4 h-10 w-10 text-slate-300 dark:text-slate-600" />
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t("Select a record")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t("Choose a notebook entry from the left to preview it here.")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal (Existing) */}
      {uploadModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t("Upload Documents")}
              </h3>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {t("Upload documents to")}{" "}
              <strong className="text-slate-700 dark:text-slate-200">
                {targetKb}
              </strong>
            </p>

            <form onSubmit={handleUpload} className="space-y-4">
              {/* Provider is LOCKED for incremental uploads - display only, no selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t("RAG Provider")}
                </label>
                <div className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-600 text-slate-900 dark:text-slate-100">
                  {ragProvider === "llamaindex" && t("LlamaIndex")}
                  {ragProvider === "lightrag" && t("LightRAG")}
                  {ragProvider === "raganything" && t("RAG-Anything")}
                  {ragProvider === "raganything_docling" &&
                    t("RAG-Anything (Docling)")}
                  {![
                    "llamaindex",
                    "lightrag",
                    "raganything",
                    "raganything_docling",
                  ].includes(ragProvider) && ragProvider}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t("Keep unchanged to use this KB's existing provider")}
                </p>
              </div>

              <div
                className={`border-2 border-dashed rounded-xl transition-colors ${
                  dragActive
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                    : "border-slate-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50 dark:bg-slate-700/50"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
                  id="file-upload"
                  onChange={(e) => {
                    if (e.target.files) {
                      const validFiles = Array.from(e.target.files).filter(
                        (file) => isSupportedFile(file.name),
                      );
                      addFiles(validFiles);
                    }
                    e.target.value = ""; // Reset input to allow re-selecting same files
                  }}
                  accept={getAcceptAttribute(ragProvider)}
                />

                {/* Drop zone / Click to upload area */}
                <label
                  htmlFor="file-upload"
                  className={`cursor-pointer flex flex-col items-center gap-2 ${uploadFiles.length > 0 ? "p-4" : "p-8"}`}
                >
                  <Upload
                    className={`w-6 h-6 ${dragActive ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"}`}
                  />
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    {uploadFiles.length > 0
                      ? t("Click or drop to add more files")
                      : t("Drag & drop files or folders here")}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {getFileTypeHint(ragProvider)}
                  </span>
                </label>

                {/* File list */}
                {uploadFiles.length > 0 && (
                  <div className="border-t border-slate-200 dark:border-slate-600 px-3 py-2 max-h-48 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {uploadFiles.length}{" "}
                        {t(uploadFiles.length > 1 ? "files" : "file")} {t("selected")}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          clearAllFiles();
                        }}
                        className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium"
                      >
                        {t("Clear all")}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {uploadFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-700 rounded-lg border border-slate-100 dark:border-slate-600 group"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {getFileIcon(file.type)}
                            <div className="min-w-0 flex-1">
                              <p
                                className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"
                                title={file.name}
                              >
                                {file.name}
                              </p>
                              <p className="text-xs text-slate-400 dark:text-slate-500">
                                {getFileTypeLabel(file.type)} •{" "}
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              removeFile(file.id);
                            }}
                            className="p-1 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            title={t("Remove file")}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={uploadFiles.length === 0 || uploading}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Upload"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60]">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                : toast.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/70 dark:text-red-300"
                  : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      </Panel>
    </div>
  );
}
