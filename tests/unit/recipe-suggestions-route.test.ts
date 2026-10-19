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

  function mockSignedIn(role: string, runSpy: ReturnType<typeof vi.fn>) {
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {},
        companyId: "company-123",
        userId: "user-1",
      }),
    }));
    vi.doMock("@/lib/supabase/admin", () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { role }, error: null }),
      };
      return { createAdminClient: () => chain };
    });
    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: async () => false,
    }));
    vi.doMock("@/lib/restaurant/recipe-suggestion-server", () => ({
      NO_STORED_BLOCKS_ERROR: "x",
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
  }

  const ok = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      batch_id: "b2",
      suggested: 3,
      skipped: 0,
      sin_sugerencia: 1,
      items: [],
      skips: [],
      net_sales: 0,
      coverage_pct: 0,
      product_count: 10,
      source: "latest_upload",
    });

  const json = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/restaurant/recipes/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never;

  it("uses the auth company id, never one from the request", async () => {
    const runSpy = ok();
    mockSignedIn("owner", runSpy);
    const { POST } =
      await import("@/app/api/restaurant/recipes/suggestions/route");
    const response = await POST(
      json({ company_id: "other", limit: 5, odoo_product_id: 12 })
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

  it("reads the cost file already uploaded; it never takes a file itself", async () => {
    const runSpy = ok();
    mockSignedIn("manager", runSpy);
    const { POST } =
      await import("@/app/api/restaurant/recipes/suggestions/route");
    const response = await POST(json({ limit: 20 }));
    expect(response.status).toBe(200);
    expect(runSpy.mock.calls[0]![1]).not.toHaveProperty("buffer");

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "recetas.xlsx"));
    const upload = await POST(
      new Request("http://localhost/api/restaurant/recipes/suggestions", {
        method: "POST",
        body: form,
      }) as never
    );
    expect(upload.status).toBe(400);
    expect(((await upload.json()) as { error: string }).error).toMatch(
      /Subir Excel de costos/
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(routeSrc).not.toContain("formData");
  });

  it("a viewer cannot prepare recipes", async () => {
    const runSpy = ok();
    mockSignedIn("viewer", runSpy);
    const { POST } =
      await import("@/app/api/restaurant/recipes/suggestions/route");
    const response = await POST(json({ limit: 5 }));
    expect(response.status).toBe(403);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
