// Pure rules of the manager session (tested): when a token needs renewing and
// which company the app opens. No storage, no network.

import { ApiError } from "../api/client";
import type { ManagerCompany, ManagerTokens } from "./types";

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

/**
 * Equipo de cocina tools (PIN reset, new link, sign out a phone) and Cocina
 * without a link: the owner's, admin's and manager's «kitchen.team». The
 * session's capability list decides; while it does not list it yet, the role
 * does. The server checks again on every call.
 */
export function canManageKitchenTeam(company: ManagerCompany | null): boolean {
  if (!company) return false;
  if (company.capabilities.includes("kitchen.team")) return true;
  return (
    !!company.role &&
    (MANAGER_ROLES as readonly string[]).includes(company.role)
  );
}

/**
 * What happened when the session was renewed.
 *  - "ok": a new session is ready.
 *  - "rejected": the SERVER said no (revoked, expired or unknown refresh token):
 *    the only case that ends the session.
 *  - "unavailable": nothing was decided (no connection, a timeout, server
 *    trouble, a locked store): the login is kept and the person is asked to
 *    try again.
 */
export type RefreshOutcome = "ok" | "rejected" | "unavailable";

export function refreshOutcomeOf(err: unknown): "rejected" | "unavailable" {
  if (!(err instanceof ApiError)) return "unavailable";
  if (err.kind === "unauthorized") return "rejected";
  if (
    err.kind === "client" &&
    (err.status === 400 || err.status === 401 || err.status === 403)
  ) {
    return "rejected";
  }
  return "unavailable";
}

/** What the secure store said at launch. «unreadable» is NOT «signed out». */
export type TokenLoad =
  | { kind: "found"; tokens: ManagerTokens }
  | { kind: "absent" }
  | { kind: "unreadable" };

export function tokenLoadOf(reads: {
  access: string | null;
  refresh: string | null;
  meta: string | null;
}): TokenLoad {
  if (!reads.access || !reads.refresh || !reads.meta) return { kind: "absent" };
  try {
    const meta = JSON.parse(reads.meta) as {
      expiresAt: number | null;
      user: ManagerTokens["user"];
    };
    return {
      kind: "found",
      tokens: {
        accessToken: reads.access,
        refreshToken: reads.refresh,
        expiresAt: meta.expiresAt,
        user: meta.user,
      },
    };
  } catch {
    return { kind: "absent" };
  }
}

/** Reads again a few times when the store is not ready (a locked Keychain on a cold start). */
export async function loadTokensPatiently(
  load: () => Promise<TokenLoad>,
  wait: (ms: number) => Promise<void>,
  attempts = 3,
  delayMs = 300
): Promise<TokenLoad> {
  let last = await load();
  for (let i = 1; i < attempts && last.kind === "unreadable"; i++) {
    await wait(delayMs);
    last = await load();
  }
  return last;
}
