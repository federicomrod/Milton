import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER_CO = "99999999-9999-4999-8999-999999999999";
const LOC = "22222222-2222-4222-8222-222222222222";
const OTHER_LOC = "44444444-4444-4444-8444-444444444444";
const OWNER = "33333333-3333-4333-8333-333333333333";

let db: FakeDb;
let role: string | null = "owner";
let signedIn = true;

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () =>
    signedIn
      ? { ok: true, supabase: db.client, companyId: CO, userId: OWNER }
      : { ok: false, response: new Response(null, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => db.client,
}));
vi.mock("@/lib/auth/permissions", async () => {
  const caps = await import("@/lib/auth/capabilities");
  return {
    can: caps.can,
    resolveActor: async () => ({
      userId: OWNER,
      companyId: CO,
      role,
      isMiltonStaff: false,
    }),
  };
});

import {
  createAppInvite,
  listAppInvites,
  revokeAppInvite,
} from "@/app/dashboard/restaurant/kitchen/app-invite-actions";
import { KitchenAppInviteCard } from "@/components/restaurant/kitchen/KitchenAppInviteCard";
import { appInviteCopy } from "@/lib/restaurant/kitchen/app-invite-copy";

beforeEach(() => {
  role = "owner";
  signedIn = true;
  db = createFakeDb({
    restaurant_locations: [
      { id: LOC, company_id: CO, name: "Centro", status: "active" },
      { id: OTHER_LOC, company_id: OTHER_CO, name: "Ajeno", status: "active" },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("app invite actions", () => {
  it("refuses people without kitchen.qr and touches nothing", async () => {
    for (const r of ["member", "viewer", "analyst", null]) {
      role = r;
      expect(await createAppInvite(LOC)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await listAppInvites()).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(
        await revokeAppInvite("55555555-5555-4555-8555-555555555555")
      ).toEqual({ ok: false, error: "forbidden" });
    }
    expect(db.writes).toEqual([]);
  });

  it("refuses a signed-out caller", async () => {
    signedIn = false;
    expect(await createAppInvite(LOC)).toEqual({ ok: false, error: "auth" });
  });

  it("refuses a location of another company and a malformed id", async () => {
    expect(await createAppInvite(OTHER_LOC)).toEqual({
      ok: false,
      error: "location",
    });
    expect(await createAppInvite("not-a-uuid")).toEqual({
      ok: false,
      error: "location",
    });
    expect(db.tables.kitchen_invites ?? []).toEqual([]);
  });

  it("returns the secret once; the list and the database never expose it", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    const created = await createAppInvite(LOC, "  Ana ");
    if (!created.ok) throw new Error("not created");
    expect(created.code.length).toBeGreaterThanOrEqual(32);

    const stored = JSON.stringify(db.tables.kitchen_invites);
    expect(stored).not.toContain(created.code);
    expect(db.tables.kitchen_invites[0].company_id).toBe(CO);
    expect(db.tables.kitchen_invites[0].invitee_name).toBe("Ana");

    const list = await listAppInvites();
    if (!list.ok) throw new Error("not listed");
    expect(list.invites).toHaveLength(1);
    expect(list.invites[0].status).toBe("pending");
    expect(JSON.stringify(list)).not.toContain(created.code);
    expect(JSON.stringify(list)).not.toMatch(/secret|hash/i);

    for (const spy of [logs, warn]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(created.code);
    }
  });

  it("revokes a pending invite of the own company, and only once", async () => {
    const created = await createAppInvite(LOC);
    if (!created.ok) throw new Error("not created");
    expect(await revokeAppInvite(created.inviteId)).toEqual({ ok: true });
    const list = await listAppInvites();
    if (!list.ok) throw new Error("not listed");
    expect(list.invites[0].status).toBe("revoked");
    expect(await revokeAppInvite(created.inviteId)).toEqual({
      ok: false,
      error: "error",
    });
  });

  it("does not revoke an invite of another company", async () => {
    db.tables.kitchen_invites = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        company_id: OTHER_CO,
        location_id: OTHER_LOC,
        secret_hash: "x",
        expires_at: new Date(Date.now() + 1e9).toISOString(),
        used_at: null,
        revoked_at: null,
      },
    ];
    expect(
      await revokeAppInvite("66666666-6666-4666-8666-666666666666")
    ).toEqual({ ok: false, error: "error" });
    expect(db.tables.kitchen_invites[0].revoked_at).toBeNull();
  });
});

describe("KitchenAppInviteCard", () => {
  it("renders the title, the per-location button and the name field", () => {
    const html = renderToString(
      createElement(KitchenAppInviteCard, {
        locations: [{ id: LOC, name: "Centro" }],
      })
    ).replace(/<!-- -->/g, "");
    const es = appInviteCopy("es");
    expect(html).toContain("App Milton Cocina");
    expect(html).toContain("Centro");
    expect(html).toContain(es.invite);
    expect(html).toContain(es.namePlaceholder);
  });
});

describe("copy", () => {
  it("exists in es, en and de with the same keys and no empty values", () => {
    const flat = (o: unknown, p = ""): string[] =>
      typeof o === "string"
        ? o.trim()
          ? [p]
          : [`${p}!empty`]
        : Object.entries(o as object).flatMap(([k, v]) => flat(v, `${p}.${k}`));
    const es = flat(appInviteCopy("es"));
    expect(es.some((k) => k.endsWith("!empty"))).toBe(false);
    expect(flat(appInviteCopy("en"))).toEqual(es);
    expect(flat(appInviteCopy("de"))).toEqual(es);
    expect(appInviteCopy("es").validity).toBe("Válido 7 días · un solo uso");
    expect(appInviteCopy("es").copyCode).toBe("Copiar código");
    expect(appInviteCopy("es").revoke).toBe("Revocar");
  });
});
