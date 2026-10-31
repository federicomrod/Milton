// Pure rules of the manager session (tested): when a token needs renewing and
// which company the app opens. No storage, no network.

import type { ManagerCompany } from "./types";

/** Renew a little before the access token ends. */
export const REFRESH_MARGIN_S = 60;

export function needsRefresh(
  expiresAt: number | null,
  nowMs: number = Date.now()
): boolean {
  if (expiresAt === null) return false;
  return expiresAt - nowMs / 1000 <= REFRESH_MARGIN_S;
}

/** Roles that may use Gestión (the server decides; this only drives the screens). */
export const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

export function canUseGestion(company: ManagerCompany | undefined): boolean {
  return (
    !!company &&
    !!company.role &&
    (MANAGER_ROLES as readonly string[]).includes(company.role)
  );
}

/** The company to open: the remembered one if it still works, else the first that does. */
export function pickCompany(
  companies: ManagerCompany[],
  remembered: string | null
): ManagerCompany | null {
  const usable = companies.filter(canUseGestion);
  return usable.find((c) => c.id === remembered) ?? usable[0] ?? null;
}

export type GestionAccess = "ok" | "none";

export function accessOf(companies: ManagerCompany[]): GestionAccess {
  return companies.some(canUseGestion) ? "ok" : "none";
}

/** Can this user create kitchen invites? (the owner's kitchen.qr capability) */
export function canInviteTeam(company: ManagerCompany | null): boolean {
  return !!company && company.capabilities.includes("kitchen.qr");
}
