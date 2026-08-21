export type ModuleStatus = "promoted" | "experimental" | "repo-only";

export interface ModuleStatusEntry {
  status: ModuleStatus;
  backendMounted: boolean;
}

export const MODULE_STATUS: Record<string, ModuleStatusEntry> = {
  "/": { status: "promoted", backendMounted: true },
  "/history": { status: "promoted", backendMounted: true },
  "/knowledge": { status: "promoted", backendMounted: true },
  "/knowledge-notebook": { status: "repo-only", backendMounted: true },
  "/teacher": { status: "promoted", backendMounted: true },
  "/solver": { status: "promoted", backendMounted: true },
  "/smart-review": { status: "promoted", backendMounted: true },
  "/notebook": { status: "repo-only", backendMounted: true },
  "/settings": { status: "promoted", backendMounted: true },
  "/guide": { status: "promoted", backendMounted: true },
  "/feynman": { status: "promoted", backendMounted: true },
};

export function getModuleStatus(path: string): ModuleStatusEntry {
  return MODULE_STATUS[path] ?? { status: "repo-only", backendMounted: false };
}
