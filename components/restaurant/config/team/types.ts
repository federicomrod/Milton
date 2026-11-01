// Plain, serializable shapes the Equipo section hands to its client panel.
// No auth user ids: a member is addressed by its membership row id, which only
// means something inside the caller's own company.

import { KNOWN_ROLES, type Role } from "@/lib/auth/capabilities";

/** The member's company role (the legacy «member» included). */
export type TeamRoleKind = Role;

export interface TeamMember {
  /** company_memberships.id (never the auth user id). */
  id: string;
  name: string | null;
  email: string | null;
  role: TeamRoleKind;
  isSelf: boolean;
  /** Milton support membership (migration 072): shown as «Soporte Milton». */
  isSupport?: boolean;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface TeamCook {
  id: string;
  name: string;
  location: string | null;
  via: "telegram" | "app";
}

/** A stored role as the badge shows it; a role the app does not know reads as «member». */
export function roleKind(role: string | null): TeamRoleKind {
  const r = (role ?? "").trim().toLowerCase();
  return (KNOWN_ROLES as readonly string[]).includes(r)
    ? (r as TeamRoleKind)
    : "member";
}
