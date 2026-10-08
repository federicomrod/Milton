import { describe, it, expect, vi, beforeEach } from "vitest";

describe("POST /api/restaurant/pos/odoo-sync - location mapping validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 409 odoo_location_mapping_required when selected companies are not all mapped", async () => {
    const mockEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "connection-id",
            base_url: "https://test.odoo.com",
            database_name: "test-db",
            username: "test@example.com",
            timezone: "UTC",
            odoo_company_ids: [7, 9], // Two companies selected
          },
          error: null,
        }),
      }),
    });

    const mockSelect = vi.fn().mockReturnValue({
      eq: mockEq,
    });

    const mockFrom = vi.fn((table: string) => {
      if (table === "restaurant_pos_connections") {
        return { select: mockSelect };
      }
      if (table === "restaurant_locations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: "loc-a", name: "Location A", odoo_company_id: 7 }, // Company 7 mapped
                { id: "loc-b", name: "Location B", odoo_company_id: null }, // Company 9 NOT mapped
              ],
              error: null,
            }),
          }),
        };
      }
      return { select: vi.fn() };
    });

    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {
          from: mockFrom,
        },
        companyId: "company-123",
      }),
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn().mockReturnValue({
        from: mockFrom,
      }),
    }));

    vi.doMock("@/lib/restaurant/odoo/secrets", () => ({
      loadDecryptedOdooSecret: vi.fn().mockResolvedValue("api-key-123"),
    }));

    // Should NOT be called when mapping is incomplete
    const authenticateSpy = vi.fn();
    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: authenticateSpy,
      OdooAuthenticationError: class extends Error {},
    }));

    const { POST } = await import("@/app/api/restaurant/pos/odoo-sync/route");

    const mockReq = new Request(
      "http://localhost/api/restaurant/pos/odoo-sync",
      {
        method: "POST",
        body: JSON.stringify({
          since_iso: "2025-01-01T00:00:00Z",
        }),
      }
    );

    const response = await POST(mockReq as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("odoo_location_mapping_required");
    expect(body.unmapped_companies).toEqual([9]);

    // Verify no Odoo fetch was attempted
    expect(authenticateSpy).not.toHaveBeenCalled();
  });

  it("proceeds with sync when all selected companies are mapped", async () => {
    const mockEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "connection-id",
            base_url: "https://test.odoo.com",
            database_name: "test-db",
            username: "test@example.com",
            timezone: "UTC",
            odoo_company_ids: [7, 9], // Two companies selected
          },
          error: null,
        }),
      }),
    });

    const mockSelect = vi.fn().mockReturnValue({
      eq: mockEq,
    });

    const mockUpsert = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    const mockFrom = vi.fn((table: string) => {
      if (table === "restaurant_pos_connections") {
        return { select: mockSelect };
      }
      if (table === "restaurant_locations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: "loc-a", name: "Location A", odoo_company_id: 7 }, // Company 7 mapped
                { id: "loc-b", name: "Location B", odoo_company_id: 9 }, // Company 9 mapped
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "sales") {
        return { upsert: mockUpsert };
      }
      return { select: vi.fn() };
    });

    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: vi.fn().mockResolvedValue({
        ok: true,
        supabase: {
          from: mockFrom,
        },
        companyId: "company-123",
      }),
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn().mockReturnValue({
        from: mockFrom,
      }),
    }));

    vi.doMock("@/lib/restaurant/odoo/secrets", () => ({
      loadDecryptedOdooSecret: vi.fn().mockResolvedValue("api-key-123"),
    }));

    const authenticateSpy = vi.fn().mockResolvedValue(1);
    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: authenticateSpy,
      OdooAuthenticationError: class extends Error {},
    }));

    vi.doMock("@/lib/restaurant/odoo/scoped", () => ({
      scopedExecuteKw: vi.fn().mockResolvedValue([]), // No orders returned
    }));

    vi.doMock("@/lib/restaurant/pos-import", () => ({
      buildNameIndex: vi.fn().mockReturnValue(new Map()),
    }));

    const { POST } = await import("@/app/api/restaurant/pos/odoo-sync/route");

    const mockReq = new Request(
      "http://localhost/api/restaurant/pos/odoo-sync",
      {
        method: "POST",
        body: JSON.stringify({
          since_iso: "2025-01-01T00:00:00Z",
        }),
      }
    );

    const response = await POST(mockReq as any);

    expect(response.status).toBe(200);

    // Verify Odoo authenticate was called
    expect(authenticateSpy).toHaveBeenCalled();
  });
});
