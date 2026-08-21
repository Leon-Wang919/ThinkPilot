import { expect, test } from "@playwright/test";

test("guide topic mode requires a ready knowledge base and a topic", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith("/knowledge/list")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            name: "broken_kb",
            is_default: false,
            statistics: {
              status: "error",
              rag_initialized: false,
              rag_provider: null,
              progress: { error: "index build failed" },
            },
          },
          {
            name: "stats_kb",
            is_default: true,
            statistics: {
              status: "ready",
              rag_initialized: true,
              rag_provider: "llamaindex",
              progress: { message: "Ready" },
            },
          },
        ]),
      });
      return;
    }

    if (url.pathname.endsWith("/settings")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: "light",
          language: "en",
          sidebar_collapsed: false,
          sidebar_description: "Your description",
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/settings/sidebar")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collapsed: false,
          description: "Your description",
          nav_order: {
            start: ["/", "/history"],
            learnResearch: ["/guide", "/question"],
          },
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/guide/create_session")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          session_id: "guide123",
          kb_name: "stats_kb",
          mode: "topic",
          topic: "Likelihood",
          total_points: 1,
          knowledge_points: [
            {
              knowledge_title: "Likelihood",
              knowledge_summary: "A summary",
              user_difficulty: "A difficulty",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname.includes("/health")) {
      const service = url.pathname.split("/").at(-2) || "service";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "healthy", service }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  await page.goto("/guide");

  const createButton = page.getByRole("button", {
    name: /Topic Mode requires a knowledge point or chapter name/i,
  });
  await expect(createButton).toBeDisabled();

  await page.getByPlaceholder(/knowledge point, chapter, or topic/i).fill(
    "Likelihood",
  );
  await expect(
    page.getByRole("button", { name: /Create Learning Plan/i }),
  ).toBeEnabled();
});

test("guide curriculum mode does not require topic and blocks broken knowledge bases", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith("/knowledge/list")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            name: "broken_kb",
            is_default: true,
            statistics: {
              status: "error",
              rag_initialized: false,
              rag_provider: null,
              progress: { error: "index build failed" },
            },
          },
        ]),
      });
      return;
    }

    if (url.pathname.endsWith("/settings")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: "light",
          language: "en",
          sidebar_collapsed: false,
          sidebar_description: "Your description",
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/settings/sidebar")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collapsed: false,
          description: "Your description",
          nav_order: {
            start: ["/", "/history"],
            learnResearch: ["/guide", "/question"],
          },
        }),
      });
      return;
    }

    if (url.pathname.includes("/health")) {
      const service = url.pathname.split("/").at(-2) || "service";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "healthy", service }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  await page.goto("/guide");
  await page.getByRole("button", { name: /Curriculum Mode/i }).click();

  await expect(
    page.getByText(/This knowledge base failed to initialize|This knowledge base is not ready yet/i).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /This knowledge base failed to initialize|This knowledge base is not ready yet/i,
    }),
  ).toBeDisabled();
});
