// lib/restaurant/odoo/sync-summary.ts
//
// Human-readable view of POST /api/restaurant/pos/odoo-sync. Used by the
// admin Sync now panel and by the route when persisting last_sync. Pure:
// no I/O, no Odoo, no secrets. The unmatched item *list* stays in the
// live summary only; last_sync stores the count so we never write the
// ~200 KB dump onto restaurant_pos_connections.

import {
  localeFor,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export interface OdooSyncSuccessBody {
  synced_range: { start_date: string; end_date: string };
  orders_fetched: number;
  lines_fetched?: number;
  rows_upserted: number;
  rows_outside_requested_range_excluded?: number;
  lines_skipped?: Array<{ reason?: string }>;
  unmatched_menu_items?: string[];
  unmatched_locations?: string[];
  dimension_notes?: string[];
}

export interface OdooLastSync {
  synced_at: string;
  start_date: string;
  end_date: string;
  orders_fetched: number;
  rows_upserted: number;
  skipped_count: number;
  unmatched_menu_item_count: number;
  unmatched_locations: string[];
  warning_count: number;
}

export interface SkippedGroup {
  reason: string;
  count: number;
}

export interface OdooSyncSummaryView {
  startDate: string;
  endDate: string;
  ordersFetched: number;
  rowsSaved: number;
  skippedCount: number;
  skippedGroups: SkippedGroup[];
  unmatchedMenuItemCount: number;
  unmatchedMenuItems: string[];
  unmatchedLocations: string[];
  outsideRangeExcluded: number;
  warnings: string[];
}

export interface OdooSyncSummaryCopy {
  headline: string;
  skipped: string;
  unmatchedItems: string;
  unmatchedTills: string;
  unmatchedTillsNote: string;
  outsideRange: string | null;
}

const SKIP_REASON_LABELS: Array<{
  match: RegExp;
  en: string;
  es: string;
  de: string;
}> = [
  {
    match: /^Line has no order_id/i,
    en: "The line was missing its order",
    es: "A la línea le faltaba el pedido",
    de: "Der Position fehlte die Bestellung",
  },
  {
    match: /^Order not in a completed state/i,
    en: "The order was not completed",
    es: "El pedido no estaba completado",
    de: "Die Bestellung war nicht abgeschlossen",
  },
  {
    match: /^Non-finite quantity or price field/i,
    en: "The line had an invalid quantity or price",
    es: "La línea tenía una cantidad o un precio inválido",
    de: "Die Position hatte eine ungültige Menge oder einen ungültigen Preis",
  },
  {
    match: /^Invalid order date_order/i,
    en: "The order had an invalid date",
    es: "El pedido tenía una fecha inválida",
    de: "Die Bestellung hatte ein ungültiges Datum",
  },
  {
    match: /^Till-name location/i,
    en: "The till name pointed to a different location than the company mapping",
    es: "El nombre de la caja apuntaba a una ubicación distinta a la del mapeo de la empresa",
    de: "Der Kassenname verwies auf einen anderen Standort als die Unternehmenszuordnung",
  },
];

export function friendlySkipReason(
  reason: string,
  lang: PreferredLanguage = "es"
): string {
  for (const row of SKIP_REASON_LABELS) {
    if (row.match.test(reason)) return t(lang, row.en, row.es, row.de);
  }
  return t(
    lang,
    "The row could not be saved",
    "No se pudo guardar la fila",
    "Die Zeile konnte nicht gespeichert werden"
  );
}

export function formatCount(n: number, lang: PreferredLanguage = "es"): string {
  return n.toLocaleString(localeFor(lang));
}

export function formatSyncDateRange(
  startDate: string,
  endDate: string,
  lang: PreferredLanguage = "es"
): string {
  const start = formatHumanDate(startDate, lang);
  const end = formatHumanDate(endDate, lang);
  return startDate === endDate ? start : `${start} – ${end}`;
}

function formatHumanDate(isoDate: string, lang: PreferredLanguage): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function summarizeOdooSync(
  body: OdooSyncSuccessBody,
  lang: PreferredLanguage = "es"
): OdooSyncSummaryView {
  const skipped = body.lines_skipped ?? [];
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const label = friendlySkipReason(row.reason ?? "", lang);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const unmatchedMenuItems = [...(body.unmatched_menu_items ?? [])];
  return {
    startDate: body.synced_range.start_date,
    endDate: body.synced_range.end_date,
    ordersFetched: body.orders_fetched,
    rowsSaved: body.rows_upserted,
    skippedCount: skipped.length,
    skippedGroups: [...counts.entries()].map(([reason, count]) => ({
      reason,
      count,
    })),
    unmatchedMenuItemCount: unmatchedMenuItems.length,
    unmatchedMenuItems,
    unmatchedLocations: [...(body.unmatched_locations ?? [])],
    outsideRangeExcluded: body.rows_outside_requested_range_excluded ?? 0,
    warnings: [...(body.dimension_notes ?? [])],
  };
}

export function syncSummaryCopy(
  view: OdooSyncSummaryView,
  lang: PreferredLanguage = "es"
): OdooSyncSummaryCopy {
  const range = formatSyncDateRange(view.startDate, view.endDate, lang);
  const c = (n: number) => formatCount(n, lang);
  const orders = c(view.ordersFetched);
  const rows = c(view.rowsSaved);
  const tillCount = view.unmatchedLocations.length;
  const comboCount = view.unmatchedMenuItemCount;
  const one = view.skippedCount === 1;

  return {
    headline: t(
      lang,
      `I fetched ${orders} ${view.ordersFetched === 1 ? "order" : "orders"} and saved ${rows} sales ${view.rowsSaved === 1 ? "row" : "rows"} for ${range}.`,
      `Traje ${orders} ${view.ordersFetched === 1 ? "pedido" : "pedidos"} y guardé ${rows} ${view.rowsSaved === 1 ? "fila" : "filas"} de ventas de ${range}.`,
      `Ich habe ${orders} ${view.ordersFetched === 1 ? "Bestellung" : "Bestellungen"} abgerufen und ${rows} ${view.rowsSaved === 1 ? "Umsatzzeile" : "Umsatzzeilen"} für ${range} gespeichert.`
    ),
    skipped:
      view.skippedCount === 0
        ? t(
            lang,
            "No rows were skipped.",
            "No se omitió ninguna fila.",
            "Es wurde keine Zeile übersprungen."
          )
        : t(
            lang,
            `${c(view.skippedCount)} ${one ? "row was" : "rows were"} skipped.`,
            `${c(view.skippedCount)} ${one ? "fila" : "filas"} ${one ? "se omitió" : "se omitieron"}.`,
            `${c(view.skippedCount)} ${one ? "Zeile wurde" : "Zeilen wurden"} übersprungen.`
          ),
    // Info, not a warning: POS option combinations are saved as sales of the
    // product and do not affect costs.
    unmatchedItems:
      comboCount === 0
        ? t(
            lang,
            "Everything that synced matches your menu.",
            "Todo lo que se sincronizó coincide con tu menú.",
            "Alles, was synchronisiert wurde, passt zu Ihrer Speisekarte."
          )
        : comboCount === 1
          ? t(
              lang,
              "1 POS option combination is saved as sales of the product; it does not affect your costs.",
              "1 combinación de opciones del POS se guarda como ventas del producto; no afecta tus costos.",
              "1 Optionskombination der Kasse wird als Umsatz des Produkts gespeichert; sie wirkt sich nicht auf Ihre Kosten aus."
            )
          : t(
              lang,
              `${c(comboCount)} POS option combinations are saved as sales of the product; they do not affect your costs.`,
              `${c(comboCount)} combinaciones de opciones del POS se guardan como ventas del producto; no afectan tus costos.`,
              `${c(comboCount)} Optionskombinationen der Kasse werden als Umsatz des Produkts gespeichert; sie wirken sich nicht auf Ihre Kosten aus.`
            ),
    unmatchedTills:
      tillCount === 0
        ? t(
            lang,
            "All till names match a Milton location.",
            "Todos los nombres de caja coinciden con una ubicación de Milton.",
            "Alle Kassennamen entsprechen einem Standort in Milton."
          )
        : tillCount === 1
          ? t(
              lang,
              "1 till name is not a Milton location.",
              "1 nombre de caja no es una ubicación de Milton.",
              "1 Kassenname ist kein Standort in Milton."
            )
          : t(
              lang,
              `${c(tillCount)} till names are not a Milton location.`,
              `${c(tillCount)} nombres de caja no son una ubicación de Milton.`,
              `${c(tillCount)} Kassennamen sind kein Standort in Milton.`
            ),
    unmatchedTillsNote: t(
      lang,
      "For information only. Sales are assigned using the company-to-location mapping, not the till name.",
      "Es solo informativo. Las ventas se asignan con el mapeo de empresa a ubicación, no con el nombre de la caja.",
      "Nur zur Information. Umsätze werden über die Zuordnung von Unternehmen zu Standort zugewiesen, nicht über den Kassennamen."
    ),
    outsideRange:
      view.outsideRangeExcluded > 0
        ? t(
            lang,
            `${c(view.outsideRangeExcluded)} extra rows from neighboring days were ignored because they fall outside the dates you chose.`,
            `${c(view.outsideRangeExcluded)} filas extra de días vecinos se ignoraron porque quedan fuera de las fechas que elegiste.`,
            `${c(view.outsideRangeExcluded)} zusätzliche Zeilen benachbarter Tage wurden ignoriert, weil sie außerhalb des gewählten Zeitraums liegen.`
          )
        : null,
  };
}

export function compactLastSync(
  body: OdooSyncSuccessBody,
  syncedAt: Date = new Date()
): OdooLastSync {
  return {
    synced_at: syncedAt.toISOString(),
    start_date: body.synced_range.start_date,
    end_date: body.synced_range.end_date,
    orders_fetched: body.orders_fetched,
    rows_upserted: body.rows_upserted,
    skipped_count: (body.lines_skipped ?? []).length,
    unmatched_menu_item_count: (body.unmatched_menu_items ?? []).length,
    unmatched_locations: [...(body.unmatched_locations ?? [])],
    warning_count: (body.dimension_notes ?? []).length,
  };
}

export function formatLastSyncLine(
  last: OdooLastSync,
  lang: PreferredLanguage = "es"
): string {
  const when = new Date(last.synced_at);
  const whenLabel = Number.isNaN(when.getTime())
    ? last.synced_at
    : when.toLocaleString(localeFor(lang));
  const range = formatSyncDateRange(last.start_date, last.end_date, lang);
  const orders = formatCount(last.orders_fetched, lang);
  const rows = formatCount(last.rows_upserted, lang);
  return t(
    lang,
    `Last sync ${whenLabel} · ${range} · ${orders} orders · ${rows} rows saved`,
    `Última sincronización ${whenLabel} · ${range} · ${orders} pedidos · ${rows} filas guardadas`,
    `Letzte Synchronisierung ${whenLabel} · ${range} · ${orders} Bestellungen · ${rows} Zeilen gespeichert`
  );
}
