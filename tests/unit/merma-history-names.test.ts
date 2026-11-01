// History names: the person's display name, «Equipo Milton» (flag only) for
// support / staff members, never an email of staff and never an id.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: async () => ({
          data:
            table === "company_memberships"
              ? [
                  { user_id: "u-support", is_support: true },
                  { user_id: "u-owner", is_support: false },
                ]
              : [],
          error: null,
        }),
      };
      return chain;
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: {
              email: `${id}@example.com`,
              user_metadata: id === "u-owner" ? { full_name: "Ana Demo" } : {},
            },
          },
        }),
      },
    },
  }),
}));

import { nameHistory } from "@/lib/restaurant/kitchen-buffer-server";
import type { HistoryEntry } from "@/lib/restaurant/yield-buffer";

const e = (id: string, userId: string | null): HistoryEntry => ({
  id,
  createdAt: "2026-11-10T10:00:00Z",
  userId,
  effectiveFrom: "2026-11-10",
  oldPct: 5,
  newPct: 8,
  kind: "today",
});

describe("nameHistory", () => {
  it("names people, flags support, and never leaks ids or staff emails", async () => {
    const out = await nameHistory("c1", [
      e("1", "u-owner"),
      e("2", "u-support"),
      e("3", "u-other"),
      e("4", null),
    ]);
    expect(out[0]).toMatchObject({ who: "Ana Demo", isSupport: false });
    expect(out[1]).toMatchObject({ who: null, isSupport: true });
    expect(out[2].who).toBe("u-other@example.com"); // a normal member without a name: their own email
    expect(out[3]).toMatchObject({ who: null, isSupport: false });
    expect(JSON.stringify(out)).not.toContain("u-support");
    expect(out.every((l) => !("userId" in l))).toBe(true);
  });
});
