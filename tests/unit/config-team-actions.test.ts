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
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvite,
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
  it("refuses everyone but owner and admin and touches nothing", async () => {
    for (const r of ["manager", "analyst", "member", "viewer", null]) {
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
    expect(await inviteMember("a@b.co", "boss")).toEqual({
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

const ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;

describe("inviteMember roles", () => {
  it("an owner can invite any of the five roles, and the chosen role is stored", async () => {
    for (const r of ROLES) {
      const res = await inviteMember(`${r}@cafe.test`, r);
      expect(res.ok, r).toBe(true);
    }
    expect(db.tables.workspace_invites.map((i) => i.role)).toEqual([...ROLES]);
  });

  it("an existing «member» role keeps working", async () => {
    expect((await inviteMember("old@cafe.test", "member")).ok).toBe(true);
    expect(db.tables.workspace_invites[0].role).toBe("member");
  });

  it("an admin invites admin, manager, analyst and viewer but never an owner", async () => {
    role = "admin";
    for (const r of ["admin", "manager", "analyst", "viewer"]) {
      expect((await inviteMember(`${r}@cafe.test`, r)).ok, r).toBe(true);
    }
    const before = db.tables.workspace_invites.length;
    expect(await inviteMember("boss@cafe.test", "owner")).toEqual({
      ok: false,
      error: "role_limit",
    });
    expect(db.tables.workspace_invites).toHaveLength(before);
  });

  it("nobody who cannot manage the team grants anything", async () => {
    for (const r of ["manager", "analyst", "viewer", "member", null]) {
      role = r;
      expect(await inviteMember("x@cafe.test", "viewer")).toEqual({
        ok: false,
        error: "forbidden",
      });
    }
    expect(db.tables.workspace_invites ?? []).toEqual([]);
  });
});

describe("resendInvite", () => {
  it("revokes the pending invite and creates a new one with the same email and role", async () => {
    const made = await inviteMember("ana@cafe.test", "analyst");
    if (!made.ok) throw new Error("not created");
    const again = await resendInvite(made.inviteId);
    if (!again.ok) throw new Error("not resent");
    expect(again.inviteId).not.toBe(made.inviteId);
    expect(again.link).not.toBe(made.link);
    const [first, second] = db.tables.workspace_invites;
    expect(first.revoked_at).toBeTruthy();
    expect(second.role).toBe("analyst");
    expect(second.email).toBe("ana@cafe.test");
    expect(JSON.stringify(db.tables.workspace_invites)).not.toContain(
      again.link.split("token=")[1]
    );
  });

  it("an admin cannot resend an owner invite; a foreign or bad id is an error", async () => {
    const made = await inviteMember("boss@cafe.test", "owner");
    if (!made.ok) throw new Error("not created");
    role = "admin";
    expect(await resendInvite(made.inviteId)).toEqual({
      ok: false,
      error: "role_limit",
    });
    expect((await resendInvite("nope")).ok).toBe(false);
    role = "owner";
    const foreign = "b2222222-2222-4222-8222-222222222222";
    db.tables.workspace_invites.push({
      id: foreign,
      company_id: OTHER_CO,
      email: "x@y.co",
      role: "viewer",
      token_hash: "h",
      expires_at: new Date(Date.now() + 1e9).toISOString(),
    });
    expect(await resendInvite(foreign)).toEqual({ ok: false, error: "error" });
  });
});

describe("changeMemberRole", () => {
  it("an owner changes a manager to any role, including owner", async () => {
    for (const r of ["admin", "analyst", "viewer", "owner", "manager"]) {
      expect(await changeMemberRole(M_MGR, r)).toEqual({ ok: true, role: r });
      expect(
        db.tables.company_memberships.find((m) => m.id === M_MGR)?.role
      ).toBe(r);
    }
  });

  it("an admin cannot make an owner, nor touch one, nor grant above their own", async () => {
    role = "admin";
    expect(await changeMemberRole(M_MGR, "owner")).toEqual({
      ok: false,
      error: "role_limit",
    });
    db.tables.company_memberships.push({
      id: M_OWNER2,
      company_id: CO,
      user_id: "u-o2",
      role: "owner",
    });
    expect(await changeMemberRole(M_OWNER2, "viewer")).toEqual({
      ok: false,
      error: "role_limit",
    });
    expect(await removeMember(M_OWNER2)).toEqual({
      ok: false,
      error: "role_limit",
    });
    expect(
      db.tables.company_memberships.find((m) => m.id === M_OWNER2)?.role
    ).toBe("owner");
    // What an admin may do: manager -> analyst.
    expect(await changeMemberRole(M_MGR, "analyst")).toEqual({
      ok: true,
      role: "analyst",
    });
  });

  it("an admin cannot revoke an owner's pending invite", async () => {
    const made = await inviteMember("boss@cafe.test", "owner");
    if (!made.ok) throw new Error("not created");
    role = "admin";
    expect(await revokeInvite(made.inviteId)).toEqual({
      ok: false,
      error: "role_limit",
    });
  });

  it("never demotes the last owner", async () => {
    // Caller is an admin acting on a company whose only owner is M_OWNER2.
    db.tables.company_memberships = db.tables.company_memberships.filter(
      (m) => m.id !== M_SELF
    );
    db.tables.company_memberships.push({
      id: M_OWNER2,
      company_id: CO,
      user_id: "u-o2",
      role: "owner",
    });
    expect(await changeMemberRole(M_OWNER2, "admin")).toEqual({
      ok: false,
      error: "last_owner",
    });
    // With a second owner, demoting one is fine.
    db.tables.company_memberships.push({
      id: M_SELF,
      company_id: CO,
      user_id: "u-o3",
      role: "owner",
    });
    expect(await changeMemberRole(M_OWNER2, "admin")).toEqual({
      ok: true,
      role: "admin",
    });
  });

  it("refuses yourself, a non-team role, another company and non-managers", async () => {
    expect(await changeMemberRole(M_SELF, "viewer")).toEqual({
      ok: false,
      error: "self",
    });
    expect(await changeMemberRole(M_MGR, "member")).toEqual({
      ok: false,
      error: "role",
    });
    expect(await changeMemberRole(M_MGR, "boss")).toEqual({
      ok: false,
      error: "role",
    });
    expect(await changeMemberRole(M_OTHER, "viewer")).toEqual({
      ok: false,
      error: "error",
    });
    for (const r of ["manager", "analyst", "viewer", "member", null]) {
      role = r;
      expect(await changeMemberRole(M_MGR, "viewer")).toEqual({
        ok: false,
        error: "forbidden",
      });
    }
    expect(
      db.tables.company_memberships.find((m) => m.id === M_MGR)?.role
    ).toBe("manager");
  });
});
