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
