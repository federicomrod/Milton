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
  const own = input.ownCompanyName?.trim() || "tu espacio actual";
  const selected =
    input.selectedCompanyName?.trim() || "la empresa seleccionada";

  if (input.canSync) {
    return {
      targetLine: `Se sincronizará ${own}, el espacio en el que iniciaste sesión.`,
      blockedReason: null,
    };
  }

  return {
    targetLine: `«Sincronizar ahora» siempre actualiza ${own}, no ${selected}.`,
    blockedReason: `Elige ${own} arriba para activar «Sincronizar ahora».`,
  };
}

export function formatWorkspaceLastSyncLine(
  last: OdooLastSync | null,
  workspaceName: string | null,
  canSync: boolean
): string {
  const name = workspaceName?.trim() || "esta empresa";
  if (!last) {
    return canSync
      ? `Aún no se ha sincronizado ${name}. Elige un rango de fechas y toca «Sincronizar ahora».`
      : `No hay registro de sincronización de ${name}. «Sincronizar ahora» solo actualiza tu espacio actual.`;
  }
  const rest = formatLastSyncLine(last).replace(/^Última sincronización /, "");
  return `Última sincronización de ${name} · ${rest}`;
}
