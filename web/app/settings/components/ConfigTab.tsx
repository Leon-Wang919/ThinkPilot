"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, Pencil } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { ConfigItem, ConfigType } from "../types";
import ConfigForm from "./ConfigForm";

interface ConfigTabProps {
  configType: ConfigType;
  title: string;
  description: string;
  onUpdate: () => void;
  showDimensions?: boolean;
  showVoice?: boolean;
  isSearchConfig?: boolean;
  t: (key: string) => string;
}

export default function ConfigTab({
  configType,
  title,
  description,
  onUpdate,
  showDimensions = false,
  showVoice = false,
  isSearchConfig = false,
  t,
}: ConfigTabProps) {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConfigItem | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/v1/config/${configType}`));
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch (e) {
      console.error(`Failed to load ${configType} configs:`, e);
    } finally {
      setLoading(false);
    }
  }, [configType]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const setActive = async (configId: string) => {
    try {
      const res = await fetch(
        apiUrl(`/api/v1/config/${configType}/${configId}/active`),
        {
          method: "POST",
        },
      );
      if (res.ok) {
        loadConfigs();
        onUpdate();
      }
    } catch (e) {
      console.error("Failed to set active config:", e);
    }
  };

  const deleteConfig = async (configId: string) => {
    if (!confirm(t("Are you sure you want to delete this configuration?")))
      return;

    try {
      const res = await fetch(
        apiUrl(`/api/v1/config/${configType}/${configId}`),
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        loadConfigs();
        onUpdate();
      }
    } catch (e) {
      console.error("Failed to delete config:", e);
    }
  };

  const testConnection = async (config: ConfigItem) => {
    if (isSearchConfig) return;

    setTesting(config.id);
    setTestResult(null);

    try {
      const res = await fetch(
        apiUrl(`/api/v1/config/${configType}/${config.id}/test`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, message: t("Connection test failed") });
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--brand))]" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {title}
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 rounded-lg bg-[hsl(var(--brand))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[hsl(var(--brand-strong))]"
        >
          <Plus className="w-4 h-4" />
          {t("Add Configuration")}
        </button>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingConfig) && (
        <ConfigForm
          configType={configType}
          showDimensions={showDimensions}
          showVoice={showVoice}
          isSearchConfig={isSearchConfig}
          editConfig={editingConfig}
          t={t}
          onSuccess={() => {
            setShowAddForm(false);
            setEditingConfig(null);
            loadConfigs();
            onUpdate();
          }}
          onCancel={() => {
            setShowAddForm(false);
            setEditingConfig(null);
          }}
        />
      )}

      {/* Test Result */}
      {testResult && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            testResult.success
              ? "border-green-200 bg-green-50 text-green-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {testResult.message}
        </div>
      )}

      {/* Configuration List */}
      <div className="space-y-3">
        {configs.map((config) => (
          <div
            key={config.id}
            className={`rounded-xl border p-4 transition-all ${
              config.is_active
                ? "border-[hsl(var(--brand))/0.3] bg-[hsl(var(--brand-soft))]"
                : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {config.is_active && (
                  <div className="h-2 w-2 rounded-full bg-[hsl(var(--brand))]" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {config.name}
                    </span>
                    {config.is_default && (
                      <span className="rounded-full bg-[hsl(var(--panel-muted))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        {t("Default")}
                      </span>
                    )}
                    {config.is_active && (
                      <span className="rounded-full border border-[hsl(var(--brand))/0.3] bg-[hsl(var(--brand-soft))] px-2 py-0.5 text-xs text-[hsl(var(--brand-strong))]">
                        {t("Active")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    <span>
                      {t("Provider")}: {config.provider}
                    </span>
                    {config.model && (
                      <span>
                        {t("Model")}: {config.model}
                      </span>
                    )}
                    {showDimensions && config.dimensions && (
                      <span>
                        {t("Dimensions")}: {config.dimensions}
                      </span>
                    )}
                    {showVoice && config.voice && (
                      <span>
                        {t("Voice")}: {config.voice}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!config.is_active && (
                  <button
                    onClick={() => setActive(config.id)}
                    className="rounded-lg px-3 py-1.5 text-sm text-[hsl(var(--brand))] transition-colors hover:bg-[hsl(var(--brand-soft))]"
                  >
                    {t("Set Active")}
                  </button>
                )}
                {!isSearchConfig && (
                  <button
                    onClick={() => testConnection(config)}
                    disabled={testing === config.id}
                    className="rounded-lg px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
                  >
                    {testing === config.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      t("Test")
                    )}
                  </button>
                )}
                {!config.is_default && (
                  <button
                    onClick={() => {
                      setEditingConfig(config);
                      setShowAddForm(false);
                    }}
                    className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))]"
                    title={t("Edit")}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                {!config.is_default && (
                  <button
                    onClick={() => deleteConfig(config.id)}
                    className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    title={t("Delete")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {configs.length === 0 && (
            <div className="text-center py-8 text-[hsl(var(--muted-foreground))]">
            {t("No configurations found. Add one to get started.")}
          </div>
        )}
      </div>
    </div>
  );
}
