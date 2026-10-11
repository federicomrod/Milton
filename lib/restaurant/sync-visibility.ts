// lib/restaurant/sync-visibility.ts
//
// Sync now on the operating-page header is Milton-admin only
// (same gate as POST /api/restaurant/pos/odoo-sync). Non-admins
// never see an error — the button is disabled with a tooltip.

export type SyncButtonVisibility = "enabled" | "disabled";

export function syncButtonVisibility(
  isMiltonAdmin: boolean
): SyncButtonVisibility {
  return isMiltonAdmin ? "enabled" : "disabled";
}

export function syncButtonDisabled(isMiltonAdmin: boolean): boolean {
  return syncButtonVisibility(isMiltonAdmin) === "disabled";
}
