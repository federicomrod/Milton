// lib/restaurant/sync-visibility.ts
//
// Sync now on the operating-page header is Milton-admin only
// (same gate as POST /api/restaurant/pos/odoo-sync). Non-admins
// never see the button — hide it instead of a disabled control.

export type SyncButtonVisibility = "shown" | "hidden";

export function syncButtonVisibility(
  isMiltonAdmin: boolean
): SyncButtonVisibility {
  return isMiltonAdmin ? "shown" : "hidden";
}

export function syncButtonHidden(isMiltonAdmin: boolean): boolean {
  return syncButtonVisibility(isMiltonAdmin) === "hidden";
}

/** @deprecated Use syncButtonHidden — kept so older tests still compile. */
export function syncButtonDisabled(isMiltonAdmin: boolean): boolean {
  return syncButtonHidden(isMiltonAdmin);
}
