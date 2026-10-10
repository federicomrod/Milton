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
  { match: /^Line has no order_id/i, label: "Line was missing an order" },
  {
    match: /^Order not in a completed state/i,
    label: "Order was not completed",
  },
  {
    match: /^Non-finite quantity or price field/i,
    label: "Line had an invalid quantity or price",
  },
  { match: /^Invalid order date_order/i, label: "Order had an invalid date" },
  {
    match: /^Till-name location/i,
    label: "Till name pointed at a different location than the company mapping",
  },
];

export function friendlySkipReason(reason: string): string {
  for (const { match, label } of SKIP_REASON_LABELS) {
    if (match.test(reason)) return label;
  }
  return "Row could not be saved";
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
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
  return new Intl.DateTimeFormat("en-GB", {
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
  const orderWord = view.ordersFetched === 1 ? "order" : "orders";
  const rowWord = view.rowsSaved === 1 ? "row" : "rows";
  const skipWord = view.skippedCount === 1 ? "row" : "rows";
  const itemWord =
    view.unmatchedMenuItemCount === 1 ? "menu item" : "menu items";
  const tillWord =
    view.unmatchedLocations.length === 1 ? "till name" : "till names";

  return {
    headline: `Fetched ${formatCount(view.ordersFetched)} ${orderWord} and saved ${formatCount(view.rowsSaved)} sales ${rowWord} for ${range}.`,
    skipped:
      view.skippedCount === 0
        ? "No rows were skipped."
        : `${formatCount(view.skippedCount)} ${skipWord} were skipped.`,
    unmatchedItems:
      view.unmatchedMenuItemCount === 0
        ? "Every synced item matched a Milton menu item."
        : `${formatCount(view.unmatchedMenuItemCount)} ${itemWord} did not match Milton’s menu.`,
    unmatchedTills:
      view.unmatchedLocations.length === 0
        ? "Every till name matched a Milton location."
        : `${formatCount(view.unmatchedLocations.length)} ${tillWord} ${view.unmatchedLocations.length === 1 ? "is" : "are"} not a Milton location.`,
    unmatchedTillsNote:
      "That’s informational. Sales are assigned by the company-to-location mapping, not by till name.",
    outsideRange:
      view.outsideRangeExcluded > 0
        ? `${formatCount(view.outsideRangeExcluded)} extra rows from neighboring days were ignored because they sit outside the dates you picked.`
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
    : when.toLocaleString();
  return `Last synced ${whenLabel} · ${formatSyncDateRange(last.start_date, last.end_date)} · ${formatCount(last.orders_fetched)} orders · ${formatCount(last.rows_upserted)} rows saved`;
}
