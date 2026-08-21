"use client";

import {
  Brain,
  Database,
  Volume2,
  Search,
  Check,
  AlertCircle,
  Server,
  RefreshCw,
} from "lucide-react";
import { FullStatus, PortsInfo, ConfigType } from "../types";

interface OverviewTabProps {
  status: FullStatus | null;
  ports: PortsInfo | null;
  onRefresh: () => void;
  t: (key: string) => string;
}

const services: {
  key: ConfigType;
  label: string;
  icon: typeof Brain;
  color: string;
}[] = [
  { key: "llm", label: "LLM", icon: Brain, color: "purple" },
  { key: "embedding", label: "Embedding", icon: Database, color: "indigo" },
  { key: "tts", label: "TTS", icon: Volume2, color: "emerald" },
  { key: "search", label: "Search", icon: Search, color: "amber" },
];

export default function OverviewTab({
  status,
  ports,
  onRefresh,
  t,
}: OverviewTabProps) {
  return (
    <div className="p-6 space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--brand))] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t("Refresh")}
        </button>
      </div>

      {/* Service Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((service) => {
          const s = status?.[service.key];
          const Icon = service.icon;
          const isConfigured = s?.configured;

          return (
            <div
              key={service.key}
              className={`rounded-xl border p-4 ${
                isConfigured
                  ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                  : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-lg p-2 ${
                      isConfigured
                        ? "bg-emerald-100 dark:bg-emerald-950/40"
                        : "bg-[hsl(var(--panel-muted))] dark:bg-[hsl(var(--panel-muted))]"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 ${
                        isConfigured
                          ? "text-emerald-600 dark:text-emerald-300"
                          : "text-[hsl(var(--muted-foreground))]"
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[hsl(var(--foreground))]">
                        {service.label}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          isConfigured
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {isConfigured ? t("Configured") : t("Not Configured")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      {s?.active_config_name || t("Not configured")}
                    </p>
                  </div>
                </div>
                {isConfigured ? (
                  <Check className="w-5 h-5 text-emerald-500 dark:text-emerald-300" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                )}
              </div>
              {s?.model && (
                <div className="mt-3 border-t border-[hsl(var(--panel-border))] pt-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {t("Model")}:
                    </span>
                    <span className="font-mono text-[hsl(var(--foreground))]">
                      {s.model}
                    </span>
                  </div>
                  {s.provider && (
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {t("Provider")}:
                      </span>
                      <span className="text-[hsl(var(--foreground))]">
                        {s.provider}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Port Information */}
      {ports && (
        <div className="rounded-xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Server className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
            <h3 className="font-semibold text-[hsl(var(--foreground))]">
              {t("Port Configuration")}
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("Backend Port")}
              </span>
              <p className="font-mono text-lg text-[hsl(var(--foreground))]">
                {ports.backend_port}
              </p>
            </div>
            <div>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {t("Frontend Port")}
              </span>
              <p className="font-mono text-lg text-[hsl(var(--foreground))]">
                {ports.frontend_port}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
