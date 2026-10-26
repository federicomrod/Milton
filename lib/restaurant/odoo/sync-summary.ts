// lib/restaurant/odoo/sync-summary.ts
//
// Human-readable view of POST /api/restaurant/pos/odoo-sync. Used by the
// admin Sync now panel and by the route when persisting last_sync. Pure:
// no I/O, no Odoo, no secrets. The unmatched item *list* stays in the
// live summary only; last_sync stores the count so we never write the
// ~200 KB dump onto restaurant_pos_connections.

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

const SKIP_REASON_LABELS: Array<{ match: RegExp; label: string }> = [
  { match: /^Line has no order_id/i, label: "A la línea le faltaba el pedido" },
  {
    match: /^Order not in a completed state/i,
    label: "El pedido no estaba completado",
  },
  {
    match: /^Non-finite quantity or price field/i,
    label: "La línea tenía una cantidad o un precio inválido",
  },
  {
    match: /^Invalid order date_order/i,
    label: "El pedido tenía una fecha inválida",
  },
  {
    match: /^Till-name location/i,
    label:
      "El nombre de la caja apuntaba a una ubicación distinta a la del mapeo de la empresa",
  },
];

export function friendlySkipReason(reason: string): string {
  for (const { match, label } of SKIP_REASON_LABELS) {
    if (match.test(reason)) return label;
  }
  return "No se pudo guardar la fila";
}

export function formatCount(n: number): string {
  return n.toLocaleString("es-MX");
}

export function formatSyncDateRange(
  startDate: string,
  endDate: string
): string {
  const start = formatHumanDate(startDate);
  const end = formatHumanDate(endDate);
  return startDate === endDate ? start : `${start} – ${end}`;
}

function formatHumanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function summarizeOdooSync(
  body: OdooSyncSuccessBody
): OdooSyncSummaryView {
  const skipped = body.lines_skipped ?? [];
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const label = friendlySkipReason(row.reason ?? "");
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
  view: OdooSyncSummaryView
): OdooSyncSummaryCopy {
  const range = formatSyncDateRange(view.startDate, view.endDate);
  const orderWord = view.ordersFetched === 1 ? "pedido" : "pedidos";
  const rowWord = view.rowsSaved === 1 ? "fila" : "filas";
  const skipWord = view.skippedCount === 1 ? "fila" : "filas";
  const tillCount = view.unmatchedLocations.length;
  const comboCount = view.unmatchedMenuItemCount;

  return {
    headline: `Traje ${formatCount(view.ordersFetched)} ${orderWord} y guardé ${formatCount(view.rowsSaved)} ${rowWord} de ventas de ${range}.`,
    skipped:
      view.skippedCount === 0
        ? "No se omitió ninguna fila."
        : `${formatCount(view.skippedCount)} ${skipWord} ${view.skippedCount === 1 ? "se omitió" : "se omitieron"}.`,
    // Info, not a warning: POS option combinations are saved as sales of the
    // product and do not affect costs.
    unmatchedItems:
      comboCount === 0
        ? "Todo lo que se sincronizó coincide con tu menú."
        : comboCount === 1
          ? "1 combinación de opciones del POS se guarda como ventas del producto; no afecta tus costos."
          : `${formatCount(comboCount)} combinaciones de opciones del POS se guardan como ventas del producto; no afectan tus costos.`,
    unmatchedTills:
      tillCount === 0
        ? "Todos los nombres de caja coinciden con una ubicación de Milton."
        : tillCount === 1
          ? "1 nombre de caja no es una ubicación de Milton."
          : `${formatCount(tillCount)} nombres de caja no son una ubicación de Milton.`,
    unmatchedTillsNote:
      "Es solo informativo. Las ventas se asignan con el mapeo de empresa a ubicación, no con el nombre de la caja.",
    outsideRange:
      view.outsideRangeExcluded > 0
        ? `${formatCount(view.outsideRangeExcluded)} filas extra de días vecinos se ignoraron porque quedan fuera de las fechas que elegiste.`
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

export function formatLastSyncLine(last: OdooLastSync): string {
  const when = new Date(last.synced_at);
  const whenLabel = Number.isNaN(when.getTime())
    ? last.synced_at
    : when.toLocaleString("es-MX");
  return `Última sincronización ${whenLabel} · ${formatSyncDateRange(last.start_date, last.end_date)} · ${formatCount(last.orders_fetched)} pedidos · ${formatCount(last.rows_upserted)} filas guardadas`;
}
