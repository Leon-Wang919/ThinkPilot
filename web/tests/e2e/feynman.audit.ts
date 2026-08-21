import { expect, test } from "@playwright/test";

test("feynman teaching flow supports follow-up and final report", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith("/feynman/turn")) {
      const body = route.request().postDataJSON();
      expect(body.subject).toBe("science");
      const isReport = body.should_continue === false;

      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isReport
            ? {
                response: "# Final Report\nYou explained the intuition well.",
                evaluation: {
                  clarity_score: 8,
                  completeness_score: 7,
                },
                logic_gaps: ["Need a concrete numerical example."],
                is_report: true,
                persona_info: { name: "Curious Student", emoji: "🧑‍🎓" },
              }
            : {
                response: "Can you show me the update rule?",
                evaluation: {
                  clarity_score: 7,
                  completeness_score: 6,
                },
                logic_gaps: ["Update rule not explained."],
                is_report: false,
                persona_info: { name: "Curious Student", emoji: "🧑‍🎓" },
              },
        ),
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
            learnResearch: ["/feynman", "/guide"],
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

  await page.goto("/feynman");

  await page.getByPlaceholder(/Photosynthesis|Machine Learning/i).fill(
    "Gradient descent",
  );
  await page.getByRole("button", { name: /Start Teaching/i }).click();

  await expect(page.getByText(/ready to learn about/i)).toBeVisible();

  await page
    .getByPlaceholder(/Explain the topic in your own words/i)
    .fill("It moves parameters opposite the gradient.");
  await page.getByRole("button", { name: /Send explanation/i }).click();

  await expect(page.getByText(/Can you show me the update rule/i)).toBeVisible();
  await expect(page.getByText(/Update rule not explained/i)).toBeVisible();

  await page.getByRole("button", { name: /End & Get Report/i }).click();

  await expect(page.getByText(/Final Report/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Teach Another Topic/i })).toBeVisible();
  await expect(
    page.getByPlaceholder(/Explain the topic in your own words/i),
  ).toHaveCount(0);
});
