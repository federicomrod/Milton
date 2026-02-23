import { test, expect } from "@playwright/test";

test.describe("Smoke: Dashboard", () => {
  test("unauthenticated visit redirects to login without adding URL params", async ({
    page,
  }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    // Should be redirected away from /dashboard
    expect(page.url()).not.toContain("/dashboard");

    // Should land on login/auth page
    const url = page.url();
    expect(url).toMatch(/\/(auth\/login|login|auth)/);

    // The redirect target must never carry date-range query params
    expect(url).not.toContain("period=");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
  });

  test("authenticated dashboard has no date-range query params in URL", async ({
    page,
  }) => {
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;

    if (!email || !password) {
      test.skip(
        true,
        "TEST_EMAIL / TEST_PASSWORD not set — skipping auth test"
      );
      return;
    }

    // Log in
    await page.goto("/auth/login", { waitUntil: "networkidle" });
    await page
      .getByLabel(/^email$/i)
      .or(page.locator('input[type="email"]'))
      .fill(email);
    await page
      .getByLabel(/password/i)
      .or(page.locator('input[type="password"]'))
      .fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();

    // Wait to land on dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // URL must be clean — no query params from date range
    const url = page.url();
    expect(url).not.toContain("period=");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");

    // Loading spinner must not be visible once loaded
    await expect(page.getByText("Loading dashboard...")).not.toBeVisible();

    // KPIs section heading must appear (not empty/placeholder state)
    await expect(
      page.getByRole("heading", { name: /key performance indicators/i })
    ).toBeVisible();
  });
});
