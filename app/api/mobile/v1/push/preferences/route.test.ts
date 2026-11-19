// app/api/mobile/v1/push/preferences/route.test.ts
//
// Tests for push preferences endpoint graceful degradation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "./route";
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

let mockIsPushEnabled: boolean;
vi.mock("@/lib/restaurant/push/sender", () => ({
  isPushEnabled: vi.fn(() => mockIsPushEnabled),
}));

describe("GET /api/mobile/v1/push/preferences", () => {
  const mockRequest = (token: string | null) =>
    new NextRequest(
      `https://app.miltonlabs.ai/api/mobile/v1/push/preferences${token ? `?token=${token}` : ""}`,
      {
        method: "GET",
      }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPushEnabled = true;
  });

  it("should return defaults when table doesn't exist (42P01)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  error: { code: "42P01", message: "relation does not exist" },
                  data: null,
                })
              ),
            })),
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

    const req = mockRequest("ExponentPushToken[abc]");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registered).toBe(false);
    expect(body.dailyEnabled).toBeDefined();
  });

  it("should return defaults when table doesn't exist (PGRST205)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  error: {
                    code: "PGRST205",
                    message: 'relation "public.push_devices" does not exist',
                  },
                  data: null,
                })
              ),
            })),
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

    const req = mockRequest("ExponentPushToken[abc]");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registered).toBe(false);
    expect(body.dailyEnabled).toBeDefined();
  });
});

describe("PUT /api/mobile/v1/push/preferences", () => {
  const mockRequest = (body: any) =>
    new NextRequest("https://app.miltonlabs.ai/api/mobile/v1/push/preferences", {
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

  it("should return defaults when table doesn't exist (42P01)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    error: {
                      code: "42P01",
                      message: "relation does not exist",
                    },
                    data: null,
                  })
                ),
              })),
            })),
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

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      dailyEnabled: false,
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registered).toBe(false);
  });

  it("should return defaults when table doesn't exist (PGRST205)", async () => {
    mockIsPushEnabled = true;

    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    error: {
                      code: "PGRST205",
                      message: 'relation "public.push_devices" does not exist',
                    },
                    data: null,
                  })
                ),
              })),
            })),
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

    const req = mockRequest({
      token: "ExponentPushToken[abc]",
      dailyEnabled: false,
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registered).toBe(false);
  });
});
