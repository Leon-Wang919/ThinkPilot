"use client";

import SubjectTabs from "@/components/common/SubjectTabs";
import Sidebar from "@/components/Sidebar";

/**
 * AppShell — Two-column layout with integrated Studio tools in left sidebar.
 *
 * ┌──────────┬────────────────────────┐
 * │  Left    │       Center           │
 * │  Sidebar │    Main Content        │
 * │  (Nav +  │    (Chat / Pages)      │
 * │  Studio) │                        │
 * └──────────┴────────────────────────┘
 *
 * - Left: Sidebar with navigation and Studio tools integrated
 * - Center: Page content (children from Next.js router)
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-[hsl(var(--background))] overflow-hidden transition-colors duration-200">
      <Sidebar />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[hsl(var(--panel))]">
        <div className="border-b border-[hsl(var(--panel-border))] bg-[hsl(var(--panel))] z-10 relative">
          <SubjectTabs />
        </div>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
