import { describe, it, expect, vi, beforeEach } from "vitest";

// This test ensures that every new admin Odoo route enforces admin-only access.
// We mock the isUserAdminServer function to test both admin and non-admin cases.

describe("Admin Odoo routes - access control", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("POST /api/admin/odoo/connection", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { POST } = await import("@/app/api/admin/odoo/connection/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/connection",
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const response = await POST(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("GET /api/admin/odoo/connection", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { GET } = await import("@/app/api/admin/odoo/connection/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/connection?company_id=test",
        {
          method: "GET",
        }
      );

      const response = await GET(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("POST /api/admin/odoo/test-connection", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { POST } =
        await import("@/app/api/admin/odoo/test-connection/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/test-connection",
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const response = await POST(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("GET /api/admin/odoo/companies", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { GET } = await import("@/app/api/admin/odoo/companies/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/companies?company_id=test",
        {
          method: "GET",
        }
      );

      const response = await GET(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("POST /api/admin/odoo/companies", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { POST } = await import("@/app/api/admin/odoo/companies/route");
      const mockReq = new Request("http://localhost/api/admin/odoo/companies", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("GET /api/admin/companies", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { GET } = await import("@/app/api/admin/companies/route");

      const response = await GET();
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("GET /api/admin/restaurant-locations", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { GET } =
        await import("@/app/api/admin/restaurant-locations/route");
      const mockReq = new Request(
        "http://localhost/api/admin/restaurant-locations?company_id=test",
        {
          method: "GET",
        }
      );

      const response = await GET(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });
});

describe("API key is never in response body", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("POST /api/admin/odoo/connection never echoes api_key", async () => {
    const mockEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "company-id" },
          error: null,
        }),
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "connection-id" },
          error: null,
        }),
      }),
    });

    vi.doMock("@/lib/profile-service-server", () => ({
      isUserAdminServer: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn().mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "admin-123" } },
          }),
        },
      }),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: vi.fn().mockReturnValue({
        from: vi.fn((table: string) => ({
          select: vi.fn().mockReturnValue({
            eq: mockEq,
          }),
          update: mockUpdate,
          insert: mockInsert,
        })),
      }),
    }));
    vi.doMock("@/lib/restaurant/odoo/client", () => ({
      authenticate: vi.fn().mockResolvedValue(1),
      OdooAuthenticationError: class extends Error {},
    }));
    vi.doMock("@/lib/restaurant/odoo/scoped", () => ({
      discoverOdooCompanies: vi.fn().mockResolvedValue({
        companies: [{ id: 1, name: "Company 1" }],
      }),
    }));
    vi.doMock("@/lib/restaurant/odoo/company-selection", () => ({
      resolveOdooCompanySelection: vi.fn().mockReturnValue({
        ok: true,
        selected: [1],
        selectionRequired: false,
      }),
    }));
    vi.doMock("@/lib/restaurant/odoo/secrets", () => ({
      storeOdooSecret: vi.fn().mockResolvedValue(undefined),
      assertOdooEncryptionConfigured: vi.fn(),
      OdooSecretConfigError: class extends Error {},
    }));
    vi.doMock("@/lib/restaurant/odoo/allowed-hosts", () => ({
      parseAllowedHosts: vi.fn().mockReturnValue(new Set(["test.odoo.com"])),
      assertOdooBaseUrlAllowed: vi.fn(),
      OdooHostNotAllowedError: class extends Error {},
    }));

    const { POST } = await import("@/app/api/admin/odoo/connection/route");
    const mockReq = new Request("http://localhost/api/admin/odoo/connection", {
      method: "POST",
      body: JSON.stringify({
        company_id: "test-company",
        base_url: "https://test.odoo.com",
        database_name: "test-db",
        username: "test@example.com",
        timezone: "UTC",
        api_key: "secret-api-key-123",
      }),
    });

    const response = await POST(mockReq as any);
    const responseText = await response.text();

    // The API key must never appear in the response
    expect(responseText).not.toContain("secret-api-key-123");
    expect(responseText).not.toContain("api_key");
  });
});

describe("Location mapping admin routes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("GET /api/admin/odoo/location-mapping", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { GET } =
        await import("@/app/api/admin/odoo/location-mapping/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/location-mapping?company_id=test",
        { method: "GET" }
      );

      const response = await GET(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });

  describe("POST /api/admin/odoo/location-mapping", () => {
    it("rejects non-admin users with 403", async () => {
      vi.doMock("@/lib/profile-service-server", () => ({
        isUserAdminServer: vi.fn().mockResolvedValue(false),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn().mockResolvedValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "user-123" } },
            }),
          },
        }),
      }));

      const { POST } =
        await import("@/app/api/admin/odoo/location-mapping/route");
      const mockReq = new Request(
        "http://localhost/api/admin/odoo/location-mapping",
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const response = await POST(mockReq as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("Forbidden");
    });
  });
});
