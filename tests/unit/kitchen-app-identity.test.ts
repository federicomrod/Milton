import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";
import {
  INVITE_TTL_MS,
  createKitchenInvite,
  generateToken,
  hashToken,
  redeemKitchenInvite,
  resolveKitchenDevice,
  revokeKitchenDevice,
  revokeKitchenDevicesForStaff,
  revokeKitchenInvite,
} from "@/lib/restaurant/kitchen/app-identity";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

let db: FakeDb;

beforeEach(() => {
  db = createFakeDb({
    restaurant_locations: [
      { id: LOC, company_id: CO, name: "Centro", status: "active" },
    ],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function newInvite(inviteeName: string | null = null) {
  const r = await createKitchenInvite(db.client, {
    companyId: CO,
    locationId: LOC,
    createdBy: OWNER,
    inviteeName,
  });
  if (!r.ok) throw new Error("invite not created");
  return r;
}

describe("tokens", () => {
  it("are 32 random bytes in base64url and hash to SHA-256 hex", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createKitchenInvite", () => {
  it("expires after 7 days and stores only the hash", async () => {
    const before = Date.now();
    const inv = await newInvite("Marta");
    const expires = new Date(inv.expiresAt).getTime();
    expect(expires - before).toBeGreaterThanOrEqual(INVITE_TTL_MS - 5000);
    expect(expires - before).toBeLessThanOrEqual(INVITE_TTL_MS + 5000);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const row = db.tables.kitchen_invites[0];
    expect(row.secret_hash).toBe(hashToken(inv.secret));
    expect(row.invitee_name).toBe("Marta");
    expect(JSON.stringify(db.writes)).not.toContain(inv.secret);
  });

  it("refuses a location of another company", async () => {
    const r = await createKitchenInvite(db.client, {
      companyId: "99999999-9999-4999-8999-999999999999",
      locationId: LOC,
      createdBy: OWNER,
    });
    expect(r).toEqual({ ok: false, reason: "location" });
    expect(db.tables.kitchen_invites ?? []).toHaveLength(0);
  });
});

describe("redeemKitchenInvite", () => {
  it("works once: creates the cook without Telegram ids and a hashed device", async () => {
    const inv = await newInvite();
    const r = await redeemKitchenInvite(db.client, {
      secret: inv.secret,
      name: "  Luis  ",
      platform: "ios",
      deviceLabel: "iPhone de Luis",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.companyId).toBe(CO);
    expect(r.locationId).toBe(LOC);
    expect(r.locationName).toBe("Centro");

    const staff = db.tables.kitchen_staff;
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({
      company_id: CO,
      location_id: LOC,
      display_name: "Luis",
      telegram_user_id: null,
      chat_id: null,
      is_active: true,
    });
    const device = db.tables.kitchen_devices[0];
    expect(device).toMatchObject({
      company_id: CO,
      staff_id: staff[0].id,
      platform: "ios",
    });
    expect(device.token_hash).toBe(hashToken(r.deviceToken));
    expect(db.tables.kitchen_invites[0].used_at).toBeTruthy();
    expect(db.tables.kitchen_invites[0].used_by_staff_id).toBe(staff[0].id);
  });

  it("falls back to the invitee name, then to «Cocina»", async () => {
    const named = await newInvite("Marta");
    const a = await redeemKitchenInvite(db.client, {
      secret: named.secret,
      name: "",
    });
    expect(a.ok && a.staffName).toBe("Marta");
    const unnamed = await newInvite();
    const b = await redeemKitchenInvite(db.client, { secret: unnamed.secret });
    expect(b.ok && b.staffName).toBe("Cocina");
  });

  it("a second redeem of the same invite is «used»", async () => {
    const inv = await newInvite();
    await redeemKitchenInvite(db.client, { secret: inv.secret, name: "A" });
    const again = await redeemKitchenInvite(db.client, {
      secret: inv.secret,
      name: "B",
    });
    expect(again).toEqual({ ok: false, reason: "used" });
    expect(db.tables.kitchen_staff).toHaveLength(1);
    expect(db.tables.kitchen_devices).toHaveLength(1);
  });

  it("two concurrent redeems create exactly one device", async () => {
    const inv = await newInvite();
    const results = await Promise.all([
      redeemKitchenInvite(db.client, { secret: inv.secret, name: "A" }),
      redeemKitchenInvite(db.client, { secret: inv.secret, name: "B" }),
      redeemKitchenInvite(db.client, { secret: inv.secret, name: "C" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "used")
    ).toBe(true);
    expect(db.tables.kitchen_devices).toHaveLength(1);
    expect(db.tables.kitchen_staff).toHaveLength(1);
  });

  it("rejects a revoked, expired or unknown invite", async () => {
    const revoked = await newInvite();
    expect(await revokeKitchenInvite(db.client, revoked.inviteId, CO)).toEqual({
      ok: true,
      revoked: true,
    });
    expect(
      await redeemKitchenInvite(db.client, {
        secret: revoked.secret,
        name: "A",
      })
    ).toEqual({ ok: false, reason: "revoked" });

    const expired = await newInvite();
    db.tables.kitchen_invites.find(
      (i) => i.id === expired.inviteId
    )!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(
      await redeemKitchenInvite(db.client, {
        secret: expired.secret,
        name: "A",
      })
    ).toEqual({ ok: false, reason: "expired" });

    expect(
      await redeemKitchenInvite(db.client, { secret: "nope", name: "A" })
    ).toEqual({ ok: false, reason: "invalid" });
    expect(db.tables.kitchen_devices ?? []).toHaveLength(0);
  });

  it("does not spend the invite when the location is gone", async () => {
    const inv = await newInvite();
    db.tables.restaurant_locations[0].status = "archived";
    const r = await redeemKitchenInvite(db.client, {
      secret: inv.secret,
      name: "A",
    });
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(db.tables.kitchen_invites[0].used_at ?? null).toBeNull();
  });

  it("only hashes are written: the raw secret and device token never reach the database", async () => {
    const inv = await newInvite();
    const r = await redeemKitchenInvite(db.client, {
      secret: inv.secret,
      name: "A",
    });
    if (!r.ok) throw new Error("redeem failed");
    const written = JSON.stringify(db.writes);
    expect(written).not.toContain(inv.secret);
    expect(written).not.toContain(r.deviceToken);
    expect(written).toContain(hashToken(r.deviceToken));
  });

  it("never writes company_memberships", async () => {
    const inv = await newInvite();
    await redeemKitchenInvite(db.client, { secret: inv.secret, name: "A" });
    expect(db.writes.map((w) => w.table)).not.toContain("company_memberships");
  });

  it("never throws: a broken client gives a typed error", async () => {
    const broken = {
      from: () => {
        throw new Error("boom");
      },
    } as any;
    expect(
      await redeemKitchenInvite(broken, { secret: "x".repeat(20) })
    ).toEqual({
      ok: false,
      reason: "error",
    });
    expect(
      await createKitchenInvite(broken, {
        companyId: CO,
        locationId: LOC,
        createdBy: OWNER,
      })
    ).toEqual({ ok: false, reason: "error" });
  });
});

describe("resolveKitchenDevice and revocation", () => {
  async function loggedIn() {
    const inv = await newInvite();
    const r = await redeemKitchenInvite(db.client, {
      secret: inv.secret,
      name: "Luis",
    });
    if (!r.ok) throw new Error("redeem failed");
    return r;
  }

  it("resolves an active device to its cook", async () => {
    const r = await loggedIn();
    const resolved = await resolveKitchenDevice(db.client, r.deviceToken);
    expect(resolved?.staff).toMatchObject({
      id: r.staffId,
      companyId: CO,
      locationId: LOC,
      displayName: "Luis",
      canSeeCosts: false,
    });
  });

  it("touches last_seen_at at most once a minute", async () => {
    const r = await loggedIn();
    await resolveKitchenDevice(db.client, r.deviceToken);
    const first = db.tables.kitchen_devices[0].last_seen_at;
    expect(first).toBeTruthy();
    await resolveKitchenDevice(db.client, r.deviceToken);
    expect(db.tables.kitchen_devices[0].last_seen_at).toBe(first);
    const stale = new Date(Date.now() - 120_000).toISOString();
    db.tables.kitchen_devices[0].last_seen_at = stale;
    await resolveKitchenDevice(db.client, r.deviceToken);
    expect(db.tables.kitchen_devices[0].last_seen_at).not.toBe(stale);
  });

  it("revoking a cook's devices makes resolve return null", async () => {
    const r = await loggedIn();
    expect(
      await revokeKitchenDevicesForStaff(db.client, r.staffId, CO)
    ).toEqual({
      ok: true,
    });
    expect(await resolveKitchenDevice(db.client, r.deviceToken)).toBeNull();
  });

  it("revoking one device makes resolve return null", async () => {
    const r = await loggedIn();
    const deviceId = db.tables.kitchen_devices[0].id;
    expect(await revokeKitchenDevice(db.client, deviceId, CO)).toEqual({
      ok: true,
      revoked: true,
    });
    expect(await revokeKitchenDevice(db.client, deviceId, CO)).toEqual({
      ok: true,
      revoked: false,
    });
    expect(await resolveKitchenDevice(db.client, r.deviceToken)).toBeNull();
  });

  it("a removed (inactive) cook's device stops working", async () => {
    const r = await loggedIn();
    db.tables.kitchen_staff[0].is_active = false;
    expect(await resolveKitchenDevice(db.client, r.deviceToken)).toBeNull();
  });

  it("a device of another company cannot be revoked", async () => {
    await loggedIn();
    const other = "99999999-9999-4999-8999-999999999999";
    expect(
      await revokeKitchenDevice(
        db.client,
        db.tables.kitchen_devices[0].id,
        other
      )
    ).toEqual({ ok: true, revoked: false });
  });

  it("unknown or junk tokens resolve to null", async () => {
    await loggedIn();
    expect(await resolveKitchenDevice(db.client, "short")).toBeNull();
    expect(await resolveKitchenDevice(db.client, generateToken())).toBeNull();
  });
});
