import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const routeSrc = readFileSync(
  join(process.cwd(), "app/api/restaurant/pos/products/route.ts"),
  "utf8"
);
const syncSrc = readFileSync(
  join(process.cwd(), "lib/restaurant/odoo/sync-company.ts"),
  "utf8"
);

describe("GET /api/restaurant/pos/products", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the signed-in company and never reads company_id from the request", () => {
    expect(routeSrc).toContain("authAndCompany");
    expect(routeSrc).toContain("loadPosProductList");
    expect(routeSrc).not.toMatch(/searchParams\.get\(["']company_id["']\)/);
    expect(routeSrc).not.toMatch(/body\.company_id/);
    expect(routeSrc).toContain("loadPosProductList");
  });

  it("keeps ranking and coverage on the server", () => {
    expect(routeSrc).toContain("loadPosProductList(auth.supabase");
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
    const loadSpy = vi.fn();
    vi.doMock("@/lib/restaurant/pos-product-list-server", () => ({
      loadPosProductList: loadSpy,
    }));

    const { GET } = await import("@/app/api/restaurant/pos/products/route");
    const response = await GET(
      new Request("http://localhost/api/restaurant/pos/products") as never
    );
    expect(response.status).toBe(401);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("passes the auth company id, not a query company id", async () => {
    const loadSpy = vi.fn().mockResolvedValue({
      ok: true,
      list: {
        company_id: "company-123",
        net_sales: 0,
        covered_net_sales: 0,
        coverage_pct: 0,
        products: [],
      },
    });
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {},
        companyId: "company-123",
        userId: "user-1",
      }),
    }));
    vi.doMock("@/lib/restaurant/pos-product-list-server", () => ({
      loadPosProductList: loadSpy,
    }));

    const { GET } = await import("@/app/api/restaurant/pos/products/route");
    const response = await GET(
      new Request(
        "http://localhost/api/restaurant/pos/products?company_id=other&start_date=2026-07-01&end_date=2026-07-31"
      ) as never
    );
    expect(response.status).toBe(200);
    expect(loadSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        companyId: "company-123",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      })
    );
  });
});

describe("Odoo sync combo field gating", () => {
  it("asks fields_get before reading combo_parent_id", () => {
    expect(syncSrc).toContain('scopedCall("pos.order.line", "fields_get"');
    expect(syncSrc).toContain("optionalLineComboFields(availableLineFields)");
    const fieldsGetAt = syncSrc.indexOf(
      'scopedCall("pos.order.line", "fields_get"'
    );
    const comboAt = syncSrc.indexOf(
      "optionalLineComboFields(availableLineFields)"
    );
    expect(fieldsGetAt).toBeGreaterThan(-1);
    expect(comboAt).toBeGreaterThan(fieldsGetAt);
  });

  it("never writes pos_product_links or Confirmado during sync", () => {
    expect(syncSrc).not.toContain("pos_product_links");
    expect(syncSrc).not.toContain("confirmado");
    expect(syncSrc).not.toContain("link_state");
  });
});
