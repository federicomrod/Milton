import { test, expect } from "@playwright/test";

test.describe("Smoke: Auth / onboarding", () => {
  test("get started navigates to create account page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForLoadState("domcontentloaded");

    const getStarted = page
      .getByRole("button", { name: /get started/i })
      .or(page.getByRole("link", { name: /get started/i }))
      .first();

    await expect(getStarted).toBeVisible();
    await getStarted.click();

    await expect(page.getByText("Create an account")).toBeVisible();

    // Fields: try label first, then placeholder fallback
    await expect(
      page.getByLabel(/company name/i).or(page.getByPlaceholder(/acme/i))
    ).toBeVisible();

    await expect(
      page.getByLabel(/^email$/i).or(page.getByPlaceholder(/you@company\.com/i))
    ).toBeVisible();

    await expect(
      page.getByLabel(/password/i).or(page.locator('input[type="password"]'))
    ).toBeVisible();

    await expect(
      page
        .getByRole("button", { name: /create account/i })
        .or(page.getByRole("link", { name: /create account/i }))
        .first()
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /log in/i }).first()
    ).toBeVisible();
  });
});
