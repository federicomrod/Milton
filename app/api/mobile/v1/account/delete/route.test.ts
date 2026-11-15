// app/api/mobile/v1/account/delete/route.test.ts
//
// Tests for the account deletion endpoint (Apple App Store requirement 5.1.1(v)).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, USER_FK_REFERENCES } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(),
        })),
      })),
    })),
    auth: {
      admin: {
        deleteUser: vi.fn(),
      },
    },
  })),
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authUserFromBearer: vi.fn(),
}));

vi.mock("@/lib/restaurant/kitchen/mobile-response", () => ({
  mobileJson: vi.fn((body, status = 200) => ({
    json: () => Promise.resolve(body),
    status,
  })),
  mobileLanguage: vi.fn(() => "es"),
}));

vi.mock("@/lib/i18n", () => ({
  getDictionary: vi.fn(() => ({
    kitchen: {
      api: {
        accountDeleteFailed: "No se pudo eliminar la cuenta.",
        accountDeleteSoleOwner: "Eres el único dueño de esta empresa.",
      },
    },
  })),
}));

describe("DELETE /api/mobile/v1/account/delete", () => {
  const mockRequest = (headers: Record<string, string> = {}) =>
    new NextRequest("https://app.miltonlabs.ai/api/mobile/v1/account/delete", {
      method: "POST",
      headers: new Headers({
        "Content-Type": "application/json",
        ...headers,
      }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if not authenticated", async () => {
    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    });

    const req = mockRequest();
    const response = await POST(req);

    expect(response.status).toBe(401);
  });

  it("should delete account when user is not the sole owner", async () => {
    const userId = "user-123";
    const companyId = "company-456";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                // First call: get user's memberships
                eq: vi.fn(() =>
                  Promise.resolve({
                    data: [{ company_id: companyId, role: "owner" }],
                    error: null,
                  })
                ),
                // Second call: check other owners
              })),
            })),
          };
        }
        return { select: vi.fn() };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        },
      },
    };

    // Mock the chain for checking other owners
    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    // Mock the memberships query to return the user's memberships
    const membershipsQuery = mockAdminClient.from("company_memberships");
    vi.mocked(membershipsQuery.select).mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve({
            data: [{ company_id: companyId, role: "owner" }],
            error: null,
          })
        ),
      })),
    } as any);

    // Mock checking other owners - return 2 owners so user is not sole owner
    const ownersQuery = mockAdminClient.from("company_memberships");
    vi.mocked(ownersQuery.select).mockReturnValueOnce({
      eq: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve({
            data: [
              { user_id: userId },
              { user_id: "other-owner" },
            ],
            error: null,
          })
        ),
      })),
    } as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });

  it("should block deletion if user is sole owner", async () => {
    const userId = "user-123";
    const companyId = "company-456";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const mockAdminClient = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => {
              // Return different data based on which query this is
              // First: user's memberships (they're an owner)
              // Second: check other owners (only this user)
              return Promise.resolve({
                data: [{ user_id: userId, role: "owner" }],
                error: null,
              });
            }),
          })),
        })),
      })),
      auth: {
        admin: {
          deleteUser: vi.fn(),
        },
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.reason).toBe("sole_owner");
  });

  it("should be idempotent - succeed if user already deleted", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const mockAdminClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
      auth: {
        admin: {
          deleteUser: vi.fn(() =>
            Promise.resolve({
              error: { message: "User not found" },
            })
          ),
        },
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });

  it("should handle normal member deletion (not an owner)", async () => {
    const userId = "user-123";
    const companyId = "company-456";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const mockAdminClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                data: [{ company_id: companyId, role: "manager" }],
                error: null,
              })
            ),
          })),
        })),
      })),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        },
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
    expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
  });

  it("should handle user with no memberships", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const mockAdminClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        },
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });

  it("should clear all FK references from USER_FK_REFERENCES before deleting", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const updateCalls: Array<{ table: string; column: string }> = [];
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          };
        }
        return {
          update: vi.fn((updates: Record<string, any>) => {
            const column = Object.keys(updates)[0];
            updateCalls.push({ table, column });
            return {
              eq: vi.fn(() => Promise.resolve({ error: null })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        },
      },
    };

    vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as any);

    const req = mockRequest({ authorization: "Bearer valid-token" });
    await POST(req);

    // Verify that all FK references were cleared
    expect(updateCalls.length).toBe(USER_FK_REFERENCES.length);
    USER_FK_REFERENCES.forEach((ref) => {
      expect(updateCalls).toContainEqual({ table: ref.table, column: ref.column });
    });
  });
});
