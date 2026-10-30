import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER_CO = "99999999-9999-4999-8999-999999999999";
const ME = "33333333-3333-4333-8333-333333333333";
const M_SELF = "a1111111-1111-4111-8111-111111111111";
const M_OWNER2 = "a2222222-2222-4222-8222-222222222222";
const M_MGR = "a3333333-3333-4333-8333-333333333333";
const M_OTHER = "a4444444-4444-4444-8444-444444444444";

let db: FakeDb;
let role: string | null = "owner";
let signedIn = true;
const sendMock = vi.fn(async () => ({ ok: true }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.milton.test" }),
}));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () =>
    signedIn
      ? { ok: true, supabase: db.client, companyId: CO, userId: ME }
      : { ok: false, response: new Response(null, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client }));
vi.mock("@/lib/restaurant/email/send", () => ({
  sendWorkspaceInviteEmail: (...a: unknown[]) => sendMock(...(a as [])),
}));
vi.mock("@/lib/auth/permissions", async () => {
  const caps = await import("@/lib/auth/capabilities");
  return {
    can: caps.can,
    resolveActor: async () => ({
      userId: ME,
      companyId: CO,
      role,
      isMiltonStaff: false,
    }),
  };
});

import {
  inviteMember,
  removeMember,
  revokeInvite,
} from "@/app/dashboard/restaurant/data/team-actions";

beforeEach(() => {
  role = "owner";
  signedIn = true;
  sendMock.mockClear();
  db = createFakeDb({
    companies: [{ id: CO, name: "Casa Milton" }],
    company_memberships: [
      { id: M_SELF, company_id: CO, user_id: ME, role: "owner" },
      { id: M_MGR, company_id: CO, user_id: "u-mgr", role: "manager" },
      { id: M_OTHER, company_id: OTHER_CO, user_id: "u-x", role: "manager" },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("team actions gate", () => {
  it("refuses non-owners and touches nothing", async () => {
    for (const r of ["admin", "manager", "member", "viewer", null]) {
      role = r;
      expect(await inviteMember("a@b.co", "member")).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await removeMember(M_MGR)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await revokeInvite(M_MGR)).toEqual({
        ok: false,
        error: "forbidden",
      });
    }
    expect(db.writes).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    signedIn = false;
    expect(await inviteMember("a@b.co", "member")).toEqual({
      ok: false,
      error: "auth",
    });
  });
});

describe("inviteMember", () => {
  it("validates email and role", async () => {
    expect(await inviteMember("nope", "member")).toEqual({
      ok: false,
      error: "email",
    });
    expect(await inviteMember("a@b.co", "admin")).toEqual({
      ok: false,
      error: "role",
    });
    expect(db.tables.workspace_invites ?? []).toEqual([]);
  });

  it("stores only the hash, scopes to the session company, returns the link once", async () => {
    const res = await inviteMember("  Ana@Cafe.COM ", "member");
    if (!res.ok) throw new Error("not created");
    expect(res.email).toBe("ana@cafe.com");
    expect(res.emailSent).toBe(true);
    expect(
      res.link.startsWith("https://app.milton.test/auth/invite?token=")
    ).toBe(true);
    const token = res.link.split("token=")[1];
    const row = db.tables.workspace_invites[0];
    expect(row.company_id).toBe(CO);
    expect(row.created_by).toBe(ME);
    expect(row.role).toBe("member");
    expect(JSON.stringify(db.tables.workspace_invites)).not.toContain(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unsent email and revokes the previous live invite", async () => {
    await inviteMember("ana@cafe.com", "member");
    sendMock.mockResolvedValueOnce({ ok: false });
    const second = await inviteMember("ana@cafe.com", "owner");
    if (!second.ok) throw new Error("not created");
    expect(second.emailSent).toBe(false);
    const [first, latest] = db.tables.workspace_invites;
    expect(first.revoked_at).toBeTruthy();
    expect(latest.revoked_at ?? null).toBeNull();
    expect(latest.role).toBe("owner");
  });
});

describe("removeMember", () => {
  it("removes a member of the own company", async () => {
    expect(await removeMember(M_MGR)).toEqual({ ok: true });
    expect(db.tables.company_memberships.some((m) => m.id === M_MGR)).toBe(
      false
    );
  });

  it("refuses yourself and the last owner", async () => {
    expect(await removeMember(M_SELF)).toEqual({ ok: false, error: "self" });
    db.tables.company_memberships.push({
      id: M_OWNER2,
      company_id: CO,
      user_id: "u-o2",
      role: "owner",
    });
    // Two owners: removing the other owner is allowed.
    expect(await removeMember(M_OWNER2)).toEqual({ ok: true });
    expect(db.tables.company_memberships.some((m) => m.id === M_SELF)).toBe(
      true
    );
  });

  it("refuses removing the only other owner when the caller is not an owner row", async () => {
    // Caller is owner via actor but their own row is gone: the one remaining
    // owner must stay.
    db.tables.company_memberships = db.tables.company_memberships.filter(
      (m) => m.id !== M_SELF
    );
    db.tables.company_memberships.push({
      id: M_OWNER2,
      company_id: CO,
      user_id: "u-o2",
      role: "owner",
    });
    expect(await removeMember(M_OWNER2)).toEqual({
      ok: false,
      error: "last_owner",
    });
  });

  it("never touches another company's member or a malformed id", async () => {
    expect(await removeMember(M_OTHER)).toEqual({ ok: false, error: "error" });
    expect(await removeMember("nope")).toEqual({ ok: false, error: "error" });
    expect(db.tables.company_memberships).toHaveLength(3);
  });
});

describe("revokeInvite", () => {
  it("revokes a pending invite once, only in the own company", async () => {
    const made = await inviteMember("ana@cafe.com", "member");
    if (!made.ok) throw new Error("not created");
    expect(await revokeInvite(made.inviteId)).toEqual({ ok: true });
    expect(await revokeInvite(made.inviteId)).toEqual({
      ok: false,
      error: "error",
    });
    const foreign = "b1111111-1111-4111-8111-111111111111";
    db.tables.workspace_invites.push({
      id: foreign,
      company_id: OTHER_CO,
      email: "x@y.co",
      role: "member",
      token_hash: "h",
      expires_at: new Date(Date.now() + 1e9).toISOString(),
    });
    expect(await revokeInvite(foreign)).toEqual({ ok: false, error: "error" });
  });
});
