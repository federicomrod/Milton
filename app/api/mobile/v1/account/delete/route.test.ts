// app/api/mobile/v1/account/delete/route.test.ts
//
// Tests for the account deletion endpoint (Apple App Store requirement 5.1.1(v)).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, USER_FK_REFERENCES } from "./route";
import { NextRequest, NextResponse } from "next/server";

// Mock dependencies
vi.mock("@/lib/restaurant/onboarding-copy", () => ({
  currencyForCountry: vi.fn(() => "USD"),
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authUserFromBearer: vi.fn(),
}));

vi.mock("@/lib/restaurant/kitchen/kitchen-auth", () => ({
  authKitchenDevice: vi.fn(),
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
        accountDeleteManagerKitchen:
          "Esta cuenta se eliminará cuando elimines tu cuenta de gestor.",
      },
    },
  })),
}));

let mockAdminClient: any;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
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
    const { authKitchenDevice } =
      await import("@/lib/restaurant/kitchen/kitchen-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    vi.mocked(authKitchenDevice).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);

    const req = mockRequest();
    const response = await POST(req);

    expect(response.status).toBe(401);
  });

  it("should delete account when user is not the sole owner", async () => {
    const userId = "user-123";
    const companyId = "company-456";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    // Mock database calls
    let membershipsCalls = 0;
    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          const currentCall = ++membershipsCalls;

          if (currentCall === 1) {
            // First call: get user's memberships
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() =>
                    Promise.resolve({
                      data: [{ company_id: companyId, role: "owner" }],
                      error: null,
                    })
                  ),
                })),
              })),
            };
          } else {
            // Second call: check other owners in this company
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() =>
                    Promise.resolve({
                      data: [{ user_id: userId }, { user_id: "other-owner" }],
                      error: null,
                    })
                  ),
                })),
              })),
            };
          }
        }

        // FK reference tables: mock successful update
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })),
        },
      },
    };

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

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    let membershipsCalls = 0;
    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          const currentCall = ++membershipsCalls;

          if (currentCall === 1) {
            // First call: get user's memberships (.select().eq() - one eq)
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() =>
                  Promise.resolve({
                    data: [{ company_id: companyId, role: "owner" }],
                    error: null,
                  })
                ),
              })),
            };
          } else {
            // Second call: check other owners (.select().eq().eq() - two eqs)
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() =>
                    Promise.resolve({
                      data: [{ user_id: userId }],
                      error: null,
                    })
                  ),
                })),
              })),
            };
          }
        }

        // FK reference tables: mock successful update (shouldn't be reached in sole owner case)
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(),
        },
      },
    };

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.reason).toBe("sole_owner");

    // Should not have called deleteUser
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("should be idempotent - succeed if user already deleted", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          // Return empty memberships
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          };
        }

        // FK references
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { message: "User not found" },
            })
          ),
        },
      },
    };

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });

  it("should clear all USER_FK_REFERENCES before deleting user", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    const updateCalls: Array<{ table: string; column: string }> = [];

    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          };
        }

        // Track FK reference updates - extract column from the values object
        return {
          update: vi.fn((values) => {
            const column = Object.keys(values)[0]; // e.g. { approved_by_user_id: null }
            updateCalls.push({ table, column });
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            };
          }),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })),
        },
      },
    };

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);

    // Verify all 13 FK references were cleared
    expect(updateCalls.length).toBe(USER_FK_REFERENCES.length);

    for (const ref of USER_FK_REFERENCES) {
      expect(updateCalls).toContainEqual({
        table: ref.table,
        column: ref.column,
      });
    }
  });

  it("should handle normal member deletion (not an owner)", async () => {
    const userId = "user-123";
    const companyId = "company-456";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          // User is a member, not an owner
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() =>
                  Promise.resolve({
                    data: [{ company_id: companyId, role: "member" }],
                    error: null,
                  })
                ),
              })),
            })),
          };
        }

        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })),
        },
      },
    };

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });

  it("should handle user with no memberships", async () => {
    const userId = "user-123";

    const { authUserFromBearer } = await import("@/lib/restaurant/api-auth");

    vi.mocked(authUserFromBearer).mockResolvedValue({
      ok: true,
      supabase: {} as any,
      userId,
      email: "test@example.com",
    });

    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "company_memberships") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          };
        }

        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }),
      auth: {
        admin: {
          deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })),
        },
      },
    };

    const req = mockRequest({ authorization: "Bearer valid-token" });
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, deleted: true });
  });
});
