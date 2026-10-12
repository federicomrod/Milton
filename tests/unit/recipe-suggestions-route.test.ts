import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const routeSrc = readFileSync(
  join(process.cwd(), "app/api/restaurant/recipes/suggestions/route.ts"),
  "utf8"
);

describe("POST /api/restaurant/recipes/suggestions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the signed-in company and never reads company_id from the request", () => {
    expect(routeSrc).toContain("authAndCompany");
    expect(routeSrc).toContain("runRecipeSuggestionsForCompany");
    expect(routeSrc).not.toMatch(/form\.get\(["']company_id["']\)/);
    expect(routeSrc).not.toMatch(/searchParams\.get\(["']company_id["']\)/);
  });

  it("keeps ranking and coverage on the server", () => {
    expect(routeSrc).toContain("runRecipeSuggestionsForCompany(auth.supabase");
    expect(routeSrc).not.toMatch(/coverage_pct\s*[+\-*/]/);
  });

  it("returns 401 when nobody is signed in", async () => {
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        }),
      }),
    }));
    const runSpy = vi.fn();
    vi.doMock("@/lib/restaurant/recipe-suggestion-server", () => ({
      runRecipeSuggestionsForCompany: runSpy,
    }));
    vi.doMock("@/lib/restaurant/currency", () => ({
      resolveCompanyCurrency: vi.fn(),
    }));
    vi.doMock("@/lib/restaurant/language", () => ({
      resolveRestaurantCockpitLanguage: () => "es",
    }));
    vi.doMock("@/lib/restaurant/cost-workbook", () => ({
      createDefaultWorkbookAi: () => ({}),
      isWorkbookLimitError: () => false,
    }));

    const { POST } =
      await import("@/app/api/restaurant/recipes/suggestions/route");
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "recetas.xlsx"));
    const response = await POST(
      new Request("http://localhost/api/restaurant/recipes/suggestions", {
        method: "POST",
        body: form,
      }) as never
    );
    expect(response.status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("passes the auth company id, not a form company id", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      ok: true,
      batch_id: "b1",
      suggested: 0,
      skipped: 0,
      sin_sugerencia: 0,
      items: [],
      skips: [],
      net_sales: 0,
      coverage_pct: 0,
      product_count: 0,
    });
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {},
        companyId: "company-123",
        userId: "user-1",
      }),
    }));
    vi.doMock("@/lib/restaurant/recipe-suggestion-server", () => ({
      runRecipeSuggestionsForCompany: runSpy,
    }));
    vi.doMock("@/lib/restaurant/currency", () => ({
      resolveCompanyCurrency: vi.fn().mockResolvedValue("USD"),
    }));
    vi.doMock("@/lib/restaurant/language", () => ({
      resolveRestaurantCockpitLanguage: () => "es",
    }));
    vi.doMock("@/lib/restaurant/cost-workbook", () => ({
      createDefaultWorkbookAi: () => ({ id: "ai" }),
      isWorkbookLimitError: () => false,
    }));

    const { POST } =
      await import("@/app/api/restaurant/recipes/suggestions/route");
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "recetas.xlsx"));
    form.set("company_id", "other");
    form.set("limit", "5");
    form.set("odoo_product_id", "12");
    const response = await POST(
      new Request("http://localhost/api/restaurant/recipes/suggestions", {
        method: "POST",
        body: form,
      }) as never
    );
    expect(response.status).toBe(200);
    expect(runSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        companyId: "company-123",
        limit: 5,
        odooProductId: 12,
      })
    );
  });
});
