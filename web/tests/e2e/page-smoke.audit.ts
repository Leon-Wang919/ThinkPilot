import { expect, test } from "@playwright/test";

const DEFAULT_PAGES = [
  "/",
  "/history",
  "/knowledge-notebook",
  "/teacher",
  "/solver",
  "/notebook",
  "/settings",
];

const LEARNING_PAGES = ["/feynman", "/guide", "/question"];

function mockApi(pathname: string) {
  if (pathname.endsWith("/knowledge/list")) {
    return [{ name: "demo-kb", is_default: true }];
  }
  if (pathname.endsWith("/dashboard/recent")) {
    return [];
  }
  if (pathname.endsWith("/chat/sessions") || pathname.endsWith("/solve/sessions")) {
    return [];
  }
  if (pathname.endsWith("/notebook/list")) {
    return [];
  }
  if (pathname.endsWith("/settings")) {
    return {
      theme: "light",
      language: "en",
      sidebar_collapsed: false,
      sidebar_description: "Your description",
    };
  }
  if (pathname.endsWith("/settings/sidebar")) {
    return {
      collapsed: false,
      description: "Your description",
      nav_order: {
        start: ["/", "/knowledge", "/notebook"],
        learnResearch: ["/teacher", "/feynman", "/question", "/settings"],
      },
    };
  }
  if (pathname.endsWith("/teacher/knowledge-bases")) {
    return {
      subject: "science",
      default_kb: "demo-kb",
      knowledge_bases: [
        {
          name: "demo-kb",
          subject: "science",
          is_default: true,
          statistics: { rag_initialized: true },
        },
      ],
    };
  }
  if (pathname.endsWith("/config/status")) {
    return {
      backend: { status: "online", timestamp: new Date().toISOString() },
      llm: { status: "not_configured", model: null, testable: false },
      embeddings: { status: "not_configured", model: null, testable: false },
      tts: { status: "not_configured", model: null, testable: false },
    };
  }
  if (pathname.endsWith("/config/ports")) {
    return { backend_port: 8001, frontend_port: 3782 };
  }
  if (pathname.endsWith("/knowledge/health")) {
    return { status: "healthy", service: "knowledge" };
  }
  if (pathname.includes("/health")) {
    const service = pathname.split("/").at(-2) || "service";
    return { status: "healthy", service };
  }
  return {};
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mockApi(url.pathname)),
    });
  });
});

for (const path of [...DEFAULT_PAGES, ...LEARNING_PAGES]) {
  test(`page smoke ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });
}
