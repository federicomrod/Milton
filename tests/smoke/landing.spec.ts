import { test, expect } from "@playwright/test";

test.describe("Smoke: Landing Page", () => {
  test("should load landing page with hero section and CTA button", async ({
    page,
  }) => {
    // Navigate to the landing page
    await page.goto("/", { waitUntil: "networkidle" });

    // Wait for the page to be interactive - this ensures AppNavigation auth check completes
    await page.waitForLoadState("domcontentloaded");

    // Check hero heading
    await expect(
      page.getByRole("heading", { name: /your ai finance co-pilot/i })
    ).toBeVisible();

    // Check subheading
    await expect(
      page.getByRole("heading", { name: /for startups/i })
    ).toBeVisible();

    // Check hero description text
    await expect(
      page.getByText(/milton transforms your financial data/i)
    ).toBeVisible();

    // Check "Get started" button in hero section
    const getStartedButton = page
      .getByRole("button", { name: /get started/i })
      .first(); // First occurrence (hero section)

    await expect(getStartedButton).toBeVisible();

    // Check "Sign in" button
    await expect(
      page.getByRole("button", { name: /sign in/i }).first()
    ).toBeVisible();

    // Check features section is visible
    await expect(
      page.getByRole("heading", { name: /everything you need to master/i })
    ).toBeVisible();

    // Check footer branding
    await expect(page.getByText(/milton/i).first()).toBeVisible();
  });
});
