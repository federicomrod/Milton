// lib/restaurant/odoo/sync-workspace.ts
//
// Sync now always uses authAndCompany() (the admin's signed-in workspace).
// The /management/odoo company selector can point at a different company
// and load that company's last_sync. These helpers keep the panel honest:
// name the workspace that will actually sync, and refuse the button when
// the selector is not that workspace.

import { formatLastSyncLine, type OdooLastSync } from "./sync-summary";

export function canSyncSelectedWorkspace(
  selectedCompanyId: string | null | undefined,
  ownCompanyId: string | null | undefined
): boolean {
  if (!selectedCompanyId || !ownCompanyId) return false;
  return selectedCompanyId === ownCompanyId;
}

export function findOwnCompany<T extends { id: string; is_own?: boolean }>(
  companies: T[],
  ownCompanyId?: string | null
): T | null {
  const marked = companies.find((company) => company.is_own);
  if (marked) return marked;
  if (!ownCompanyId) return null;
  return companies.find((company) => company.id === ownCompanyId) ?? null;
}

export function syncWorkspaceCopy(input: {
  canSync: boolean;
  ownCompanyName: string | null;
  selectedCompanyName: string | null;
}): { targetLine: string; blockedReason: string | null } {
  const own = input.ownCompanyName?.trim() || "your signed-in workspace";
  const selected = input.selectedCompanyName?.trim() || "the selected company";

  if (input.canSync) {
    return {
      targetLine: `This will sync ${own} — the workspace you are signed into.`,
      blockedReason: null,
    };
  }

  return {
    targetLine: `Sync now always updates ${own}, not ${selected}.`,
    blockedReason: `Select ${own} above to enable Sync now.`,
  };
}

export function formatWorkspaceLastSyncLine(
  last: OdooLastSync | null,
  workspaceName: string | null,
  canSync: boolean
): string {
  const name = workspaceName?.trim() || "this company";
  if (!last) {
    return canSync
      ? `Not synced yet for ${name}. Pick a date range and click Sync now.`
      : `No last-sync record for ${name}. Sync now only updates your signed-in workspace.`;
  }
  const rest = formatLastSyncLine(last).replace(/^Last synced /, "");
  return `Last synced for ${name} · ${rest}`;
}
