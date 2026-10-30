// lib/restaurant/odoo/sync-workspace.ts
//
// Sync now always uses authAndCompany() (the admin's signed-in workspace).
// The /management/odoo company selector can point at a different company
// and load that company's last_sync. These helpers keep the panel honest:
// name the workspace that will actually sync, and refuse the button when
// the selector is not that workspace.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
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

export function syncWorkspaceCopy(
  input: {
    canSync: boolean;
    ownCompanyName: string | null;
    selectedCompanyName: string | null;
  },
  lang: PreferredLanguage = "es"
): { targetLine: string; blockedReason: string | null } {
  const own =
    input.ownCompanyName?.trim() ||
    t(
      lang,
      "your current workspace",
      "tu espacio actual",
      "Ihr aktueller Bereich"
    );
  const selected =
    input.selectedCompanyName?.trim() ||
    t(
      lang,
      "the selected company",
      "la empresa seleccionada",
      "das ausgewählte Unternehmen"
    );

  if (input.canSync) {
    return {
      targetLine: t(
        lang,
        `${own} will be synced, the workspace you signed in to.`,
        `Se sincronizará ${own}, el espacio en el que iniciaste sesión.`,
        `${own} wird synchronisiert, der Bereich, in dem Sie angemeldet sind.`
      ),
      blockedReason: null,
    };
  }

  return {
    targetLine: t(
      lang,
      `“Sync now” always updates ${own}, not ${selected}.`,
      `«Sincronizar ahora» siempre actualiza ${own}, no ${selected}.`,
      `„Jetzt synchronisieren“ aktualisiert immer ${own}, nicht ${selected}.`
    ),
    blockedReason: t(
      lang,
      `Choose ${own} above to enable “Sync now”.`,
      `Elige ${own} arriba para activar «Sincronizar ahora».`,
      `Wählen Sie oben ${own}, um „Jetzt synchronisieren“ zu aktivieren.`
    ),
  };
}

export function formatWorkspaceLastSyncLine(
  last: OdooLastSync | null,
  workspaceName: string | null,
  canSync: boolean,
  lang: PreferredLanguage = "es"
): string {
  const name =
    workspaceName?.trim() ||
    t(lang, "this company", "esta empresa", "dieses Unternehmen");
  if (!last) {
    return canSync
      ? t(
          lang,
          `${name} has not been synced yet. Choose a date range and tap “Sync now”.`,
          `Aún no se ha sincronizado ${name}. Elige un rango de fechas y toca «Sincronizar ahora».`,
          `${name} wurde noch nicht synchronisiert. Wählen Sie einen Zeitraum und tippen Sie auf „Jetzt synchronisieren“.`
        )
      : t(
          lang,
          `No sync record for ${name}. “Sync now” only updates your current workspace.`,
          `No hay registro de sincronización de ${name}. «Sincronizar ahora» solo actualiza tu espacio actual.`,
          `Kein Synchronisierungsprotokoll für ${name}. „Jetzt synchronisieren“ aktualisiert nur Ihren aktuellen Bereich.`
        );
  }
  const rest = formatLastSyncLine(last, lang).replace(
    /^(Última sincronización|Last sync|Letzte Synchronisierung) /,
    ""
  );
  return t(
    lang,
    `Last sync of ${name} · ${rest}`,
    `Última sincronización de ${name} · ${rest}`,
    `Letzte Synchronisierung von ${name} · ${rest}`
  );
}
