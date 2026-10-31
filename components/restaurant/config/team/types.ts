// Plain, serializable shapes the Equipo section hands to its client panel.
// No auth user ids: a member is addressed by its membership row id, which only
// means something inside the caller's own company.

export type TeamRoleKind = "owner" | "management" | "readOnly";

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
  role: "owner" | "member";
  expiresAt: string;
}

export interface TeamCook {
  id: string;
  name: string;
  location: string | null;
  via: "telegram" | "app";
}

export function roleKind(role: string | null): TeamRoleKind {
  const r = (role ?? "").trim().toLowerCase();
  if (r === "owner") return "owner";
  if (r === "analyst" || r === "viewer") return "readOnly";
  return "management";
}
