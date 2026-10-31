import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserById = vi.fn(async (id: string) => ({
  data: {
    user: {
      email: `${id}@example.com`,
      user_metadata: { full_name: `Name ${id}` },
    },
  },
}));

const memberships = [
  { id: "m1", user_id: "u-owner", role: "owner", is_support: false },
  { id: "m2", user_id: "u-staff", role: "admin", is_support: true },
];

function query(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "order", "limit"])
    q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows, error: null });
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      query(table === "company_memberships" ? memberships : []),
    auth: { admin: { getUserById } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => query([]) }),
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u-owner" }),
  getCachedCompanyId: async () => "c1",
  getCachedActor: async () => ({
    userId: "u-owner",
    companyId: "c1",
    role: "owner",
    isMiltonStaff: false,
  }),
}));
vi.mock("@/lib/restaurant/shell-context-server", () => ({
  loadRestaurantShellChrome: async () => ({ lang: "es", locations: [] }),
}));
vi.mock("@/components/restaurant/kitchen/KitchenAppInviteCard", () => ({
  KitchenAppInviteCard: () => null,
}));
vi.mock("@/components/restaurant/kitchen/KitchenQrCard", () => ({
  KitchenQrCard: () => null,
}));

import { EquipoSection } from "@/components/restaurant/config/sections/EquipoSection";

describe("Equipo y acceso: Milton support member", () => {
  beforeEach(() => getUserById.mockClear());

  it("sends null name and email for the support member and never looks them up", async () => {
    const tree = (await EquipoSection()) as unknown as {
      props: { children: Array<{ props: { members: unknown[] } }> };
    };
    const members = tree.props.children[0].props.members as Array<{
      name: string | null;
      email: string | null;
      isSupport: boolean;
    }>;
    const support = members.find((m) => m.isSupport)!;
    expect(support.name).toBeNull();
    expect(support.email).toBeNull();
    expect(JSON.stringify(members)).not.toContain("u-staff@example.com");
    expect(getUserById).not.toHaveBeenCalledWith("u-staff");
    // A normal member is unchanged.
    const owner = members.find((m) => !m.isSupport)!;
    expect(owner.email).toBe("u-owner@example.com");
    expect(owner.name).toBe("Name u-owner");
  });
});
