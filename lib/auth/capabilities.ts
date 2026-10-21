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
  | "odoo.sync"
  | "odoo.diagnostics"
  | "imports.run"
  | "company.edit";

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
  // Odoo sync is Milton staff only.
  "odoo.sync": [],
  "odoo.diagnostics": OWNER_ADMIN,
  "imports.run": OWNER_ADMIN_MANAGER,
  // The company's own data (name, restaurants, agents settings): owner and admin.
  "company.edit": OWNER_ADMIN,
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
  "odoo.sync": DEFAULT_FORBIDDEN_MESSAGE,
  "odoo.diagnostics": DEFAULT_FORBIDDEN_MESSAGE,
  "imports.run": "Tu rol no puede importar recetas.",
  "company.edit": "Tu rol no puede cambiar los datos de la empresa.",
};

/** Every capability as a plain object: what the server sends to the client. */
export function capabilityFlags(actor: Actor): Record<Capability, boolean> {
  const flags = {} as Record<Capability, boolean>;
  for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
    flags[capability] = can(actor, capability);
  }
  return flags;
}
