"use client";

import { useState } from "react";
import { Loader2, FolderOpen, Link as LinkIcon, X } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useTranslation } from "react-i18next";

interface FolderSyncManagerProps {
  kbName: string;
  showToast: (message: string, type: "success" | "error" | "info") => void;
  onFolderLinked?: () => void;
  onFolderUnlinked?: () => void;
  onSyncComplete?: () => void;
}

interface FolderInfo {
  id: string;
  path: string;
  added_at: string;
  file_count: number;
}

export default function FolderSyncManager({
  kbName,
  showToast,
  onFolderLinked,
  onFolderUnlinked,
  onSyncComplete,
}: FolderSyncManagerProps) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [linking, setLinking] = useState(false);

  const handleLinkFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderPath || !kbName) return;

    setLinking(true);
    try {
      const res = await fetch(
        apiUrl(`/api/v1/knowledge/${kbName}/link-folder`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_path: folderPath }),
        },
      );

      if (!res.ok) throw new Error(t("Failed to link folder"));

      showToast(t("Folder linked successfully!"), "success");
      setModalOpen(false);
      setFolderPath("");
      onFolderLinked?.();
    } catch (err: any) {
      showToast(err.message || t("Failed to link folder"), "error");
    } finally {
      setLinking(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
      >
        <FolderOpen className="w-3 h-3" />
        {t("Link Folder")}
      </button>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[hsl(var(--panel))] rounded-2xl p-6 w-full max-w-md shadow-2xl border border-[hsl(var(--panel-border))] animate-fade-in">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-emerald-500" />
                {t("Link Local Folder")}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
              {t("Link a local folder to")}{" "}
              <span className="font-semibold text-[hsl(var(--foreground))]">
                {kbName}
              </span>
              {t(
                ". Documents in the folder will be processed and added to this knowledge base.",
              )}
            </p>

            <form onSubmit={handleLinkFolder} className="space-y-4">
              <div>
                <label
                  htmlFor="folder-path"
                  className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1"
                >
                  {t("Folder Path")}
                </label>
                <input
                  type="text"
                  id="folder-path"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder={t("Paste or type the full folder path")}
                  className="w-full px-4 py-2.5 border border-[hsl(var(--panel-border))] rounded-xl bg-[hsl(var(--panel-muted))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    <strong>{t("macOS/Linux:")}</strong> ~/Documents/papers or
                    /Users/name/folder
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    <strong>{t("Windows:")}</strong>{" "}
                    {t("C:\\Users\\name\\Documents\\papers")}
                  </p>
                </div>
              </div>

              <div className="bg-[hsl(var(--panel-muted))] rounded-lg p-3">
                <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                  {t("📄 Supported files: PDF, DOCX, TXT, MD")}
                </p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t(
                    "New and modified files will be automatically detected when you sync.",
                  )}
                </p>
              </div>

              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-100 dark:border-emerald-800">
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  <strong>{t("💡 Tip:")}</strong>{" "}
                  {t(
                    "Use folders synced with Google Drive, OneDrive, SharePoint, or Dropbox for automatic cloud integration.",
                  )}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[hsl(var(--panel-border))] text-[hsl(var(--muted-foreground))] font-medium hover:bg-[hsl(var(--panel-muted))]"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!folderPath || linking}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {linking ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4" />
                      {t("Link Folder")}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
