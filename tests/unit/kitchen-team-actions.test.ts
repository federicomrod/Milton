// Web server actions for the kitchen team: owner, admin and manager only; the
// company always from the session; a cook of another company is not found.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER_CO = "99999999-9999-4999-8999-999999999999";
const LOC = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444441";
const OTHER_STAFF = "44444444-4444-4444-8444-444444444499";

let db: FakeDb;
let role: string | null = "manager";

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: db.client,
    companyId: CO,
    userId: USER,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client }));
vi.mock("@/lib/auth/permissions", async () => {
  const caps = await import("@/lib/auth/capabilities");
  return {
    can: caps.can,
    resolveActor: async () => ({
      userId: USER,
      companyId: CO,
      role,
      isMiltonStaff: false,
    }),
  };
});

import {
  listKitchenTeamAction,
  resetKitchenPinAction,
  sendNewKitchenLinkAction,
  signOutKitchenPhoneAction,
} from "@/app/dashboard/restaurant/kitchen/team-actions";

beforeEach(() => {
  role = "manager";
  db = createFakeDb({
    companies: [{ id: CO, name: "Casa A", kitchen_code: "ABC234" }],
    restaurant_locations: [
      { id: LOC, company_id: CO, name: "Centro", status: "active" },
    ],
    kitchen_staff: [
      {
        id: STAFF,
        company_id: CO,
        location_id: LOC,
        display_name: "Luis",
        is_active: true,
      },
      {
        id: OTHER_STAFF,
        company_id: OTHER_CO,
        location_id: LOC,
        display_name: "Ajeno",
        is_active: true,
      },
    ],
    kitchen_devices: [
      {
        id: "55555555-5555-4555-8555-555555555551",
        company_id: CO,
        staff_id: STAFF,
        token_hash: "h1",
        revoked_at: null,
      },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("kitchen team actions", () => {
  it.each(["owner", "admin", "manager"])(
    "%s can list, reset, relink and sign out",
    async (r) => {
      role = r;
      const list = await listKitchenTeamAction();
      expect(list.ok && list.team.map((m) => m.id)).toEqual([STAFF]);
      expect(list.ok && list.kitchenCode).toBe("ABC234");
      expect(JSON.stringify(list)).not.toMatch(/pin_hash|token_hash/);
      const reset = await resetKitchenPinAction(STAFF, "temporary");
      expect(reset.ok && reset.temporaryPin).toMatch(/^\d{6}$/);
      const link = await sendNewKitchenLinkAction(STAFF);
      expect(link.ok && link.code.length).toBeGreaterThan(20);
      expect(db.tables.kitchen_invites[0]).toMatchObject({
        company_id: CO,
        target_staff_id: STAFF,
      });
      expect(await signOutKitchenPhoneAction(STAFF)).toEqual({ ok: true });
      expect(db.tables.kitchen_devices[0].revoked_at).toBeTruthy();
    }
  );
  it.each(["member", "viewer", "analyst", null])(
    "%s is refused and nothing changes",
    async (r) => {
      role = r;
      expect(await listKitchenTeamAction()).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await resetKitchenPinAction(STAFF, "clear")).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await sendNewKitchenLinkAction(STAFF)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await signOutKitchenPhoneAction(STAFF)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(
        db.writes.filter((w) => w.table.startsWith("kitchen_"))
      ).toHaveLength(0);
    }
  );
  it("a cook of another company is not found", async () => {
    expect(await resetKitchenPinAction(OTHER_STAFF, "temporary")).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await sendNewKitchenLinkAction(OTHER_STAFF)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await signOutKitchenPhoneAction(OTHER_STAFF)).toEqual({
      ok: false,
      error: "notFound",
    });
  });
});
