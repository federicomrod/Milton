// lib/restaurant/sales-insights.ts
//
// Deterministic Sales-page insights. React only renders.
//
// Strongest / weakest weekday and the peak slot are ranked on the
// AVERAGE per distinct local date — not raw totals (#110 / #112).
// A weekday or weekday-hour needs at least MIN_*_OCCURRENCES dates
// before we call it a finding. Lunch/dinner share needs enough days
// and tickets. OpenAI may only reword the one-line read through the
// existing cockpit-insights-ai guards.

import {
  DINNER_START_HOUR,
  formatCompactDateRange,
  type CategoryMixRow,
  type CockpitFactRow,
  type CockpitSalesAggregate,
  type DaypartTotals,
  type HeatmapCell,
  type MixSeriesPoint,
} from "@/lib/restaurant/cockpit-aggregates";
import {
  formatCockpitMoney,
  localSaleDateKey,
  polishCockpitCopy,
} from "@/lib/restaurant/cockpit-executive";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import {
  inInclusiveRange,
  type CockpitPeriod,
} from "@/lib/restaurant/cockpit-period";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  localWeekdayAndHour,
  WEEKDAY_KEYS,
  type WeekdayKey,
} from "@/lib/restaurant/pos-local-time";
import {
  SALES_CATEGORY_TOP_N,
  type SalesExploreTab,
} from "@/lib/restaurant/sales-explore";
import { classifySaleLine, type Daypart } from "@/lib/restaurant/sales-revenue";
import type { ExplorerRow } from "@/lib/restaurant/supabase-sales";
import {
  salesCategoryLabel,
  salesChannelLabel,
  salesPaymentLabel,
} from "@/lib/restaurant/sales-channel-labels";

export { DINNER_START_HOUR };

/** A weekday needs this many distinct local dates before we rank it. */
export const MIN_WEEKDAY_OCCURRENCES = 2;
/** A weekday-hour needs this many distinct dates before we call it the peak. */
export const MIN_PEAK_SLOT_OCCURRENCES = 2;
/** Findings need this many distinct local dates with sales. */
export const MIN_DAYS_FOR_FINDINGS = 2;
/** Lunch/dinner share claims need this many tickets and MIN_DAYS_FOR_FINDINGS. */
export const MIN_TICKETS_FOR_DAYPART_SHARE = 20;
/** Understand shows at most this many deterministic facts. */
export const MAX_SALES_HIGHLIGHTS = 3;

const WEEKDAY_LABEL_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const WEEKDAY_LABEL_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

export type SalesAvailability = "empty" | "insufficient" | "ready";

export interface PeakSlot {
  weekday: number;
  weekday_key: WeekdayKey;
  hour: number;
  net_sales: number;
  tickets: number;
  days: number;
  avg_per_day: number;
}

export interface WeekdayStat {
  weekday: number;
  weekday_key: WeekdayKey;
  net_sales: number;
  tickets: number;
  days: number;
  avg_per_day: number;
}

export interface BestDate {
  date: string;
  weekday: number;
  weekday_key: WeekdayKey;
  net_sales: number;
  tickets: number;
}

export interface SalesDayStats {
  days_with_sales: number;
  tickets: number;
  weekdays: WeekdayStat[];
  slots: PeakSlot[];
  best_date: BestDate | null;
}

export interface DaypartSplit {
  lunch: DaypartTotals;
  dinner: DaypartTotals;
  winner: Daypart | "tie" | null;
  lunch_share_pct: number | null;
  dinner_share_pct: number | null;
  available: boolean;
  reason: string | null;
}

export interface RankedCategories {
  top: CategoryMixRow[];
  other: { net_sales: number; tickets: number; count: number } | null;
  total: number;
}

export interface MixSlice {
  key: string;
  net_sales: number;
}

export interface EnrichedHeatmapCell extends HeatmapCell {
  avg_ticket: number;
  typical_net: number;
  vs_typical_pct: number | null;
}

export type SalesHighlightId =
  | "peak_slot"
  | "weakest_weekday"
  | "daypart"
  | "strongest_weekday"
  | "best_date";

export interface SalesHighlight {
  id: SalesHighlightId;
  title: string;
  body: string;
  ask_question: string | null;
  facts: Record<string, number | string | null>;
}

export type SalesSummaryId = "channels" | "payments" | "categories";

export interface SalesSummary {
  id: SalesSummaryId;
  label: string;
  value: string;
  hint: string;
  available: boolean;
  explore_tab: SalesExploreTab;
}

export interface SalesInterpretation {
  title: string;
  body: string;
  facts: Record<string, number | string | null>;
}

export interface SalesInsights {
  availability: SalesAvailability;
  days_with_sales: number;
  peak_slot: PeakSlot | null;
  strongest_weekday: WeekdayStat | null;
  weakest_weekday: WeekdayStat | null;
  best_date: BestDate | null;
  daypart: DaypartSplit;
  ranked_categories: RankedCategories;
  channel_mix: MixSlice[];
  payment_mix: MixSlice[];
  heatmap: EnrichedHeatmapCell[];
  typical_net_by_hour: Record<number, number>;
  highlights: SalesHighlight[];
  investigate_facts: SalesHighlight[];
  summaries: SalesSummary[];
  period_ask_question: string;
  detail_ask_question: string;
  interpretation: SalesInterpretation | null;
  interpretationFact: CockpitInsightFact | null;
}

export interface SalesInsightsOptions {
  period?: { from: string; to: string } | null;
}

export function weekdayLabel(weekday: number, lang: PreferredLanguage): string {
  const i = ((weekday % 7) + 7) % 7;
  return lang === "es" ? WEEKDAY_LABEL_ES[i] : WEEKDAY_LABEL_EN[i];
}

export function hourLabel(hour: number): string {
  return `${String(Math.min(23, Math.max(0, Math.trunc(hour)))).padStart(2, "0")}:00`;
}

export function weekdayPlural(
  weekday: number,
  lang: PreferredLanguage
): string {
  const day = weekdayLabel(weekday, lang);
  if (lang === "es") {
    if (day === "sábado") return "sábados";
    if (day === "domingo") return "domingos";
    return day;
  }
  return `${day}s`;
}

export function ticketCountLabel(n: number, lang: PreferredLanguage): string {
  if (n === 1) return t(lang, "1 ticket", "1 ticket");
  return t(lang, `${n} tickets`, `${n} tickets`);
}

export function filterRowsForSalesPeriod(
  rows: CockpitFactRow[],
  period: CockpitPeriod,
  timezone: string
): CockpitFactRow[] {
  return rows.filter((row) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) return false;
    const dateKey = localSaleDateKey(row, timezone);
    return inInclusiveRange(dateKey, period.current);
  });
}

export function filterExplorerRowsForPeriod(
  rows: ExplorerRow[],
  period: CockpitPeriod
): ExplorerRow[] {
  return rows.filter((row) => inInclusiveRange(row.sale_date, period.current));
}

export function salesDayStatsFromRows(
  rows: CockpitFactRow[],
  options: { timezone?: string; currency?: string } = {}
): SalesDayStats {
  const timezone = options.timezone ?? "UTC";
  const currency = options.currency;
  const byDate = new Map<
    string,
    { weekday: number; net: number; orders: Set<string> }
  >();
  const bySlot = new Map<
    string,
    {
      weekday: number;
      hour: number;
      net: number;
      orders: Set<string>;
      dates: Set<string>;
    }
  >();

  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    const line = classifySaleLine(row);
    const local = localWeekdayAndHour(
      {
        sale_date: row.sale_date,
        order_placed_at: row.order_placed_at ?? null,
        business_cutoff_min: row.business_cutoff_min ?? null,
      },
      timezone
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(local.dateKey)) continue;
    const key = row.check_id ?? row.order_id ?? null;

    if (!line.isTip) {
      let day = byDate.get(local.dateKey);
      if (!day) {
        day = { weekday: local.weekday, net: 0, orders: new Set() };
        byDate.set(local.dateKey, day);
      }
      day.net += line.net;
      if (key) day.orders.add(key);
    }

    if (local.hour !== null && !line.isTip) {
      const slotKey = `${local.weekday}-${local.hour}`;
      let slot = bySlot.get(slotKey);
      if (!slot) {
        slot = {
          weekday: local.weekday,
          hour: local.hour,
          net: 0,
          orders: new Set(),
          dates: new Set(),
        };
        bySlot.set(slotKey, slot);
      }
      slot.net += line.net;
      slot.dates.add(local.dateKey);
      if (key) slot.orders.add(key);
    }
  }

  const weekdays = weekdayStatsFromDates(byDate);
  const slots: PeakSlot[] = Array.from(bySlot.values())
    .map((slot) => ({
      weekday: slot.weekday,
      weekday_key: WEEKDAY_KEYS[slot.weekday],
      hour: slot.hour,
      net_sales: round2(slot.net),
      tickets: slot.orders.size,
      days: slot.dates.size,
      avg_per_day: slot.dates.size > 0 ? round2(slot.net / slot.dates.size) : 0,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);

  let best_date: BestDate | null = null;
  for (const [date, day] of byDate) {
    if (day.net <= 0) continue;
    if (!best_date || day.net > best_date.net_sales) {
      best_date = {
        date,
        weekday: day.weekday,
        weekday_key: WEEKDAY_KEYS[day.weekday],
        net_sales: round2(day.net),
        tickets: day.orders.size,
      };
    } else if (day.net === best_date.net_sales && date < best_date.date) {
      best_date = {
        date,
        weekday: day.weekday,
        weekday_key: WEEKDAY_KEYS[day.weekday],
        net_sales: round2(day.net),
        tickets: day.orders.size,
      };
    }
  }

  const days_with_sales = Array.from(byDate.values()).filter(
    (d) => d.net > 0
  ).length;
  const tickets = new Set<string>();
  for (const day of byDate.values()) {
    for (const order of day.orders) tickets.add(order);
  }

  return {
    days_with_sales,
    tickets: tickets.size,
    weekdays,
    slots,
    best_date,
  };
}

function weekdayStatsFromDates(
  byDate: Map<string, { weekday: number; net: number; orders: Set<string> }>
): WeekdayStat[] {
  const buckets = new Map<
    number,
    { net: number; orders: Set<string>; dates: Set<string> }
  >();
  for (let i = 0; i < 7; i++) {
    buckets.set(i, { net: 0, orders: new Set(), dates: new Set() });
  }
  for (const [date, day] of byDate) {
    const bucket = buckets.get(day.weekday)!;
    bucket.net += day.net;
    if (day.net > 0) bucket.dates.add(date);
    for (const order of day.orders) bucket.orders.add(order);
  }
  return Array.from(buckets.entries()).map(([weekday, bucket]) => ({
    weekday,
    weekday_key: WEEKDAY_KEYS[weekday],
    net_sales: round2(bucket.net),
    tickets: bucket.orders.size,
    days: bucket.dates.size,
    avg_per_day:
      bucket.dates.size > 0 ? round2(bucket.net / bucket.dates.size) : 0,
  }));
}

export function findPeakSlot(slots: PeakSlot[]): PeakSlot | null {
  const ranked = slots
    .filter((s) => s.avg_per_day > 0 && s.days >= MIN_PEAK_SLOT_OCCURRENCES)
    .sort((a, b) => {
      if (b.avg_per_day !== a.avg_per_day) return b.avg_per_day - a.avg_per_day;
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      return a.hour - b.hour;
    });
  return ranked[0] ?? null;
}

export function findStrongestWeekday(
  weekdays: WeekdayStat[]
): WeekdayStat | null {
  return pickWeekday(weekdays, "max");
}

export function findWeakestWeekday(
  weekdays: WeekdayStat[]
): WeekdayStat | null {
  return pickWeekday(weekdays, "min");
}

function pickWeekday(
  weekdays: WeekdayStat[],
  mode: "max" | "min"
): WeekdayStat | null {
  const active = weekdays.filter(
    (row) => row.avg_per_day > 0 && row.days >= MIN_WEEKDAY_OCCURRENCES
  );
  if (active.length === 0) return null;
  return active.reduce((best, row) => {
    if (mode === "max") {
      if (row.avg_per_day !== best.avg_per_day) {
        return row.avg_per_day > best.avg_per_day ? row : best;
      }
    } else if (row.avg_per_day !== best.avg_per_day) {
      return row.avg_per_day < best.avg_per_day ? row : best;
    }
    return row.weekday < best.weekday ? row : best;
  });
}

export function lunchVsDinner(dayparts: DaypartTotals[]): {
  lunch: DaypartTotals;
  dinner: DaypartTotals;
  winner: Daypart | "tie";
  lunch_share_pct: number | null;
  dinner_share_pct: number | null;
} {
  const lunch =
    dayparts.find((d) => d.daypart === "lunch") ?? emptyDaypart("lunch");
  const dinner =
    dayparts.find((d) => d.daypart === "dinner") ?? emptyDaypart("dinner");
  const total = lunch.net_sales + dinner.net_sales;
  const lunchShare = total > 0 ? round1((lunch.net_sales / total) * 100) : null;
  const dinnerShare =
    total > 0 ? round1((dinner.net_sales / total) * 100) : null;
  let winner: Daypart | "tie" = "tie";
  if (dinner.net_sales > lunch.net_sales) winner = "dinner";
  else if (lunch.net_sales > dinner.net_sales) winner = "lunch";
  return {
    lunch,
    dinner,
    winner,
    lunch_share_pct: lunchShare,
    dinner_share_pct: dinnerShare,
  };
}

export function rankCategories(
  rows: CategoryMixRow[],
  topN: number = SALES_CATEGORY_TOP_N
): RankedCategories {
  const n =
    Number.isFinite(topN) && topN > 0 ? Math.trunc(topN) : SALES_CATEGORY_TOP_N;
  const sorted = [...rows].sort((a, b) => {
    if (b.net_sales !== a.net_sales) return b.net_sales - a.net_sales;
    return (a.category ?? "").localeCompare(b.category ?? "");
  });
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  return {
    top,
    other:
      rest.length > 0
        ? {
            net_sales: round2(rest.reduce((s, r) => s + r.net_sales, 0)),
            tickets: rest.reduce((s, r) => s + r.tickets, 0),
            count: rest.length,
          }
        : null,
    total: sorted.length,
  };
}

export function flattenMixSeries(series: MixSeriesPoint[]): MixSlice[] {
  const totals = new Map<string, number>();
  for (const point of series) {
    for (const [key, value] of Object.entries(point.values)) {
      if (!Number.isFinite(value)) continue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }
  return Array.from(totals.entries())
    .map(([key, net_sales]) => ({ key, net_sales: round2(net_sales) }))
    .sort((a, b) => {
      if (b.net_sales !== a.net_sales) return b.net_sales - a.net_sales;
      return a.key.localeCompare(b.key);
    });
}

export function typicalNetByHour(cells: HeatmapCell[]): Record<number, number> {
  const acc = new Map<number, { sum: number; n: number }>();
  for (const cell of cells) {
    const cur = acc.get(cell.hour) ?? { sum: 0, n: 0 };
    cur.sum += cell.net_sales;
    cur.n += 1;
    acc.set(cell.hour, cur);
  }
  const out: Record<number, number> = {};
  for (const [hour, bucket] of acc) {
    out[hour] = bucket.n > 0 ? round2(bucket.sum / bucket.n) : 0;
  }
  return out;
}

export function enrichHeatmapCells(
  cells: HeatmapCell[]
): EnrichedHeatmapCell[] {
  const typical = typicalNetByHour(cells);
  return cells.map((cell) => {
    const avg_ticket = cell.tickets > 0 ? cell.net_sales / cell.tickets : 0;
    const typical_net = typical[cell.hour] ?? 0;
    const vs_typical_pct =
      typical_net > 0
        ? round1(((cell.net_sales - typical_net) / typical_net) * 100)
        : null;
    return {
      ...cell,
      avg_ticket: round2(avg_ticket),
      typical_net,
      vs_typical_pct,
    };
  });
}

export function buildSalesInsights(
  agg: CockpitSalesAggregate,
  lang: PreferredLanguage,
  stats: SalesDayStats,
  options: SalesInsightsOptions = {}
): SalesInsights {
  const availability: SalesAvailability =
    agg.revenue.net_sales <= 0 && stats.days_with_sales === 0
      ? "empty"
      : stats.days_with_sales < MIN_DAYS_FOR_FINDINGS
        ? "insufficient"
        : "ready";

  const canFind =
    availability === "ready" && stats.days_with_sales >= MIN_DAYS_FOR_FINDINGS;
  const peak = canFind ? findPeakSlot(stats.slots) : null;
  const strongest = canFind ? findStrongestWeekday(stats.weekdays) : null;
  const weakestRaw = canFind ? findWeakestWeekday(stats.weekdays) : null;
  const weakest =
    weakestRaw && strongest && weakestRaw.weekday === strongest.weekday
      ? null
      : weakestRaw;
  const bestDate =
    canFind && stats.best_date && stats.days_with_sales >= MIN_DAYS_FOR_FINDINGS
      ? stats.best_date
      : null;

  const rawDaypart = lunchVsDinner(agg.dayparts);
  const daypartAvailable =
    availability === "ready" &&
    stats.days_with_sales >= MIN_DAYS_FOR_FINDINGS &&
    agg.tickets >= MIN_TICKETS_FOR_DAYPART_SHARE;
  const daypart = resolveDaypartSplit(rawDaypart, availability, lang, {
    available: daypartAvailable,
  });

  const money = (n: number, digits = 0) =>
    formatCockpitMoney(n, agg.currency, digits);
  const ranked_categories = rankCategories(agg.category_mix);
  const channel_mix = flattenMixSeries(agg.channel_mix_over_time);
  const payment_mix = flattenMixSeries(agg.payment_mix_over_time);
  const { highlights, investigate_facts } = buildHighlightSets({
    lang,
    money,
    availability,
    peak,
    strongest,
    weakest,
    bestDate,
    daypart,
  });
  const summaries = buildSummaries({
    lang,
    money,
    channel_mix,
    payment_mix,
    ranked_categories,
    availability,
  });
  const periodLabel = options.period
    ? formatCompactDateRange(
        options.period.from,
        options.period.to,
        lang === "es" ? "es" : "en-GB"
      )
    : null;
  const period_ask_question = buildPeriodAskQuestion({
    lang,
    periodLabel,
    availability,
  });
  const detail_ask_question = buildDetailAskQuestion({
    lang,
    periodLabel,
  });
  const interpretation = buildInterpretation({
    lang,
    money,
    peak,
    daypart,
    strongest,
    agg,
    availability,
  });

  return {
    availability,
    days_with_sales: stats.days_with_sales,
    peak_slot: peak,
    strongest_weekday: strongest,
    weakest_weekday: weakest,
    best_date: bestDate,
    daypart,
    ranked_categories,
    channel_mix,
    payment_mix,
    heatmap: enrichHeatmapCells(agg.heatmap),
    typical_net_by_hour: typicalNetByHour(agg.heatmap),
    highlights,
    investigate_facts,
    summaries,
    period_ask_question,
    detail_ask_question,
    interpretation,
    interpretationFact: interpretation
      ? {
          id: "sales_interpretation",
          kind: "sales_change",
          score: 1,
          facts: interpretation.facts,
          title: interpretation.title,
          body: interpretation.body,
        }
      : null,
  };
}

function resolveDaypartSplit(
  raw: ReturnType<typeof lunchVsDinner>,
  availability: SalesAvailability,
  lang: PreferredLanguage,
  opts: { available: boolean }
): DaypartSplit {
  if (availability === "empty") {
    return {
      ...raw,
      winner: null,
      lunch_share_pct: null,
      dinner_share_pct: null,
      available: false,
      reason: t(
        lang,
        "No sales in this period.",
        "No hay ventas en este periodo."
      ),
    };
  }
  if (!opts.available) {
    return {
      ...raw,
      winner: null,
      lunch_share_pct: null,
      dinner_share_pct: null,
      available: false,
      reason: t(
        lang,
        `Need at least ${MIN_DAYS_FOR_FINDINGS} days with sales and ${MIN_TICKETS_FOR_DAYPART_SHARE} tickets to compare lunch and dinner.`,
        `Se necesitan al menos ${MIN_DAYS_FOR_FINDINGS} días con ventas y ${MIN_TICKETS_FOR_DAYPART_SHARE} tickets para comparar almuerzo y cena.`
      ),
    };
  }
  return {
    ...raw,
    available: true,
    reason: null,
  };
}

function weekdayAveragePhrase(
  stat: WeekdayStat,
  lang: PreferredLanguage,
  money: (n: number, digits?: number) => string
): string {
  const day = weekdayLabel(stat.weekday, lang);
  const days = weekdayPlural(stat.weekday, lang);
  return polishCockpitCopy(
    lang,
    t(
      lang,
      `${money(stat.avg_per_day)} per ${day} (total of the ${stat.days} ${days}: ${money(stat.net_sales)})`,
      `${money(stat.avg_per_day)} por ${day} (total de los ${stat.days} ${days}: ${money(stat.net_sales)})`
    )
  );
}

function slotAveragePhrase(
  slot: PeakSlot,
  lang: PreferredLanguage,
  money: (n: number, digits?: number) => string
): string {
  const day = weekdayLabel(slot.weekday, lang);
  const hour = hourLabel(slot.hour);
  return polishCockpitCopy(
    lang,
    t(
      lang,
      `${money(slot.avg_per_day)} per ${day} at ${hour} (total of the ${slot.days} times: ${money(slot.net_sales)})`,
      `${money(slot.avg_per_day)} por ${day} a las ${hour} (total de las ${slot.days} veces: ${money(slot.net_sales)})`
    )
  );
}

export function shareLabel(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function topMixShare(
  slices: MixSlice[]
): { key: string; net_sales: number; share_pct: number } | null {
  const total = slices.reduce((sum, row) => sum + row.net_sales, 0);
  const top = slices.find((row) => row.net_sales > 0);
  if (!top || total <= 0) return null;
  return {
    key: top.key,
    net_sales: top.net_sales,
    share_pct: round1((top.net_sales / total) * 100),
  };
}

export function heatmapCellAskQuestion(
  weekday: number,
  hour: number,
  lang: PreferredLanguage
): string {
  const day = weekdayLabel(weekday, lang);
  const hourText = hourLabel(hour);
  return polishCockpitCopy(
    lang,
    t(
      lang,
      `Why is this period so strong? (${day} ${hourText})`,
      `¿Por qué este periodo es tan fuerte? (${day} ${hourText})`
    )
  );
}

export function buildPeriodAskQuestion({
  lang,
  periodLabel,
  availability,
}: {
  lang: PreferredLanguage;
  periodLabel?: string | null;
  availability: SalesAvailability;
}): string {
  const range = periodLabel?.trim() || null;
  if (availability === "empty") {
    return polishCockpitCopy(
      lang,
      range
        ? t(
            lang,
            `What can you tell me about sales in ${range}? There are no sales in this period.`,
            `¿Qué puedes decirme de las ventas de ${range}? No hay ventas en este periodo.`
          )
        : t(
            lang,
            "What can you tell me about sales in this period? There are no sales yet.",
            "¿Qué puedes decirme de las ventas de este periodo? Aún no hay ventas."
          )
    );
  }
  return polishCockpitCopy(
    lang,
    range
      ? t(
          lang,
          `What stands out in sales for ${range}?`,
          `¿Qué destaca de las ventas de ${range}?`
        )
      : t(
          lang,
          "What stands out in sales for this period?",
          "¿Qué destaca de las ventas de este periodo?"
        )
  );
}

export function buildDetailAskQuestion({
  lang,
  periodLabel,
}: {
  lang: PreferredLanguage;
  periodLabel?: string | null;
}): string {
  const range = periodLabel?.trim() || null;
  return polishCockpitCopy(
    lang,
    range
      ? t(
          lang,
          `What else should I review in the sales detail for ${range}?`,
          `¿Qué más debo revisar en el detalle de ventas de ${range}?`
        )
      : t(
          lang,
          "What else should I review in this sales detail?",
          "¿Qué más debo revisar en el detalle de este periodo?"
        )
  );
}

function daypartHighlightCopy(
  daypart: DaypartSplit,
  lang: PreferredLanguage,
  money: (n: number, digits?: number) => string
): { value: string; hint: string } {
  const value =
    daypart.winner === "dinner"
      ? t(lang, "Dinner leads", "Gana la cena")
      : daypart.winner === "lunch"
        ? t(lang, "Lunch leads", "Gana el almuerzo")
        : t(lang, "Even split", "Empate");
  const hint =
    daypart.winner === "tie"
      ? t(
          lang,
          `Lunch ${money(daypart.lunch.net_sales)} · dinner ${money(daypart.dinner.net_sales)}`,
          `Almuerzo ${money(daypart.lunch.net_sales)} · cena ${money(daypart.dinner.net_sales)}`
        )
      : daypart.winner === "dinner"
        ? t(
            lang,
            `Dinner ${shareLabel(daypart.dinner_share_pct)} · lunch ${shareLabel(daypart.lunch_share_pct)}`,
            `Cena ${shareLabel(daypart.dinner_share_pct)} · almuerzo ${shareLabel(daypart.lunch_share_pct)}`
          )
        : t(
            lang,
            `Lunch ${shareLabel(daypart.lunch_share_pct)} · dinner ${shareLabel(daypart.dinner_share_pct)}`,
            `Almuerzo ${shareLabel(daypart.lunch_share_pct)} · cena ${shareLabel(daypart.dinner_share_pct)}`
          );
  return {
    value: polishCockpitCopy(lang, value),
    hint: polishCockpitCopy(lang, hint),
  };
}

function buildHighlightSets({
  lang,
  money,
  availability,
  peak,
  strongest,
  weakest,
  bestDate,
  daypart,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  availability: SalesAvailability;
  peak: PeakSlot | null;
  strongest: WeekdayStat | null;
  weakest: WeekdayStat | null;
  bestDate: BestDate | null;
  daypart: DaypartSplit;
}): { highlights: SalesHighlight[]; investigate_facts: SalesHighlight[] } {
  if (availability !== "ready") {
    return { highlights: [], investigate_facts: [] };
  }
  const highlights: SalesHighlight[] = [];
  const investigate_facts: SalesHighlight[] = [];

  if (peak) {
    const day = weekdayLabel(peak.weekday, lang);
    const hour = hourLabel(peak.hour);
    const avgPhrase = slotAveragePhrase(peak, lang, money);
    highlights.push({
      id: "peak_slot",
      title: polishCockpitCopy(
        lang,
        t(lang, "Busiest slot", "Franja más fuerte")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} ${hour} · ${avgPhrase} · ${ticketCountLabel(peak.tickets, lang)}`,
          `${day} ${hour} · ${avgPhrase} · ${ticketCountLabel(peak.tickets, lang)}`
        )
      ),
      ask_question: heatmapCellAskQuestion(peak.weekday, peak.hour, lang),
      facts: {
        weekday: peak.weekday,
        hour: peak.hour,
        net_sales: peak.net_sales,
        avg_per_day: peak.avg_per_day,
        days: peak.days,
        tickets: peak.tickets,
      },
    });
  }

  if (weakest) {
    const day = weekdayLabel(weakest.weekday, lang);
    const avgPhrase = weekdayAveragePhrase(weakest, lang, money);
    highlights.push({
      id: "weakest_weekday",
      title: polishCockpitCopy(
        lang,
        t(lang, "Weakest weekday", "Día más flojo")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day}: ${avgPhrase} · ${ticketCountLabel(weakest.tickets, lang)}`,
          `${day}: ${avgPhrase} · ${ticketCountLabel(weakest.tickets, lang)}`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `What is happening on ${day}, the weakest weekday by average, at ${money(weakest.avg_per_day)} per ${day}?`,
          `¿Qué está pasando el ${day}, el día más flojo por promedio, con ${money(weakest.avg_per_day)} por ${day}?`
        )
      ),
      facts: {
        weekday: weakest.weekday,
        net_sales: weakest.net_sales,
        avg_per_day: weakest.avg_per_day,
        days: weakest.days,
        tickets: weakest.tickets,
      },
    });
  }

  if (daypart.available) {
    const copy = daypartHighlightCopy(daypart, lang, money);
    highlights.push({
      id: "daypart",
      title: polishCockpitCopy(
        lang,
        t(lang, "Lunch vs dinner", "Almuerzo vs cena")
      ),
      body: polishCockpitCopy(lang, `${copy.value} · ${copy.hint}`),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          "Why does lunch vs dinner look like this in this period?",
          "¿Por qué el almuerzo y la cena quedan así en este periodo?"
        )
      ),
      facts: {
        lunch_net: daypart.lunch.net_sales,
        dinner_net: daypart.dinner.net_sales,
        lunch_share_pct: daypart.lunch_share_pct,
        dinner_share_pct: daypart.dinner_share_pct,
        winner: daypart.winner,
      },
    });
  }

  if (strongest) {
    const day = weekdayLabel(strongest.weekday, lang);
    const avgPhrase = weekdayAveragePhrase(strongest, lang, money);
    investigate_facts.push({
      id: "strongest_weekday",
      title: polishCockpitCopy(
        lang,
        t(lang, "Strongest weekday", "Día más fuerte")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day}: ${avgPhrase} · ${ticketCountLabel(strongest.tickets, lang)}`,
          `${day}: ${avgPhrase} · ${ticketCountLabel(strongest.tickets, lang)}`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `What makes ${day} the strongest weekday by average, at ${money(strongest.avg_per_day)} per ${day} (total of the ${strongest.days} ${weekdayPlural(strongest.weekday, lang)}: ${money(strongest.net_sales)})?`,
          `¿Qué hace del ${day} el día más fuerte por promedio, con ${money(strongest.avg_per_day)} por ${day} (total de los ${strongest.days} ${weekdayPlural(strongest.weekday, lang)}: ${money(strongest.net_sales)})?`
        )
      ),
      facts: {
        weekday: strongest.weekday,
        net_sales: strongest.net_sales,
        avg_per_day: strongest.avg_per_day,
        days: strongest.days,
        tickets: strongest.tickets,
      },
    });
  }

  if (bestDate) {
    const day = weekdayLabel(bestDate.weekday, lang);
    const dateLabel = formatCompactDateRange(
      bestDate.date,
      bestDate.date,
      lang === "es" ? "es" : "en-GB"
    );
    investigate_facts.push({
      id: "best_date",
      title: polishCockpitCopy(
        lang,
        t(lang, "Best single day", "Mejor día suelto")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} ${dateLabel} · ${money(bestDate.net_sales)} · ${ticketCountLabel(bestDate.tickets, lang)}`,
          `${day} ${dateLabel} · ${money(bestDate.net_sales)} · ${ticketCountLabel(bestDate.tickets, lang)}`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `What happened on ${day} ${dateLabel}, the best single day, with ${money(bestDate.net_sales)} in net sales?`,
          `¿Qué pasó el ${day} ${dateLabel}, el mejor día suelto, con ${money(bestDate.net_sales)} en ventas netas?`
        )
      ),
      facts: {
        date: bestDate.date,
        weekday: bestDate.weekday,
        net_sales: bestDate.net_sales,
        tickets: bestDate.tickets,
      },
    });
  }

  return {
    highlights: highlights.slice(0, MAX_SALES_HIGHLIGHTS),
    investigate_facts,
  };
}

function mixSummary({
  id,
  label,
  emptyHint,
  top,
  name,
  lang,
  money,
}: {
  id: SalesSummaryId;
  label: string;
  emptyHint: string;
  top: { key: string; net_sales: number; share_pct: number } | null;
  name: string | null;
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
}): SalesSummary {
  const explore_tab: SalesExploreTab = id;
  if (!top || !name) {
    return {
      id,
      label,
      value: t(lang, "Not available yet", "Aún no disponible"),
      hint: polishCockpitCopy(lang, emptyHint),
      available: false,
      explore_tab,
    };
  }
  return {
    id,
    label,
    value: polishCockpitCopy(lang, `${name} · ${shareLabel(top.share_pct)}`),
    hint: polishCockpitCopy(
      lang,
      t(
        lang,
        `${money(top.net_sales, 2)} net`,
        `${money(top.net_sales, 2)} netas`
      )
    ),
    available: true,
    explore_tab,
  };
}

function buildSummaries({
  lang,
  money,
  channel_mix,
  payment_mix,
  ranked_categories,
  availability,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  channel_mix: MixSlice[];
  payment_mix: MixSlice[];
  ranked_categories: RankedCategories;
  availability: SalesAvailability;
}): SalesSummary[] {
  const emptyHint =
    availability === "empty"
      ? t(lang, "No sales in this period.", "No hay ventas en este periodo.")
      : t(lang, "Not enough mix yet.", "Aún no hay mix suficiente.");
  const categorySlices: MixSlice[] = [
    ...ranked_categories.top.map((row) => ({
      key: row.category ?? "",
      net_sales: row.net_sales,
    })),
    ...(ranked_categories.other
      ? [
          {
            key: "__other__",
            net_sales: ranked_categories.other.net_sales,
          },
        ]
      : []),
  ];
  const topChannel = topMixShare(channel_mix);
  const topPayment = topMixShare(payment_mix);
  const topCategory = topMixShare(
    categorySlices.filter((row) => row.key !== "__other__")
  );

  return [
    mixSummary({
      id: "channels",
      label: t(lang, "Channels", "Canales"),
      emptyHint,
      top: topChannel,
      name: topChannel ? salesChannelLabel(topChannel.key, lang) : null,
      lang,
      money,
    }),
    mixSummary({
      id: "payments",
      label: t(lang, "Payments", "Pagos"),
      emptyHint,
      top: topPayment,
      name: topPayment ? salesPaymentLabel(topPayment.key, lang) : null,
      lang,
      money,
    }),
    mixSummary({
      id: "categories",
      label: t(lang, "Categories", "Categorías"),
      emptyHint,
      top: topCategory,
      name: topCategory
        ? salesCategoryLabel(topCategory.key || null, lang)
        : null,
      lang,
      money,
    }),
  ];
}

function buildInterpretation({
  lang,
  money,
  peak,
  daypart,
  strongest,
  agg,
  availability,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  peak: PeakSlot | null;
  daypart: DaypartSplit;
  strongest: WeekdayStat | null;
  agg: CockpitSalesAggregate;
  availability: SalesAvailability;
}): SalesInterpretation | null {
  if (availability !== "ready") return null;
  if (!peak && !strongest && !daypart.available) return null;

  const title = polishCockpitCopy(
    lang,
    t(lang, "Milton's read", "La lectura de Milton")
  );
  const facts: Record<string, number | string | null> = {
    net_sales: round2(agg.revenue.net_sales),
    tickets: agg.tickets,
    avg_ticket: round2(agg.avg_ticket),
    lunch_net: round2(daypart.lunch.net_sales),
    dinner_net: round2(daypart.dinner.net_sales),
    lunch_share_pct: daypart.available ? daypart.lunch_share_pct : null,
    dinner_share_pct: daypart.available ? daypart.dinner_share_pct : null,
    dinner_cutoff: DINNER_START_HOUR,
  };
  if (peak) {
    facts.peak_net = peak.net_sales;
    facts.peak_avg = peak.avg_per_day;
    facts.peak_hour = peak.hour;
    facts.peak_weekday = peak.weekday;
    facts.peak_days = peak.days;
    facts.peak_tickets = peak.tickets;
  }
  if (strongest) {
    facts.strongest_avg = strongest.avg_per_day;
    facts.strongest_net = strongest.net_sales;
    facts.strongest_days = strongest.days;
    facts.strongest_weekday = strongest.weekday;
  }

  if (peak && daypart.available && daypart.winner && daypart.winner !== "tie") {
    const day = weekdayLabel(peak.weekday, lang);
    const hour = hourLabel(peak.hour);
    const share =
      daypart.winner === "dinner"
        ? daypart.dinner_share_pct
        : daypart.lunch_share_pct;
    const part =
      daypart.winner === "dinner"
        ? t(lang, "dinner", "la cena")
        : t(lang, "lunch", "el almuerzo");
    return {
      title,
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `The strongest slot by average is ${day} at ${hour} (${money(peak.avg_per_day)}) and ${part} holds ${share?.toFixed(1)}% of net sales.`,
          `La franja más fuerte por promedio es el ${day} a las ${hour} (${money(peak.avg_per_day)}) y ${part} concentra el ${share?.toFixed(1)}% de las ventas netas.`
        )
      ),
      facts,
    };
  }

  if (peak) {
    const day = weekdayLabel(peak.weekday, lang);
    const hour = hourLabel(peak.hour);
    return {
      title,
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `The strongest slot by average is ${day} at ${hour}, at ${money(peak.avg_per_day)} per ${day} at ${hour}.`,
          `La franja más fuerte por promedio es el ${day} a las ${hour}, con ${money(peak.avg_per_day)} por ${day} a las ${hour}.`
        )
      ),
      facts,
    };
  }

  if (strongest) {
    const day = weekdayLabel(strongest.weekday, lang);
    return {
      title,
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} is the strongest weekday by average, at ${money(strongest.avg_per_day)} per ${day}.`,
          `El ${day} es el día más fuerte por promedio, con ${money(strongest.avg_per_day)} por ${day}.`
        )
      ),
      facts,
    };
  }

  const share =
    daypart.winner === "dinner"
      ? daypart.dinner_share_pct
      : daypart.lunch_share_pct;
  const part =
    daypart.winner === "dinner"
      ? t(lang, "Dinner", "La cena")
      : t(lang, "Lunch", "El almuerzo");
  return {
    title,
    body: polishCockpitCopy(
      lang,
      t(
        lang,
        `${part} holds ${share?.toFixed(1)}% of net sales (dinner starts at ${DINNER_START_HOUR}:00).`,
        `${part} concentra el ${share?.toFixed(1)}% de las ventas netas (la cena empieza a las ${DINNER_START_HOUR}:00).`
      )
    ),
    facts,
  };
}

function emptyDaypart(daypart: Daypart): DaypartTotals {
  return {
    daypart,
    hours:
      daypart === "lunch"
        ? `00:00–${String(DINNER_START_HOUR).padStart(2, "0")}:00`
        : `${String(DINNER_START_HOUR).padStart(2, "0")}:00–24:00`,
    net_sales: 0,
    tickets: 0,
    avg_ticket: 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
