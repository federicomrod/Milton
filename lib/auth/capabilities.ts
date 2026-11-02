// lib/auth/capabilities.ts
//
// The pure half of lib/auth/permissions.ts: roles, the capability table and
// can(). No server imports, so client code and approval.ts can use it.
// Server-only pieces (reading the membership, building the 403) live in
// permissions.ts, which re-exports everything here.

export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "analyst"
  | "viewer"
  | "member";

export type Capability =
  | "recipes.edit"
  | "recipes.submit"
  | "recipes.approve"
  | "prices.edit"
  | "prices.view"
  | "links.confirm"
  | "ingredients.manage"
  | "menu.manage"
  | "groups.manage"
  | "locations.archive"
  | "targets.edit"
  | "shifts.edit"
  | "kitchen.drafts"
  | "kitchen.qr"
  | "costs.reset"
  | "costs.fixed"
  | "costs.buffer"
  | "odoo.sync"
  | "odoo.diagnostics"
  | "imports.run"
  | "company.edit"
  | "team.manage";

export const KNOWN_ROLES: readonly Role[] = [
  "owner",
  "admin",
  "manager",
  "analyst",
  "viewer",
  "member",
];

const OWNER_ADMIN: Role[] = ["owner", "admin"];
const OWNER_ADMIN_MANAGER: Role[] = ["owner", "admin", "manager"];

/**
 * Who may do what. `roles` are company roles; `staff` says whether Milton
 * staff pass without being a member (default true).
 */
export const CAPABILITIES: Record<Capability, Role[]> = {
  // Prepare, edit and send recipes to approval (owner, admin, manager).
  "recipes.edit": OWNER_ADMIN_MANAGER,
  "recipes.submit": OWNER_ADMIN_MANAGER,
  // Approve directly: owner and admin only. A manager submits; Milton staff
  // approve only after recording the client's confirmation (approval.ts).
  "recipes.approve": OWNER_ADMIN,
  "prices.edit": OWNER_ADMIN_MANAGER,
  // Prices and the merma values derived from them (Costo real, Impacto merma,
  // costo efectivo): everyone but the kitchen roles (member = cook).
  "prices.view": ["owner", "admin", "manager", "analyst", "viewer"],
  "links.confirm": OWNER_ADMIN_MANAGER,
  "ingredients.manage": OWNER_ADMIN_MANAGER,
  "menu.manage": OWNER_ADMIN_MANAGER,
  "groups.manage": OWNER_ADMIN_MANAGER,
  "locations.archive": OWNER_ADMIN_MANAGER,
  "targets.edit": OWNER_ADMIN_MANAGER,
  "shifts.edit": OWNER_ADMIN_MANAGER,
  "kitchen.drafts": OWNER_ADMIN_MANAGER,
  // QR codes, cooks and reports: the owner (and Milton staff).
  "kitchen.qr": ["owner"],
  // "Empezar de nuevo": owner and admin; Milton staff do NOT reset a client.
  "costs.reset": OWNER_ADMIN,
  // Costos fijos (rent, payroll, utilities, taxes %): owner, admin and manager.
  "costs.fixed": OWNER_ADMIN_MANAGER,
  // The restaurant's kitchen buffer (Merma de cocina %): owner, admin and manager.
  "costs.buffer": OWNER_ADMIN_MANAGER,
  // Odoo sync is Milton staff only.
  "odoo.sync": [],
  "odoo.diagnostics": OWNER_ADMIN,
  "imports.run": OWNER_ADMIN_MANAGER,
  // The company's own data (name, restaurants, agents settings): owner and admin.
  "company.edit": OWNER_ADMIN,
  // Invite, remove, revoke and change the role of web members (Configuración ›
  // Equipo): owner and admin. WHICH roles each may touch: canGrantRole below.
  "team.manage": OWNER_ADMIN,
};

/** Capabilities Milton staff do not get just by being staff. */
const STAFF_EXCLUDED: ReadonlySet<Capability> = new Set(["costs.reset"]);

export interface Actor {
  userId: string;
  /** The company the question is about (null when none could be resolved). */
  companyId: string | null;
  /** Trimmed, lowercased company role; null = no membership in that company. */
  role: string | null;
  isMiltonStaff: boolean;
}

export function normalizeRole(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const role = raw.trim().toLowerCase();
  return role || null;
}

/** True for the company owner (the one table for role names lives here). */
export function isOwnerRole(raw: unknown): boolean {
  return normalizeRole(raw) === "owner";
}

/**
 * The roles the team screen offers, highest first. «member» is the old
 * workspace-invite role: still valid on existing rows, no longer offered.
 */
export const TEAM_ROLES = [
  "owner",
  "admin",
  "manager",
  "analyst",
  "viewer",
] as const satisfies readonly Role[];
export type TeamRole = (typeof TEAM_ROLES)[number];

/** What a new invite is set to when nobody picks (Gerente). */
export const DEFAULT_TEAM_ROLE: TeamRole = "manager";

/** Every role a workspace invite can carry (the five plus the legacy «member»). */
export function isInviteRole(raw: unknown): raw is Role {
  const role = normalizeRole(raw);
  return role !== null && (KNOWN_ROLES as readonly string[]).includes(role);
}

const ROLE_RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  analyst: 2,
  viewer: 1,
  member: 1,
};

/** Milton staff act above every company role. */
function rankOf(actor: Pick<Actor, "role" | "isMiltonStaff">): number {
  if (actor.isMiltonStaff) return ROLE_RANK.owner;
  const role = normalizeRole(actor.role);
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : 0;
}

/**
 * May `actor` hand out `target` (invite with it, or set it on a member)?
 * Only owner and admin manage the team; nobody grants a role higher than their
 * own, so only an owner can make an owner. Unknown roles are never granted.
 */
export function canGrantRole(
  actor: Pick<Actor, "role" | "isMiltonStaff">,
  target: unknown
): boolean {
  if (!isInviteRole(target)) return false;
  const rank = rankOf(actor);
  if (rank < ROLE_RANK.admin) return false;
  return ROLE_RANK[normalizeRole(target) as Role] <= rank;
}

/**
 * May `actor` act on a member who currently has `current` (change their role
 * or remove them)? Same ladder: an admin cannot touch an owner.
 */
export function canManageMemberRole(
  actor: Pick<Actor, "role" | "isMiltonStaff">,
  current: unknown
): boolean {
  const rank = rankOf(actor);
  if (rank < ROLE_RANK.admin) return false;
  const role = normalizeRole(current);
  // A role the app does not know has nothing above the actor's.
  return !role || !(role in ROLE_RANK) || ROLE_RANK[role as Role] <= rank;
}

const warnedRoles = new Set<string>();

function isKnownRole(role: string): role is Role {
  return (KNOWN_ROLES as readonly string[]).includes(role);
}

/** True when the actor may do `capability`. Unknown roles get nothing. */
export function can(actor: Actor, capability: Capability): boolean {
  if (actor.isMiltonStaff && !STAFF_EXCLUDED.has(capability)) return true;
  const role = normalizeRole(actor.role);
  if (!role) return false;
  if (!isKnownRole(role)) {
    if (process.env.NODE_ENV !== "production" && !warnedRoles.has(role)) {
      warnedRoles.add(role);
      console.warn(`[permissions] unknown role "${role}" has no permissions`);
    }
    return false;
  }
  return CAPABILITIES[capability].includes(role);
}

/** Why the answer was no (dev logs only; never another tenant's ids). */
export function denialReason(actor: Actor): string {
  const role = normalizeRole(actor.role);
  if (!actor.companyId) return "company_mismatch";
  if (!role) return "no_membership";
  return `role:${role}`;
}

export const DEFAULT_FORBIDDEN_MESSAGE = "No tienes permiso para cambiar esto.";

export const CAPABILITY_MESSAGES: Record<Capability, string> = {
  "recipes.edit": "Tu rol no puede editar recetas.",
  "recipes.submit": "Tu rol no puede enviar recetas a aprobación.",
  "recipes.approve": "Tu rol no puede aprobar recetas.",
  "prices.edit": "Tu rol no puede cambiar precios.",
  "prices.view": "Tu rol no puede ver precios ni costos.",
  "links.confirm": "Tu rol no puede vincular productos.",
  "ingredients.manage": "Tu rol no puede cambiar los ingredientes.",
  "menu.manage": "Tu rol no puede cambiar los platos del menú.",
  "groups.manage": "Tu rol no puede cambiar las agrupaciones.",
  "locations.archive": "Tu rol no puede archivar restaurantes.",
  "targets.edit": "Tu rol no puede cambiar los objetivos.",
  "shifts.edit": "Tu rol no puede cambiar los turnos.",
  "kitchen.drafts": DEFAULT_FORBIDDEN_MESSAGE,
  "kitchen.qr": DEFAULT_FORBIDDEN_MESSAGE,
  "costs.reset": DEFAULT_FORBIDDEN_MESSAGE,
  "costs.fixed": "Tu rol no puede ver ni cambiar los costos fijos.",
  "costs.buffer": "Tu rol no puede cambiar la merma de cocina.",
  "odoo.sync": DEFAULT_FORBIDDEN_MESSAGE,
  "odoo.diagnostics": DEFAULT_FORBIDDEN_MESSAGE,
  "imports.run": "Tu rol no puede importar recetas.",
  "company.edit": "Tu rol no puede cambiar los datos de la empresa.",
  "team.manage":
    "Solo el propietario o un administrador puede gestionar el equipo.",
};

/** Every capability as a plain object: what the server sends to the client. */
export function capabilityFlags(actor: Actor): Record<Capability, boolean> {
  const flags = {} as Record<Capability, boolean>;
  for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
    flags[capability] = can(actor, capability);
  }
  return flags;
}
