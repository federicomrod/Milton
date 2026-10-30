// Pure status for a connection card: connected / needs review / error / not
// connected, from fields that exist (active flag, last sync, last error).

export type ConnectionStatus = "connected" | "review" | "error" | "none";
export type ConnectionReason =
  | "none"
  | "noSync"
  | "stale"
  | "noCompanies"
  | "unmatched"
  | "error"
  | "ok";

export interface ConnectionStatusInput {
  /** A connection row exists and is active. */
  active: boolean;
  /** ISO time of the last successful sync; null = never. */
  lastSyncAt: string | null;
  /** The last sync failed (a stored error). */
  hasError?: boolean;
  /** Odoo companies still have to be chosen. */
  companiesMissing?: boolean;
  /** The last sync left unmatched locations or dishes. */
  hasUnmatched?: boolean;
  /** Skip the sync-age check (e.g. Telegram has no syncs). */
  noSyncExpected?: boolean;
  now?: Date;
  staleAfterHours?: number;
}

export const STALE_AFTER_HOURS = 48;

export function deriveConnectionStatus(input: ConnectionStatusInput): {
  status: ConnectionStatus;
  reason: ConnectionReason;
} {
  if (!input.active) return { status: "none", reason: "none" };
  if (input.hasError) return { status: "error", reason: "error" };
  if (input.companiesMissing)
    return { status: "review", reason: "noCompanies" };
  if (input.noSyncExpected) return { status: "connected", reason: "ok" };
  const at = input.lastSyncAt ? new Date(input.lastSyncAt).getTime() : NaN;
  if (Number.isNaN(at)) return { status: "review", reason: "noSync" };
  const now = (input.now ?? new Date()).getTime();
  const limit = (input.staleAfterHours ?? STALE_AFTER_HOURS) * 3_600_000;
  if (now - at > limit) return { status: "review", reason: "stale" };
  if (input.hasUnmatched) return { status: "review", reason: "unmatched" };
  return { status: "connected", reason: "ok" };
}
