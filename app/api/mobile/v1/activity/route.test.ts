// app/api/mobile/v1/activity/route.test.ts
//
// Tests for app activity tracking endpoint (issue #523).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "./route";
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
        managerPushInvalid: "Datos inválidos.",
      },
    },
  })),
}));

describe("PUT /api/mobile/v1/activity", () => {
  const mockRequest = (body: any) =>
    new NextRequest("https://app.miltonlabs.ai/api/mobile/v1/activity", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: new Headers({
        "Content-Type": "application/json",
      }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if not authenticated", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);

    const req = mockRequest({ surface: "gestion", platform: "ios" });
    const response = await PUT(req);

    expect(response.status).toBe(401);
  });

  it("should return 400 if surface or platform is invalid", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");
    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const badSurface = mockRequest({ surface: "invalid", platform: "ios" });
    const badPlatform = mockRequest({
      surface: "gestion",
      platform: "windows",
    });
    const missing = mockRequest({});

    expect((await PUT(badSurface)).status).toBe(400);
    expect((await PUT(badPlatform)).status).toBe(400);
    expect((await PUT(missing)).status).toBe(400);
  });

  it("should record activity successfully when table exists", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const upsertMock = vi.fn(() => Promise.resolve({ error: null }));
    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: upsertMock,
      })),
    };

    vi.mocked(authManager).mockResolvedValue({
      ok: true,
      supabase: mockSupabase as any,
      companyId: "co1",
      userId: "u1",
      lang: "es",
    } as any);

    const req = mockRequest({ surface: "gestion", platform: "ios" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ recorded: true });

    // Verify upsert was called with correct data
    expect(mockSupabase.from).toHaveBeenCalledWith("app_activity");
    expect(upsertMock).toHaveBeenCalled();
    expect(upsertMock.mock.calls.length).toBeGreaterThan(0);
    // @ts-expect-error - mock.calls is populated after the call
    const firstCall = upsertMock.mock.calls[0] as [any, any];
    expect(firstCall).toBeDefined();
    expect(firstCall[0]).toMatchObject({
      company_id: "co1",
      user_id: "u1",
      surface: "gestion",
      platform: "ios",
    });
    expect(firstCall[0].last_seen_at).toBeTruthy();
    expect(firstCall[1]).toEqual({
      onConflict: "user_id,company_id,surface",
    });
  });

  it("should fail silently when table doesn't exist (42P01)", async () => {
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

    const req = mockRequest({ surface: "cocina", platform: "android" });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ recorded: false });
  });

  it("should fail silently for other database errors", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn(() =>
          Promise.resolve({
            error: { code: "23505", message: "unique violation" },
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

    const req = mockRequest({ surface: "gestion", platform: "ios" });
    const response = await PUT(req);

    // Fail silently - background ping should never block the app
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ recorded: false });
  });

  it("should accept both surfaces (gestion, cocina)", async () => {
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

    const gestion = await PUT(
      mockRequest({ surface: "gestion", platform: "ios" })
    );
    const cocina = await PUT(
      mockRequest({ surface: "cocina", platform: "android" })
    );

    expect(gestion.status).toBe(200);
    expect(cocina.status).toBe(200);
  });

  it("should enforce company and user from auth, never from request body", async () => {
    const { authManager } =
      await import("@/lib/restaurant/mobile-manager/auth");

    let capturedUpsert: any;
    const mockSupabase = {
      from: vi.fn(() => ({
        upsert: vi.fn((data: any) => {
          capturedUpsert = data;
          return Promise.resolve({ error: null });
        }),
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
      surface: "gestion",
      platform: "ios",
      company_id: "evil",
      user_id: "evil",
    });
    const response = await PUT(req);

    expect(response.status).toBe(200);
    expect(capturedUpsert.user_id).toBe("u1");
    expect(capturedUpsert.company_id).toBe("co1");
  });
});
