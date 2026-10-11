// lib/restaurant/sales-insights.ts
//
// Deterministic Sales-page insights. React only renders; this module
// picks the peak slot, weakest weekday, lunch vs dinner split, ranked
// categories, and the one-line interpretation. OpenAI may reword that
// line through the existing cockpit-insights-ai guards — never invent
// numbers.

import {
  DINNER_START_HOUR,
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
import type { WeekdayKey } from "@/lib/restaurant/pos-local-time";
import { WEEKDAY_KEYS } from "@/lib/restaurant/pos-local-time";
import { SALES_CATEGORY_TOP_N } from "@/lib/restaurant/sales-explore";
import type { Daypart } from "@/lib/restaurant/sales-revenue";

export { DINNER_START_HOUR };

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

export interface PeakSlot {
  weekday: number;
  weekday_key: WeekdayKey;
  hour: number;
  net_sales: number;
  tickets: number;
}

export interface WeekdayTotal {
  weekday: number;
  weekday_key: WeekdayKey;
  net_sales: number;
  tickets: number;
}

export interface DaypartSplit {
  lunch: DaypartTotals;
  dinner: DaypartTotals;
  winner: Daypart | "tie";
  lunch_share_pct: number | null;
  dinner_share_pct: number | null;
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

export interface SalesHighlight {
  id: "peak_slot" | "strongest_weekday" | "weakest_weekday";
  title: string;
  body: string;
  ask_question: string;
  facts: Record<string, number | string | null>;
}

export interface SalesSummary {
  id: "net_sales" | "tickets" | "daypart";
  label: string;
  value: string;
  hint: string;
}

export interface SalesInterpretation {
  title: string;
  body: string;
  facts: Record<string, number | string | null>;
}

export interface SalesInsights {
  peak_slot: PeakSlot | null;
  strongest_weekday: WeekdayTotal | null;
  weakest_weekday: WeekdayTotal | null;
  daypart: DaypartSplit;
  ranked_categories: RankedCategories;
  channel_mix: MixSlice[];
  payment_mix: MixSlice[];
  heatmap: EnrichedHeatmapCell[];
  typical_net_by_hour: Record<number, number>;
  highlights: SalesHighlight[];
  summaries: SalesSummary[];
  interpretation: SalesInterpretation;
  interpretationFact: CockpitInsightFact;
}

export function weekdayLabel(weekday: number, lang: PreferredLanguage): string {
  const i = ((weekday % 7) + 7) % 7;
  return lang === "es" ? WEEKDAY_LABEL_ES[i] : WEEKDAY_LABEL_EN[i];
}

export function hourLabel(hour: number): string {
  return `${String(Math.min(23, Math.max(0, Math.trunc(hour)))).padStart(2, "0")}:00`;
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

export function findPeakSlot(cells: HeatmapCell[]): PeakSlot | null {
  const ranked = cells
    .filter((c) => c.net_sales > 0)
    .sort((a, b) => {
      if (b.net_sales !== a.net_sales) return b.net_sales - a.net_sales;
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      return a.hour - b.hour;
    });
  const top = ranked[0];
  if (!top) return null;
  return {
    weekday: top.weekday,
    weekday_key: top.weekday_key,
    hour: top.hour,
    net_sales: round2(top.net_sales),
    tickets: top.tickets,
  };
}

export function weekdayTotals(cells: HeatmapCell[]): WeekdayTotal[] {
  const buckets = new Map<number, { net: number; tickets: number }>();
  for (let i = 0; i < 7; i++) buckets.set(i, { net: 0, tickets: 0 });
  for (const cell of cells) {
    const bucket = buckets.get(cell.weekday) ?? { net: 0, tickets: 0 };
    bucket.net += cell.net_sales;
    bucket.tickets += cell.tickets;
    buckets.set(cell.weekday, bucket);
  }
  return Array.from(buckets.entries()).map(([weekday, bucket]) => ({
    weekday,
    weekday_key: WEEKDAY_KEYS[weekday],
    net_sales: round2(bucket.net),
    tickets: bucket.tickets,
  }));
}

export function findStrongestWeekday(
  totals: WeekdayTotal[]
): WeekdayTotal | null {
  return pickWeekday(totals, "max");
}

export function findWeakestWeekday(
  totals: WeekdayTotal[]
): WeekdayTotal | null {
  return pickWeekday(totals, "min");
}

function pickWeekday(
  totals: WeekdayTotal[],
  mode: "max" | "min"
): WeekdayTotal | null {
  const active = totals.filter((row) => row.net_sales > 0);
  if (active.length === 0) return null;
  return active.reduce((best, row) => {
    if (mode === "max") {
      if (row.net_sales !== best.net_sales) {
        return row.net_sales > best.net_sales ? row : best;
      }
    } else if (row.net_sales !== best.net_sales) {
      return row.net_sales < best.net_sales ? row : best;
    }
    return row.weekday < best.weekday ? row : best;
  });
}

export function lunchVsDinner(dayparts: DaypartTotals[]): DaypartSplit {
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
  lang: PreferredLanguage
): SalesInsights {
  const peak = findPeakSlot(agg.heatmap);
  const byWeekday = weekdayTotals(agg.heatmap);
  const strongest = findStrongestWeekday(byWeekday);
  const weakestRaw = findWeakestWeekday(byWeekday);
  const weakest =
    weakestRaw && strongest && weakestRaw.weekday === strongest.weekday
      ? null
      : weakestRaw;
  const daypart = lunchVsDinner(agg.dayparts);
  const money = (n: number, digits = 0) =>
    formatCockpitMoney(n, agg.currency, digits);
  const highlights = buildHighlights({
    lang,
    money,
    peak,
    strongest,
    weakest,
  });
  const summaries = buildSummaries({
    lang,
    money,
    agg,
    daypart,
  });
  const interpretation = buildInterpretation({
    lang,
    money,
    peak,
    daypart,
    agg,
  });

  return {
    peak_slot: peak,
    strongest_weekday: strongest,
    weakest_weekday: weakest,
    daypart,
    ranked_categories: rankCategories(agg.category_mix),
    channel_mix: flattenMixSeries(agg.channel_mix_over_time),
    payment_mix: flattenMixSeries(agg.payment_mix_over_time),
    heatmap: enrichHeatmapCells(agg.heatmap),
    typical_net_by_hour: typicalNetByHour(agg.heatmap),
    highlights,
    summaries,
    interpretation,
    interpretationFact: {
      id: "sales_interpretation",
      kind: "sales_change",
      score: 1,
      facts: interpretation.facts,
      title: interpretation.title,
      body: interpretation.body,
    },
  };
}

function buildHighlights({
  lang,
  money,
  peak,
  strongest,
  weakest,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  peak: PeakSlot | null;
  strongest: WeekdayTotal | null;
  weakest: WeekdayTotal | null;
}): SalesHighlight[] {
  const out: SalesHighlight[] = [];
  if (peak) {
    const day = weekdayLabel(peak.weekday, lang);
    const hour = hourLabel(peak.hour);
    const amount = money(peak.net_sales);
    out.push({
      id: "peak_slot",
      title: polishCockpitCopy(
        lang,
        t(lang, "Peak period", "Pico del periodo")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} ${hour} · ${amount} · ${peak.tickets} tickets`,
          `${day} ${hour} · ${amount} · ${peak.tickets} tickets`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `Why is ${day} at ${hour} the peak slot, with ${amount} in net sales?`,
          `¿Por qué el ${day} a las ${hour} es el pico, con ${amount} en ventas netas?`
        )
      ),
      facts: {
        weekday: peak.weekday,
        hour: peak.hour,
        net_sales: peak.net_sales,
        tickets: peak.tickets,
      },
    });
  }
  if (strongest) {
    const day = weekdayLabel(strongest.weekday, lang);
    const amount = money(strongest.net_sales);
    out.push({
      id: "strongest_weekday",
      title: polishCockpitCopy(
        lang,
        t(lang, "Strongest period", "Periodo más fuerte")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} · ${amount} · ${strongest.tickets} tickets`,
          `${day} · ${amount} · ${strongest.tickets} tickets`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `What makes ${day} the strongest weekday, with ${amount} in net sales?`,
          `¿Qué hace del ${day} el día más fuerte, con ${amount} en ventas netas?`
        )
      ),
      facts: {
        weekday: strongest.weekday,
        net_sales: strongest.net_sales,
        tickets: strongest.tickets,
      },
    });
  }
  if (weakest) {
    const day = weekdayLabel(weakest.weekday, lang);
    const amount = money(weakest.net_sales);
    out.push({
      id: "weakest_weekday",
      title: polishCockpitCopy(
        lang,
        t(lang, "Weakest period", "Periodo más flojo")
      ),
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `${day} · ${amount} · ${weakest.tickets} tickets`,
          `${day} · ${amount} · ${weakest.tickets} tickets`
        )
      ),
      ask_question: polishCockpitCopy(
        lang,
        t(
          lang,
          `What is happening on ${day}, the weakest weekday, with ${amount} in net sales?`,
          `¿Qué está pasando el ${day}, el día más flojo, con ${amount} en ventas netas?`
        )
      ),
      facts: {
        weekday: weakest.weekday,
        net_sales: weakest.net_sales,
        tickets: weakest.tickets,
      },
    });
  }
  return out;
}

function buildSummaries({
  lang,
  money,
  agg,
  daypart,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  agg: CockpitSalesAggregate;
  daypart: DaypartSplit;
}): SalesSummary[] {
  const tipsNote =
    agg.revenue.tips > 0
      ? t(
          lang,
          `Tips ${money(agg.revenue.tips, 2)} stay on their own line.`,
          `Las propinas ${money(agg.revenue.tips, 2)} siguen en su propia línea.`
        )
      : t(
          lang,
          "Tips excluded from net.",
          "Las propinas no entran en el neto."
        );
  const daypartHint =
    daypart.winner === "tie"
      ? t(
          lang,
          `Lunch ${money(daypart.lunch.net_sales)} · dinner ${money(daypart.dinner.net_sales)}`,
          `Almuerzo ${money(daypart.lunch.net_sales)} · cena ${money(daypart.dinner.net_sales)}`
        )
      : daypart.winner === "dinner"
        ? t(
            lang,
            `Dinner ${daypart.dinner_share_pct?.toFixed(1)}% · lunch ${daypart.lunch_share_pct?.toFixed(1)}%`,
            `Cena ${daypart.dinner_share_pct?.toFixed(1)}% · almuerzo ${daypart.lunch_share_pct?.toFixed(1)}%`
          )
        : t(
            lang,
            `Lunch ${daypart.lunch_share_pct?.toFixed(1)}% · dinner ${daypart.dinner_share_pct?.toFixed(1)}%`,
            `Almuerzo ${daypart.lunch_share_pct?.toFixed(1)}% · cena ${daypart.dinner_share_pct?.toFixed(1)}%`
          );

  return [
    {
      id: "net_sales",
      label: t(lang, "Net sales", "Ventas netas"),
      value: money(agg.revenue.net_sales, 2),
      hint: polishCockpitCopy(lang, tipsNote),
    },
    {
      id: "tickets",
      label: t(lang, "Tickets", "Tickets"),
      value: String(agg.tickets),
      hint: t(
        lang,
        `Avg ticket ${money(agg.avg_ticket, 2)}`,
        `Ticket promedio ${money(agg.avg_ticket, 2)}`
      ),
    },
    {
      id: "daypart",
      label: t(lang, "Lunch vs dinner", "Almuerzo vs cena"),
      value:
        daypart.winner === "dinner"
          ? t(lang, "Dinner leads", "Gana la cena")
          : daypart.winner === "lunch"
            ? t(lang, "Lunch leads", "Gana el almuerzo")
            : t(lang, "Even split", "Empate"),
      hint: polishCockpitCopy(lang, daypartHint),
    },
  ];
}

function buildInterpretation({
  lang,
  money,
  peak,
  daypart,
  agg,
}: {
  lang: PreferredLanguage;
  money: (n: number, digits?: number) => string;
  peak: PeakSlot | null;
  daypart: DaypartSplit;
  agg: CockpitSalesAggregate;
}): SalesInterpretation {
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
    lunch_share_pct: daypart.lunch_share_pct,
    dinner_share_pct: daypart.dinner_share_pct,
    dinner_cutoff: DINNER_START_HOUR,
  };
  if (peak) {
    facts.peak_net = peak.net_sales;
    facts.peak_hour = peak.hour;
    facts.peak_weekday = peak.weekday;
    facts.peak_tickets = peak.tickets;
  }

  if (!peak && daypart.winner === "tie") {
    return {
      title,
      body: polishCockpitCopy(
        lang,
        t(
          lang,
          `Net sales are ${money(agg.revenue.net_sales, 2)} across ${agg.tickets} tickets.`,
          `Las ventas netas son ${money(agg.revenue.net_sales, 2)} en ${agg.tickets} tickets.`
        )
      ),
      facts,
    };
  }

  if (peak && daypart.winner !== "tie" && daypart.dinner_share_pct !== null) {
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
          `The peak is ${day} at ${hour} (${money(peak.net_sales)}) and ${part} holds ${share?.toFixed(1)}% of net sales.`,
          `El pico es el ${day} a las ${hour} (${money(peak.net_sales)}) y ${part} concentra el ${share?.toFixed(1)}% de las ventas netas.`
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
          `The peak is ${day} at ${hour}, with ${money(peak.net_sales)} in net sales.`,
          `El pico es el ${day} a las ${hour}, con ${money(peak.net_sales)} en ventas netas.`
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
