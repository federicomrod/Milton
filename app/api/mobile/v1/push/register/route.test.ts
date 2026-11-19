// app/api/mobile/v1/push/register/route.test.ts
//
// Tests for graceful degradation when push is disabled or migration not applied.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT, DELETE } from "./route";
import { NextRequest, NextResponse } from "next/server";

// Mock dependencies
vi.mock("@/lib/restaurant/mobile-manager/auth", () => ({
  authManager: vi.fn(),
}));

vi.mock("@/lib/restaurant/kitchen/mobile-response", () => ({
  mobileJson: vi.fn((body, status = 200) => ({
    json: () => Promise.resolve(body),
    status,
    body,
  })),
}));

vi.mock("@/lib/i18n", () => ({
  getDictionary: vi.fn(() => ({
    kitchen: {
      api: {
        managerPushInvalid: "Token inválido.",
        managerLoadFailed: "Error al cargar.",
      },
    },
  })),
}));

vi.mock("@/lib/restaurant/push/prefs-input", () => ({
  parseToken: vi.fn((b: any) => b?.token ?? null),
  parsePrefsPatch: vi.fn((b: any) => (b?.token ? { timezone: "UTC" } : null)),
}));

vi.mock("@/lib/restaurant/push/policy", () => ({
  validTimezone: vi.fn(() => true),
}));

let mockIsPushEnabled: boolean;
vi.mock("@/lib/restaurant/push/sender", () => ({
  isPushEnabled: vi.fn(() => mockIsPushEnabled),
}));

let mockAdminClient: any;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}));

describe("PUT /api/mobile/v1/push/register", () => {
  const mockRequest = (body: any) =>
    new NextRequest("https://app.miltonlabs.ai/api/mobile/v1/push/register", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPushEnabled = true;
  });

  it("should return 401 if not authenticated", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      platform: "ios",
    });
    const response = await PUT(req);

    expect(response.status).toBe(401);
  });

  it("should return 400 if token or platform is invalid", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({ token: null, platform: "ios" });
    const response = await PUT(req);

    expect(response.status).toBe(400);
  });

  it("should return registered: false when PUSH_ENABLED is false", async () => {
    mockIsPushEnabled = false;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      platform: "ios",
      timezone: "America/Mexico_City",
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: false });
  });

  it("should return registered: false when table doesn't exist (42P01)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() =>
          Promise.resolve({
            error: { code: "42P01", message: "relation does not exist" },
          })
        ),
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    mockAdminClient = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            neq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        })),
      })),
    };

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      platform: "ios",
      timezone: "America/Mexico_City",
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: false });
  });

  it("should return 500 for other database errors", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() =>
          Promise.resolve({
            error: { code: "23505", message: "duplicate key" },
          })
        ),
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    mockAdminClient = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            neq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        })),
      })),
    };

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      platform: "ios",
      timezone: "America/Mexico_City",
    });
    const response = await PUT(req);

    expect(response.status).toBe(500);
  });

  it("should register successfully when push is enabled and table exists", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    mockAdminClient = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            neq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        })),
      })),
    };

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      platform: "ios",
      timezone: "America/Mexico_City",
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: true });
  });
});

describe("DELETE /api/mobile/v1/push/register", () => {
  const mockRequest = (body: any) =>
    new NextRequest("https://app.miltonlabs.ai/api/mobile/v1/push/register", {
      method: "DELETE",
      body: JSON.stringify(body),
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPushEnabled = true;
  });

  it("should return registered: false when PUSH_ENABLED is false", async () => {
    mockIsPushEnabled = false;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({ token: "ExponentPushToken[abc]" });
    const response = await DELETE(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: false });
  });

  it("should return registered: false when table doesn't exist (42P01)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                error: { code: "42P01", message: "relation does not exist" },
              })
            ),
          })),
        })),
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({ token: "ExponentPushToken[abc]" });
    const response = await DELETE(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: false });
  });

  it("should unregister successfully when push is enabled and table exists", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        })),
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({ token: "ExponentPushToken[abc]" });
    const response = await DELETE(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ registered: false });
  });
});
