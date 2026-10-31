// Milton support access (migration 072): «Abrir cuenta», the switcher, «Salir»
// and the audit. In-memory database; synthetic ids.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";
import {
  exitSupportMode,
  listRecentSupportOpens,
  listUserCompanies,
  openClientAccount,
  switchActiveCompany,
} from "@/lib/support/support-access";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOME = "11111111-1111-4111-8111-111111111111";
const DEMO = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

let db: FakeDb;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createFakeDb({
    companies: [
      { id: HOME, name: "Restaurante Demo" },
      { id: DEMO, name: "Demo Resto" },
      { id: OTHER, name: "Otra Casa" },
    ],
    company_memberships: [
      {
        id: "m-home",
        company_id: HOME,
        user_id: ADMIN,
        role: "owner",
        is_support: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    profiles: [{ id: ADMIN, user_id: ADMIN, company_id: HOME }],
  });
});

const open = (companyId: string) =>
  openClientAccount(db.client, {
    userId: ADMIN,
    userEmail: "fede@milton.test",
    companyId,
  });

describe("«Abrir cuenta»", () => {
  it("adds a support membership (role admin, is_support), makes the company active and logs the open", async () => {
    const res = await open(DEMO);
    expect(res).toEqual({
      ok: true,
      companyId: DEMO,
      companyName: "Demo Resto",
    });

    const added = db.tables.company_memberships.find(
      (m) => m.company_id === DEMO
    );
    expect(added).toMatchObject({
      user_id: ADMIN,
      role: "admin",
      is_support: true,
    });
    expect(db.tables.profiles[0].company_id).toBe(DEMO);
    expect(db.tables.support_account_opens).toHaveLength(1);
    expect(db.tables.support_account_opens[0]).toMatchObject({
      company_id: DEMO,
      user_id: ADMIN,
      user_email: "fede@milton.test",
      created_membership: true,
    });
  });

  it("a second client works too, and opening the same one again adds no second membership", async () => {
    await open(DEMO);
    await open(OTHER);
    await open(DEMO);
    expect(
      db.tables.company_memberships.filter((m) => m.user_id === ADMIN)
    ).toHaveLength(3);
    expect(db.tables.support_account_opens).toHaveLength(3);
    expect(db.tables.support_account_opens[2].created_membership).toBe(false);
    expect(db.tables.profiles[0].company_id).toBe(DEMO);
  });

  it("an existing real membership is left exactly as it is (not flagged support)", async () => {
    const res = await open(HOME);
    expect(res.ok).toBe(true);
    const own = db.tables.company_memberships.filter(
      (m) => m.company_id === HOME
    );
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ role: "owner", is_support: false });
  });

  it("an unknown company is refused and writes nothing", async () => {
    const res = await open("99999999-9999-4999-8999-999999999999");
    expect(res).toEqual({ ok: false, reason: "company" });
    expect(db.tables.support_account_opens ?? []).toEqual([]);
    expect(db.tables.company_memberships).toHaveLength(1);
  });
});

describe("the switcher", () => {
  it("lists every company the user belongs to, flagging support ones", async () => {
    await open(DEMO);
    const list = await listUserCompanies(db.client, ADMIN);
    expect(list).toEqual([
      { id: HOME, name: "Restaurante Demo", isSupport: false },
      { id: DEMO, name: "Demo Resto", isSupport: true },
    ]);
  });

  it("switches only to a company the user belongs to", async () => {
    await open(DEMO);
    expect(await switchActiveCompany(db.client, ADMIN, HOME)).toBe(true);
    expect(db.tables.profiles[0].company_id).toBe(HOME);
    expect(await switchActiveCompany(db.client, ADMIN, OTHER)).toBe(false);
    expect(db.tables.profiles[0].company_id).toBe(HOME);
  });

  it("a normal user cannot reach another company through it", async () => {
    const normal = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    db.tables.company_memberships.push({
      id: "m-n",
      company_id: OTHER,
      user_id: normal,
      role: "member",
      is_support: false,
    });
    db.tables.profiles.push({ id: normal, user_id: normal, company_id: OTHER });
    expect(await switchActiveCompany(db.client, normal, HOME)).toBe(false);
    expect(db.tables.profiles[1].company_id).toBe(OTHER);
  });
});

describe("«Salir»", () => {
  it("goes back to the user's own company", async () => {
    await open(DEMO);
    expect(await exitSupportMode(db.client, ADMIN)).toBe(HOME);
    expect(db.tables.profiles[0].company_id).toBe(HOME);
  });
  it("has nowhere to go when every membership is support", async () => {
    db.tables.company_memberships = [];
    await open(DEMO);
    expect(await exitSupportMode(db.client, ADMIN)).toBeNull();
  });
});

describe("the audit list", () => {
  it("shows the last opens, newest first, with the company name", async () => {
    await open(DEMO);
    await open(OTHER);
    db.tables.support_account_opens[0].opened_at = "2026-10-01T10:00:00Z";
    db.tables.support_account_opens[1].opened_at = "2026-10-02T10:00:00Z";
    const rows = await listRecentSupportOpens(db.client, 20);
    expect(rows.map((r) => r.companyName)).toEqual(["Otra Casa", "Demo Resto"]);
    expect(rows[0]).toMatchObject({ userEmail: "fede@milton.test" });
  });
});
