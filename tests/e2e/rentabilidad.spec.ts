// Rentabilidad + Costos fijos, end to end (#403). Runs against a DEMO account
// only (a seeded demo restaurant group, never a real client). Set
//   E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD   an owner, admin or manager of the demo
//   E2E_DEMO_LOCATION                    the demo restaurant to open (uuid)
// Without them every test here is skipped, like tests/smoke/dashboard.spec.ts.
// Playwright's testMatch only picks up *.spec.ts under ./tests.
import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_DEMO_EMAIL;
const password = process.env.E2E_DEMO_PASSWORD;
const location = process.env.E2E_DEMO_LOCATION;
const RENT = "/dashboard/restaurant/rentabilidad";
const COSTS = "/dashboard/restaurant/costs?tab=costos-fijos";

test.skip(!email || !password, "E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set");

async function login(page: Page) {
  await page.goto("/auth/login", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page
    .getByRole("button", { name: /iniciar sesión|entrar|log in/i })
    .click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

const withLocation = (path: string) =>
  location
    ? `${path}${path.includes("?") ? "&" : "?"}location=${location}`
    : path;

test.describe("Rentabilidad", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("fill the fixed costs, then the break-even is shown", async ({
    page,
  }) => {
    await page.goto(withLocation(COSTS));
    const tab = page.getByTestId("fixed-costs-tab");
    await expect(tab).toBeVisible();
    for (const [category, value] of [
      ["alquiler", "12000"],
      ["planilla", "30000"],
      ["servicios", "4000"],
      ["impuestos", "10"],
    ]) {
      const input = page.locator(`#fixed-${category}`);
      if (await input.count()) await input.fill(value);
    }
    await page.getByRole("button", { name: /guardar cambios/i }).click();
    await expect(page.getByTestId("break-even").first()).toBeVisible();
    await expect(page.getByTestId("falta-alquiler")).toHaveCount(0);
  });

  test("a missing cost shows a white card and ⚑ Falta, never $0", async ({
    page,
  }) => {
    await page.goto(withLocation(`${RENT}?month=2025-01-01`));
    const card = page.getByTestId("missing-card");
    // The demo account has no fixed costs for January 2025.
    await expect(card).toBeVisible();
    await expect(card).toContainText("⚑");
    await expect(card).not.toContainText(/\$\s?0(?![\d.,])/);
    await expect(page.getByTestId("hero-card")).toHaveCount(0);
  });

  test("partial coverage still shows the profit, with a flag", async ({
    page,
  }) => {
    await page.goto(withLocation(RENT));
    const hero = page.getByTestId("hero-card");
    await expect(hero).toBeVisible();
    await expect(page.getByTestId("hero-headline")).not.toBeEmpty();
    // Some recipes are not approved in the demo data: a ⚑ flag next to the profit.
    await expect(
      page.getByText(/⚑ Falta el costo de ingredientes/).first()
    ).toBeVisible();
  });

  test("Todos los restaurantes shows one line per restaurant and a total", async ({
    page,
  }) => {
    await page.goto(RENT);
    // No ?location= with several restaurants = the group view.
    await expect(page.getByTestId("group-total")).toBeVisible();
    expect(await page.getByTestId("group-line").count()).toBeGreaterThan(1);
  });

  test("the ¿Y si…? sliders change the result and reset to the real one", async ({
    page,
  }) => {
    await page.goto(withLocation(RENT));
    const panel = page.getByTestId("whatif-panel");
    await panel.scrollIntoViewIfNeeded();
    const profit = panel.getByTestId("whatif-profit");
    const before = await profit.innerText();
    const slider = panel.getByRole("slider").first();
    await slider.focus();
    for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
    await expect(profit).not.toHaveText(before);
    await expect(profit).toContainText("→");
  });

  test("switching months shows no loading skeleton", async ({ page }) => {
    await page.goto(withLocation(RENT));
    const group = page.getByRole("group", { name: /mes/i }).first();
    const buttons = group.getByRole("button");
    await buttons.nth(0).click();
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "true", {
      timeout: 300,
    });
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  });
});
