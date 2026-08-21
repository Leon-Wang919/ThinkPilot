"use client";

import { useState } from "react";
import {
  Plus,
  Check,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  TestTube,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { ConfigItem, ConfigType } from "../types";
import {
  PROVIDER_OPTIONS,
  LOCAL_PROVIDERS,
  LOCAL_PROVIDER_URLS,
  VOICE_OPTIONS,
  getEnvVarForBaseUrl,
  getEnvVarForApiKey,
} from "../constants";

interface ConfigFormProps {
  configType: ConfigType;
  showDimensions: boolean;
  showVoice: boolean;
  isSearchConfig: boolean;
  editConfig?: ConfigItem | null;
  t: (key: string) => string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ConfigForm({
  configType,
  showDimensions,
  showVoice,
  isSearchConfig,
  editConfig,
  t,
  onSuccess,
  onCancel,
}: ConfigFormProps) {
  const isEditMode = !!editConfig;
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Helper to check if a value uses env reference format
  const isEnvReference = (value: any): boolean => {
    return !!(value && typeof value === "object" && "use_env" in value);
  };

  // Helper to get display value
  const getDisplayValue = (value: any): string => {
    if (isEnvReference(value)) return "";
    return typeof value === "string" ? value : "";
  };

  // Check initial env reference states
  const initialUseEnvBaseUrl = editConfig
    ? isEnvReference(editConfig.base_url)
    : false;
  const initialUseEnvApiKey = editConfig
    ? isEnvReference(editConfig.api_key)
    : false;

  // Form state
  const [name, setName] = useState(editConfig?.name || "");
  const [provider, setProvider] = useState(
    editConfig?.provider || PROVIDER_OPTIONS[configType][0],
  );
  const [baseUrl, setBaseUrl] = useState(
    editConfig ? getDisplayValue(editConfig.base_url) : "",
  );
  const [useEnvBaseUrl, setUseEnvBaseUrl] =
    useState<boolean>(initialUseEnvBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [useEnvApiKey, setUseEnvApiKey] =
    useState<boolean>(initialUseEnvApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState(editConfig?.model || "");
  const [dimensions, setDimensions] = useState(editConfig?.dimensions || 3072);
  const [voice, setVoice] = useState(editConfig?.voice || "alloy");

  const isLocalProvider = LOCAL_PROVIDERS.includes(provider);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    if (
      LOCAL_PROVIDERS.includes(newProvider) &&
      LOCAL_PROVIDER_URLS[newProvider]
    ) {
      setBaseUrl(LOCAL_PROVIDER_URLS[newProvider]);
      setUseEnvBaseUrl(false);
      setUseEnvApiKey(false);
      setApiKey("");
    }
  };

  const handleTestConnection = async () => {
    if (isSearchConfig) return;

    if (!useEnvBaseUrl && !baseUrl) {
      setTestResult({
        success: false,
        message: t("Base URL is required for testing"),
      });
      return;
    }
    if (!isLocalProvider && !useEnvApiKey && !apiKey) {
      setTestResult({
        success: false,
        message: t("API Key is required for cloud providers"),
      });
      return;
    }
    if (!model) {
      setTestResult({ success: false, message: t("Model name is required") });
      return;
    }
    if (configType === "embedding" && !dimensions) {
      setTestResult({
        success: false,
        message: t("Dimensions is required for embedding models"),
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(apiUrl(`/api/v1/config/${configType}/test`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          base_url: useEnvBaseUrl
            ? { use_env: getEnvVarForBaseUrl(configType) }
            : baseUrl,
          api_key: isLocalProvider
            ? ""
            : useEnvApiKey
              ? { use_env: getEnvVarForApiKey(configType) }
              : apiKey,
          model,
          ...(configType === "embedding"
            ? { dimensions: Number(dimensions) }
            : {}),
          ...(configType === "tts" && voice ? { voice } : {}),
        }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success ?? false,
        message:
          data.message ||
          (data.success ? t("Connection successful") : t("Connection failed")),
      });
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e?.message || t("Connection test failed - network error"),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload: Record<string, any> = {
        name,
        provider,
        api_key: isLocalProvider
          ? apiKey || ""
          : useEnvApiKey
            ? { use_env: getEnvVarForApiKey(configType) }
            : apiKey,
      };

      if (!isSearchConfig) {
        payload.base_url = useEnvBaseUrl
          ? { use_env: getEnvVarForBaseUrl(configType) }
          : baseUrl;
        payload.model = model;
      }

      if (showDimensions) {
        payload.dimensions = dimensions;
      }

      if (showVoice) {
        payload.voice = voice;
      }

      const url = isEditMode
        ? apiUrl(`/api/v1/config/${configType}/${editConfig.id}`)
        : apiUrl(`/api/v1/config/${configType}`);
      const method = isEditMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(
          data.detail ||
            (isEditMode
              ? t("Failed to update configuration")
              : t("Failed to add configuration")),
        );
      }
    } catch (e) {
      setError(
        isEditMode
          ? t("Failed to update configuration")
          : t("Failed to add configuration"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] p-4"
    >
      <h3 className="font-medium text-[hsl(var(--foreground))] mb-4">
        {isEditMode
          ? `${t("Edit Configuration")}: ${editConfig.name}`
          : t("Add New Configuration")}
      </h3>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
            {t("Name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={t("My Configuration")}
            className="w-full rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-transparent focus:ring-2 focus:ring-[hsl(var(--brand))]"
          />
        </div>

        {/* Provider */}
        <div>
          <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
            {t("Provider")}
          </label>
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full appearance-none rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-transparent focus:ring-2 focus:ring-[hsl(var(--brand))]"
            >
              {PROVIDER_OPTIONS[configType].map((p) => (
                <option key={p} value={p}>
                  {p}
                  {LOCAL_PROVIDERS.includes(p) ? ` (${t("local")})` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          </div>
        </div>

        {/* Base URL (not for search) */}
        {!isSearchConfig && (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              {t("Base URL")}
              {useEnvBaseUrl && (
                <span className="ml-2 text-xs font-normal text-[hsl(var(--brand))]">
                  (using ${getEnvVarForBaseUrl(configType)})
                </span>
              )}
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={useEnvBaseUrl ? "" : baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  disabled={useEnvBaseUrl}
                  placeholder={
                    useEnvBaseUrl
                      ? `Using ${getEnvVarForBaseUrl(configType)} from .env`
                      : "https://api.openai.com/v1"
                  }
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[hsl(var(--brand))] focus:border-transparent ${
                    useEnvBaseUrl
                    ? "border-[hsl(var(--brand))/0.3] bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-strong))] italic"
                      : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--foreground))]"
                  }`}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={useEnvBaseUrl}
                  onChange={(e) => {
                    setUseEnvBaseUrl(e.target.checked);
                    if (e.target.checked) setBaseUrl("");
                  }}
                  className="rounded border-[hsl(var(--panel-border))] text-[hsl(var(--brand))] focus:ring-[hsl(var(--brand))]"
                />
                {t("Use .env")}
              </label>
            </div>
          </div>
        )}

        {/* API Key */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
            {t("API Key")}
            {isLocalProvider ? (
              <span className="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                ({t("optional for local providers")})
              </span>
            ) : useEnvApiKey ? (
              <span className="ml-2 text-xs font-normal text-[hsl(var(--brand))]">
                (using ${getEnvVarForApiKey(configType)})
              </span>
            ) : null}
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={useEnvApiKey ? "" : apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={useEnvApiKey}
                placeholder={
                  isLocalProvider
                    ? t("Not required")
                    : useEnvApiKey
                      ? `Using ${getEnvVarForApiKey(configType)} from .env`
                      : "sk-..."
                }
                className={`w-full px-3 py-2 pr-10 border rounded-lg text-sm focus:ring-2 focus:ring-[hsl(var(--brand))] focus:border-transparent ${
                  useEnvApiKey
                    ? "border-[hsl(var(--brand))/0.3] bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-strong))] italic"
                    : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] text-[hsl(var(--foreground))]"
                }`}
              />
              {!useEnvApiKey && (
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  {showApiKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
            {!isLocalProvider && (
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={useEnvApiKey}
                  onChange={(e) => {
                    setUseEnvApiKey(e.target.checked);
                    if (e.target.checked) setApiKey("");
                  }}
                  className="rounded border-[hsl(var(--panel-border))] text-[hsl(var(--brand))] focus:ring-[hsl(var(--brand))]"
                />
                {t("Use .env")}
              </label>
            )}
          </div>
        </div>

        {/* Model (not for search) */}
        {!isSearchConfig && (
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              {t("Model")}
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              placeholder={t("gpt-4o")}
              className="w-full rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-transparent focus:ring-2 focus:ring-[hsl(var(--brand))]"
            />
          </div>
        )}

        {/* Dimensions (embedding only) */}
        {showDimensions && (
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              {t("Dimensions")}
            </label>
            <input
              type="number"
              value={Number.isNaN(dimensions) ? "" : dimensions}
              onChange={(e) => setDimensions(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-transparent focus:ring-2 focus:ring-[hsl(var(--brand))]"
            />
          </div>
        )}

        {/* Voice (TTS only) */}
        {showVoice && (
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              {t("Voice")}
            </label>
            <div className="relative">
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="w-full appearance-none rounded-lg border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-transparent focus:ring-2 focus:ring-[hsl(var(--brand))]"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))] pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mt-4">
        <div>
          {!isSearchConfig && (
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || (!baseUrl && !useEnvBaseUrl)}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--panel-muted))] disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              {t("Test Connection")}
            </button>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[hsl(var(--brand))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[hsl(var(--brand-strong))] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isEditMode ? (
              <Check className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {isEditMode ? t("Save Changes") : t("Add Configuration")}
          </button>
        </div>
      </div>
    </form>
  );
}
