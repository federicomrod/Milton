// Who may hand out which team role (lib/auth/capabilities.ts).
import { describe, expect, it } from "vitest";
import {
  canGrantRole,
  canManageMemberRole,
  DEFAULT_TEAM_ROLE,
  isInviteRole,
  TEAM_ROLES,
} from "@/lib/auth/capabilities";

const as = (role: string | null, isMiltonStaff = false) => ({
  role,
  isMiltonStaff,
});

describe("team roles", () => {
  it("offers the five roles, Gerente by default", () => {
    expect([...TEAM_ROLES]).toEqual([
      "owner",
      "admin",
      "manager",
      "analyst",
      "viewer",
    ]);
    expect(DEFAULT_TEAM_ROLE).toBe("manager");
  });

  it("isInviteRole accepts the five and the legacy member, nothing else", () => {
    for (const r of [...TEAM_ROLES, "member", " Admin "])
      expect(isInviteRole(r), String(r)).toBe(true);
    for (const r of ["boss", "", null, undefined, 3])
      expect(isInviteRole(r), String(r)).toBe(false);
  });

  it("an owner grants every role", () => {
    for (const r of [...TEAM_ROLES, "member"])
      expect(canGrantRole(as("owner"), r)).toBe(true);
  });

  it("an admin grants up to admin, never owner", () => {
    expect(canGrantRole(as("admin"), "admin")).toBe(true);
    expect(canGrantRole(as("admin"), "viewer")).toBe(true);
    expect(canGrantRole(as("admin"), "owner")).toBe(false);
  });

  it("nobody else grants anything", () => {
    for (const r of ["manager", "analyst", "viewer", "member", "intern", null])
      for (const target of TEAM_ROLES)
        expect(canGrantRole(as(r), target), `${r} -> ${target}`).toBe(false);
  });

  it("Milton staff may grant like an owner; an unknown target never", () => {
    expect(canGrantRole(as(null, true), "owner")).toBe(true);
    expect(canGrantRole(as("owner"), "boss")).toBe(false);
  });

  it("an admin cannot manage an owner; an owner manages everyone", () => {
    expect(canManageMemberRole(as("admin"), "owner")).toBe(false);
    expect(canManageMemberRole(as("admin"), "admin")).toBe(true);
    expect(canManageMemberRole(as("admin"), "manager")).toBe(true);
    expect(canManageMemberRole(as("owner"), "owner")).toBe(true);
    expect(canManageMemberRole(as("manager"), "viewer")).toBe(false);
  });
});
