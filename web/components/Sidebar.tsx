"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Clock,
  GraduationCap,
  Github,
  Home,
  LucideIcon,
  PanelLeft,
  PenTool,
  Settings,
  Sparkles,
} from "lucide-react";
import { useGlobal } from "@/context/GlobalContext";
import { getModuleStatus } from "@/lib/module-status";

const SIDEBAR_EXPANDED_WIDTH = 308;
const SIDEBAR_COLLAPSED_WIDTH = 88;

interface NavItemConfig {
  icon: LucideIcon;
  nameKey: string;
  group: "workspace" | "learning";
  badge?: string;
}

interface NavGroup {
  id: "workspace" | "learning";
  name: string;
  items: Array<{
    href: string;
    name: string;
    icon: LucideIcon;
    badge?: string;
    status: "promoted" | "experimental" | "repo-only";
  }>;
}

const NAV_ITEMS: Record<string, NavItemConfig> = {
  "/": { icon: Home, nameKey: "Home", group: "workspace" },
  "/solver": {
    icon: PenTool,
    nameKey: "Smart Solver",
    group: "learning",
  },
  "/smart-review": {
    icon: Brain,
    nameKey: "Error Review",
    group: "learning",
  },
  "/feynman": {
    icon: Sparkles,
    nameKey: "Feynman Assessment",
    group: "learning",
  },
  "/knowledge": {
    icon: BookOpen,
    nameKey: "Knowledge Base Manager",
    group: "learning",
  },
  "/history": {
    icon: Clock,
    nameKey: "History",
    group: "workspace",
  },
};

const GROUP_ICONS: Record<NavGroup["id"], LucideIcon> = {
  workspace: Home,
  learning: GraduationCap,
};

export default function Sidebar() {
  const pathname = usePathname();
  const currentGroupId = NAV_ITEMS[pathname]?.group ?? "workspace";
  const { sidebarCollapsed, toggleSidebar } = useGlobal();
  const { t } = useTranslation();

  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<
    Record<NavGroup["id"], boolean>
  >({
    workspace: true,
    learning: currentGroupId === "learning",
  });

  const navGroups = useMemo((): NavGroup[] => {
    const groupOrder: NavGroup["id"][] = ["workspace", "learning"];

    return groupOrder
      .map((groupId) => {
        const items = Object.entries(NAV_ITEMS)
          .filter(([href, config]) => {
            if (config.group !== groupId) {
              return false;
            }

            return getModuleStatus(href).status !== "repo-only";
          })
          .map(([href, config]) => {
            const moduleStatus = getModuleStatus(href);

            return {
              href,
              name: t(config.nameKey),
              icon: config.icon,
              badge:
                moduleStatus.status === "experimental"
                  ? t("Experimental")
                  : config.badge,
              status: moduleStatus.status,
            };
          });

        const names: Record<NavGroup["id"], string> = {
          workspace: t("Workspace"),
          learning: t("Learning"),
        };

        return {
          id: groupId,
          name: names[groupId],
          items,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [t]);

  const currentWidth = sidebarCollapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : SIDEBAR_EXPANDED_WIDTH;

  const handleToggleSidebar = () => {
    setShowTooltip(null);
    toggleSidebar();
  };

  const toggleGroup = (groupId: NavGroup["id"]) => {
    setExpandedGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }));
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-muted))/0.72] transition-all duration-300"
      style={{ width: currentWidth }}
    >
      <div className="px-3 pb-2 pt-3">
        <div className="rounded-[28px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] shadow-[0_20px_58px_-42px_rgba(15,23,42,0.48)] backdrop-blur">
          <div
            className={`flex items-center ${sidebarCollapsed ? "justify-center px-3 py-4" : "gap-3 px-4 py-4"}`}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[hsl(var(--panel-border))] bg-white shadow-sm dark:bg-zinc-900">
              <Image
                src="/logo.png"
                alt={t("ThinkPilot Logo")}
                width={36}
                height={36}
                className="object-cover"
              />
            </div>

            {!sidebarCollapsed ? (
              <>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[16px] font-semibold tracking-[0.02em] text-[hsl(var(--foreground))]">
                    {t("ThinkPilot")}
                  </h1>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[hsl(var(--muted-foreground))]">
                    {navGroups.find((group) => group.id === currentGroupId)?.name ??
                      t("Workspace")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSidebar}
                  className="rounded-2xl border border-transparent p-2 text-[hsl(var(--muted-foreground))] transition-all duration-200 hover:border-[hsl(var(--panel-border))] hover:bg-[hsl(var(--panel-muted))/0.72] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28]"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {navGroups.map((group) => {
          const GroupIcon = GROUP_ICONS[group.id];
          const isGroupActive = group.items.some((item) => pathname === item.href);
          const isGroupOpen =
            sidebarCollapsed ||
            expandedGroups[group.id] ||
            group.id === currentGroupId;

          return (
            <section
              key={group.id}
              className={`mb-6 last:mb-0`}
            >
              {!sidebarCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1 mb-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28] hover:text-[hsl(var(--foreground))]`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium tracking-wide text-[hsl(var(--muted-foreground))] transition-colors group-hover:text-[hsl(var(--foreground))]">
                      {group.name}
                    </div>
                  </div>
                  {isGroupOpen ? (
                    <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))/0.5]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))/0.5]" />
                  )}
                </button>
              ) : null}

              {isGroupOpen ? (
                <div className={`${sidebarCollapsed ? "space-y-1" : "space-y-0.5 px-2"}`}>
                  {group.items.map((item) => {
                    const isActive = pathname === item.href;

                    return (
                      <div key={item.href} className="relative">
                        <Link
                          href={item.href}
                          onMouseEnter={() =>
                            sidebarCollapsed && setShowTooltip(item.href)
                          }
                          onMouseLeave={() => setShowTooltip(null)}
                          className={`group relative flex items-center rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28] ${
                            sidebarCollapsed
                              ? "justify-center p-3"
                              : "gap-3 px-3 py-2"
                          } ${
                            isActive
                              ? "bg-[hsl(var(--brand-soft))/0.6] text-[hsl(var(--brand-strong))] font-medium backdrop-blur-sm"
                              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--panel-muted))] hover:text-[hsl(var(--foreground))]"
                          }`}
                        >
                          {isActive ? (
                            <span
                              className={`absolute rounded-full bg-[hsl(var(--brand))] ${
                                sidebarCollapsed
                                  ? "bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2"
                                  : "left-1.5 top-1/2 h-9 w-1 -translate-y-1/2"
                              }`}
                            />
                          ) : null}

                          <item.icon
                            strokeWidth={isActive ? 2.45 : 2}
                            className={`relative z-10 shrink-0 ${
                              sidebarCollapsed ? "h-5 w-5" : "h-[18px] w-[18px]"
                            } ${
                              isActive
                                ? "text-[hsl(var(--brand))]"
                                : "text-[hsl(var(--muted-foreground))] transition-colors group-hover:text-[hsl(var(--foreground))]"
                            }`}
                          />

                          {!sidebarCollapsed ? (
                            <>
                              <span className="relative z-10 min-w-0 flex-1 truncate text-[14px] font-medium">
                                {item.name}
                              </span>
                              {item.badge ? (
                                <span
                                  className={`relative z-10 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                    isActive
                                      ? "border-[hsl(var(--brand))/0.16] bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand))]"
                                      : "border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.92] text-[hsl(var(--muted-foreground))]"
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </Link>

                        {sidebarCollapsed && showTooltip === item.href ? (
                          <div className="absolute left-full top-1/2 z-50 ml-3 min-w-[148px] -translate-y-1/2 rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2.5 text-xs text-[hsl(var(--foreground))] shadow-[0_22px_60px_-34px_rgba(15,23,42,0.52)]">
                            <div className="font-semibold">{item.name}</div>
                            {item.badge ? (
                              <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                                {item.badge}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>

      <div className="px-3 pb-3 pt-2">
        <div className="rounded-[26px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))/0.9] p-2 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.36)] backdrop-blur">
          <div className="relative">
            <Link
              href="/settings"
              onMouseEnter={() =>
                sidebarCollapsed && setShowTooltip("/settings")
              }
              onMouseLeave={() => setShowTooltip(null)}
              className={`group relative flex items-center overflow-hidden rounded-[20px] border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28] ${
                sidebarCollapsed
                  ? "justify-center px-2.5 py-3"
                  : "gap-3 px-3.5 py-3"
              } ${
                pathname === "/settings"
                  ? "border-[hsl(var(--brand))/0.18] bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-strong))] shadow-[0_16px_34px_-28px_rgba(37,99,235,0.55)]"
                  : "border-transparent text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--panel-border))] hover:bg-[hsl(var(--panel-muted))/0.74] hover:text-[hsl(var(--foreground))]"
              }`}
            >
              {pathname === "/settings" ? (
                <span
                  className={`absolute rounded-full bg-[hsl(var(--brand))] ${
                    sidebarCollapsed
                      ? "bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2"
                      : "left-1.5 top-1/2 h-9 w-1 -translate-y-1/2"
                  }`}
                />
              ) : null}

              <Settings
                strokeWidth={pathname === "/settings" ? 2.45 : 2}
                className={`relative z-10 shrink-0 ${
                  sidebarCollapsed ? "h-5 w-5" : "h-[18px] w-[18px]"
                } ${
                  pathname === "/settings"
                    ? "text-[hsl(var(--brand))]"
                    : "text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]"
                }`}
              />

              {!sidebarCollapsed ? (
                <div className="relative z-10 min-w-0 flex-1 text-[14px] font-medium">
                  {t("Settings")}
                </div>
              ) : null}
            </Link>

            {sidebarCollapsed && showTooltip === "/settings" ? (
              <div className="absolute left-full top-1/2 z-50 ml-3 min-w-[148px] -translate-y-1/2 rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] shadow-[0_22px_60px_-34px_rgba(15,23,42,0.52)]">
                {t("Settings")}
              </div>
            ) : null}
          </div>

          <div className="relative mt-2 border-t border-[hsl(var(--panel-border))/0.9] pt-2">
            <a
              href="https://github.com/Leon-Wang919/ThinkPilot"
              target="_blank"
              rel="noreferrer"
              aria-label={t("Source Code")}
              onMouseEnter={() =>
                sidebarCollapsed && setShowTooltip("source-code")
              }
              onMouseLeave={() => setShowTooltip(null)}
              className={`group flex items-center rounded-[20px] border border-transparent text-[hsl(var(--muted-foreground))] transition-all duration-200 hover:border-[hsl(var(--panel-border))] hover:bg-[hsl(var(--panel-muted))/0.72] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28] ${
                sidebarCollapsed
                  ? "justify-center px-2.5 py-3"
                  : "gap-3 px-3.5 py-3"
              }`}
            >
              <Github className="h-[18px] w-[18px] shrink-0" />
              {!sidebarCollapsed ? (
                <span className="text-[14px] font-medium">
                  {t("Source Code")}
                </span>
              ) : null}
            </a>

            {sidebarCollapsed && showTooltip === "source-code" ? (
              <div className="absolute left-full top-1/2 z-50 ml-3 min-w-[148px] -translate-y-1/2 rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] shadow-[0_22px_60px_-34px_rgba(15,23,42,0.52)]">
                {t("Source Code")}
              </div>
            ) : null}
          </div>

          {sidebarCollapsed ? (
            <div className="mt-2 border-t border-[hsl(var(--panel-border))/0.9] pt-2">
              <button
                type="button"
                onClick={handleToggleSidebar}
                className="flex w-full justify-center rounded-[20px] border border-transparent px-2 py-3 text-[hsl(var(--muted-foreground))] transition-all duration-200 hover:border-[hsl(var(--panel-border))] hover:bg-[hsl(var(--panel-muted))/0.72] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand))/0.28]"
              >
                <ChevronsRight className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
