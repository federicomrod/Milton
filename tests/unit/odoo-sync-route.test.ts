import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable supabase query mock: `.select().eq().eq()...` returns the same
// object; `await query.eq(...)` resolves to `result`, and `.maybeSingle()`
// also resolves to `result`.
function createQuery(result: { data: unknown; error: null }) {
  const query: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (
      onFulfilled?: (value: { data: unknown; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise<unknown>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("POST /api/restaurant/pos/odoo-sync - location mapping validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 409 odoo_location_mapping_required when a selected company is unmapped", async () => {
    const connectionQuery = createQuery({
      data: {
        id: "connection-id",
        base_url: "https://test.odoo.com",
        database_name: "test-db",
        username: "test@example.com",
        timezone: "UTC",
        odoo_company_ids: [7, 9],
      },
      error: null,
    });

    const locationsQuery = createQuery({
      data: [
        { id: "loc-a", odoo_company_id: 7 },
        { id: "loc-b", odoo_company_id: null },
      ],
      error: null,
    });

    const upsertSpy = vi.fn();
    const authenticateSpy = vi.fn();

    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {
          from: vi.fn((table: string) => {
            if (table === "restaurant_pos_connections") return connectionQuery;
            if (table === "restaurant_locations") return locationsQuery;
            if (table === "pos_sales_items") return { upsert: upsertSpy };
            throw new Error(`unexpected table ${table}`);
          }),
        },
        companyId: "company-123",
        userId: "admin-123",
      }),
    }));

    vi.doMock("@/lib/restaurant/odoo/secrets", () => ({
      loadDecryptedOdooSecret: vi.fn(),
    }));

    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: authenticateSpy,
      OdooAuthenticationError: class extends Error {},
      OdooRpcError: class extends Error {},
    }));

    const { POST } = await import("@/app/api/restaurant/pos/odoo-sync/route");

    const mockReq = new Request(
      "http://localhost/api/restaurant/pos/odoo-sync",
      {
        method: "POST",
        body: JSON.stringify({
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        }),
      }
    );

    const response = await POST(mockReq as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("odoo_location_mapping_required");
    expect(authenticateSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/restaurant/pos/odoo-sync - Odoo fault text is not returned", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("search_read OdooRpcError details are generic and omit the fault string", async () => {
    class MockOdooRpcError extends Error {
      faultCode: number | string;
      constructor(message: string, faultCode: number | string) {
        super(message);
        this.name = "OdooRpcError";
        this.faultCode = faultCode;
      }
    }

    const FAULT = "Access Denied: Access to pos.order denied for uid 5";

    const connectionQuery = createQuery({
      data: {
        id: "connection-id",
        base_url: "https://test.odoo.com",
        database_name: "test-db",
        username: "test@example.com",
        timezone: "UTC",
        odoo_company_ids: [7, 9],
      },
      error: null,
    });

    const locationsQuery = createQuery({
      data: [
        { id: "loc-a", odoo_company_id: 7 },
        { id: "loc-b", odoo_company_id: 9 },
      ],
      error: null,
    });

    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {
          from: vi.fn((table: string) => {
            if (table === "restaurant_pos_connections") return connectionQuery;
            if (table === "restaurant_locations") return locationsQuery;
            if (table === "pos_sales_items") return { upsert: vi.fn() };
            throw new Error(`unexpected table ${table}`);
          }),
        },
        companyId: "company-123",
        userId: "admin-123",
      }),
    }));

    vi.doMock("@/lib/restaurant/odoo/secrets", () => ({
      loadDecryptedOdooSecret: vi.fn().mockResolvedValue("api-key"),
    }));

    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: vi.fn().mockResolvedValue(5),
      OdooAuthenticationError: class extends Error {},
      OdooRpcError: MockOdooRpcError,
    }));

    vi.doMock("@/lib/restaurant/odoo/scoped", () => ({
      assertOdooScope: vi.fn((ids: number[]) => ({ companyIds: ids })),
      assertRecordsInScope: vi.fn(),
      discoverOdooCompanies: vi.fn().mockResolvedValue({
        companies: [
          { id: 7, name: "A" },
          { id: 9, name: "B" },
        ],
      }),
      scopedExecuteKw: vi
        .fn()
        .mockRejectedValue(new MockOdooRpcError(FAULT, 1)),
      OdooCompanyScopeError: class extends Error {},
    }));

    const { POST } = await import("@/app/api/restaurant/pos/odoo-sync/route");
    const response = await POST(
      new Request("http://localhost/api/restaurant/pos/odoo-sync", {
        method: "POST",
        body: JSON.stringify({
          start_date: "2025-01-01",
          end_date: "2025-01-31",
        }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Failed to fetch Odoo POS orders");
    expect(body.details).toBe("Odoo request failed (unknown)");
    expect(JSON.stringify(body)).not.toContain(FAULT);
    expect(JSON.stringify(body)).not.toContain("Access Denied");
  });
});

describe("POST /api/restaurant/pos/odoo-sync - admin only", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects non-admin users with 403 before Odoo is contacted", async () => {
    const authenticateSpy = vi.fn();
    const fromSpy = vi.fn();

    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: { from: fromSpy },
        companyId: "company-123",
        userId: "user-123",
      }),
    }));
    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: authenticateSpy,
      OdooAuthenticationError: class extends Error {},
      OdooRpcError: class extends Error {},
    }));

    const { POST } = await import("@/app/api/restaurant/pos/odoo-sync/route");
    const response = await POST(
      new Request("http://localhost/api/restaurant/pos/odoo-sync", {
        method: "POST",
        body: JSON.stringify({
          start_date: "2026-07-01",
          end_date: "2026-07-31",
        }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(authenticateSpy).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
