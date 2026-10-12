// lib/restaurant/cockpit-executive.ts
//
// Period-aware executive snapshot for the Cockpit. One walk over already-
// loaded POS rows (paginated reader ran once). React only renders the DTO.
//
// Metric definitions match cockpit-aggregates + the owners' email briefing:
//   net sales = posted revenue excluding tips
//   avg ticket = net / unique checks (same orderKey as the week aggregate)
//   cost coverage = share of net sales from dishes with a cost
//   food cost % / gross margin % = on covered net sales only
//
// Day buckets use the heatmap local date (order_placed_at in the POS
// timezone, fallback sale_date) so CSV imports cannot drift a day.

import {
  addClassifiedLine,
  classifySaleLine,
  emptyRevenueBreakdown,
  finalizeRevenueBreakdown,
  type RevenueBreakdown,
} from "@/lib/restaurant/sales-revenue";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { formatCompactDateRange } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { salesChannelLabel } from "@/lib/restaurant/sales-channel-labels";
import { COSTS_HREF } from "@/lib/restaurant/navigation";
import { localWeekdayAndHour } from "@/lib/restaurant/pos-local-time";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import {
  type CockpitPeriod,
  type InclusiveDateRange,
  daysInclusive,
  deltaPct,
  enumerateDates,
  inInclusiveRange,
} from "@/lib/restaurant/cockpit-period";
import {
  itemCostLookupFromMarginRows,
  periodCostKpisFromRows,
  type PeriodCostKpis,
} from "@/lib/restaurant/cockpit-cost-coverage";
import { pendingRecipesLabel } from "@/lib/restaurant/cost-workbook/copy";

export interface PeriodBucket {
  net_sales: number;
  gross_sales: number;
  discounts: number;
  tips: number;
  tickets: number;
  units: number;
  avg_ticket: number;
  discounts_estimated: boolean;
  rows_reviewed: number;
}

export interface DailyNetPoint {
  date: string;
  previous_date: string | null;
  current_net: number;
  previous_net: number | null;
  current_tickets: number;
  current_avg_ticket: number;
  vs_previous_pct: number | null;
}

export interface ChannelShare {
  channel: string;
  label: string;
  net_sales: number;
  share_pct: number;
  previous_share_pct: number | null;
  delta_pp: number | null;
}

export interface AvailableKpi {
  available: true;
  value: number;
  previous: number;
  delta_pct: number | null;
}

export interface UnavailableKpi {
  available: false;
  reason: string;
  href: string;
  link_label: string;
}

export type MoneyKpi = AvailableKpi;
export type CostKpi = AvailableKpi | UnavailableKpi;

export interface WeekDeltaKpi {
  available: boolean;
  delta_pct: number | null;
  this_week: InclusiveDateRange | null;
  last_week: InclusiveDateRange | null;
  reason?: string;
}

export interface CockpitKpiStripModel {
  currency: string;
  period_label: string;
  net_sales: MoneyKpi;
  avg_ticket: MoneyKpi;
  tickets: MoneyKpi;
  week_vs_last_week: WeekDeltaKpi;
  gross_margin_pct: CostKpi;
  food_cost_pct: CostKpi;
  /** True while period cost KPIs are still loading (do not show "Add costs"). */
  cost_pending?: boolean;
  secondary: {
    gross_sales: number;
    discounts: number;
    net_sales: number;
    tips: number;
    discounts_estimated: boolean;
  };
}

export interface CockpitPeriodSnapshot {
  period: CockpitPeriod;
  currency: string;
  timezone: string;
  current: PeriodBucket;
  previous: PeriodBucket;
  daily: DailyNetPoint[];
  channels: ChannelShare[];
  cost: PeriodCostKpis;
  previous_cost: PeriodCostKpis;
  other_currency_excluded: number;
}

export interface CockpitComparisonPhrases {
  currentPhrase: string;
  previousPhrase: string;
  /** Already-contracted "de …" / "for …" for the current window. */
  deCurrent: string;
  /** Already-contracted "frente a/al …" / "versus …" for the previous window. */
  frenteAPrevious: string;
  chipLabel: string;
}

/**
 * Spanish article contractions. Only the article `el` (not ella, ellos,
 * electrónico…). `de el` → `del`, `a el` → `al`.
 */
export function contractEs(text: string): string {
  return text
    .replace(/ {2,}/g, " ")
    .replace(/\b([Dd])e el\b/g, (_m, d: string) => (d === "D" ? "Del" : "del"))
    .replace(/\b([Aa]) el\b/g, (_m, a: string) => (a === "A" ? "Al" : "al"))
    .trim();
}

export function polishCockpitCopy(
  lang: PreferredLanguage,
  text: string
): string {
  return lang === "es" ? contractEs(text) : text;
}

function emptyBucket(): {
  revenue: RevenueBreakdown;
  orders: Set<string>;
  units: number;
  rows: number;
} {
  return {
    revenue: emptyRevenueBreakdown(),
    orders: new Set(),
    units: 0,
    rows: 0,
  };
}

function finalizeBucket(bucket: ReturnType<typeof emptyBucket>): PeriodBucket {
  const revenue = finalizeRevenueBreakdown(bucket.revenue);
  const tickets = bucket.orders.size;
  return {
    net_sales: revenue.net_sales,
    gross_sales: revenue.gross_sales,
    discounts: revenue.discounts,
    tips: revenue.tips,
    tickets,
    units: Math.round(bucket.units * 1000) / 1000,
    avg_ticket: tickets > 0 ? revenue.net_sales / tickets : 0,
    discounts_estimated: revenue.discounts_estimated,
    rows_reviewed: bucket.rows,
  };
}

/** Same key as the week aggregate: distinct check ids, then order id. */
function orderKey(row: CockpitFactRow): string | null {
  return row.check_id ?? row.order_id ?? null;
}

function quantityOf(row: CockpitFactRow): number {
  return typeof row.quantity === "number" && Number.isFinite(row.quantity)
    ? row.quantity
    : 0;
}

function channelKey(row: CockpitFactRow): string {
  const raw = row.sales_channel?.trim();
  return raw && raw.length > 0 ? raw : "unknown";
}

export function localSaleDateKey(
  row: Pick<CockpitFactRow, "sale_date" | "order_placed_at">,
  timezone: string
): string {
  return localWeekdayAndHour(
    {
      sale_date: row.sale_date,
      order_placed_at: row.order_placed_at ?? null,
    },
    timezone
  ).dateKey;
}

export function formatCockpitMoney(
  amount: number,
  currency: string,
  fractionDigits = 0
): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = localeForCurrency(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  }
}

export function cockpitComparisonPhrases(
  period: CockpitPeriod,
  lang: PreferredLanguage
): CockpitComparisonPhrases {
  const dateLocale = lang === "es" ? "es" : "en-GB";
  const currentRange = formatCompactDateRange(
    period.current.from,
    period.current.to,
    dateLocale
  );
  const previousRange = formatCompactDateRange(
    period.previous.from,
    period.previous.to,
    dateLocale
  );
  if (period.preset === "last_7") {
    return polishPhrases(lang, {
      currentPhrase: t(lang, "the last 7 days", "los últimos 7 días"),
      previousPhrase: t(lang, "the 7 days before", "los 7 días anteriores"),
      deCurrent: t(lang, "for the last 7 days", "de los últimos 7 días"),
      frenteAPrevious: t(
        lang,
        "versus the 7 days before",
        "frente a los 7 días anteriores"
      ),
      chipLabel: currentRange,
    });
  }
  if (period.month_complete) {
    return polishPhrases(lang, {
      currentPhrase: t(lang, "this month", "este mes"),
      previousPhrase: t(lang, "the previous month", "el mes anterior"),
      deCurrent: t(lang, "for this month", "de este mes"),
      frenteAPrevious: t(
        lang,
        "versus the previous month",
        "frente al mes anterior"
      ),
      chipLabel: `${currentRange} vs ${previousRange}`,
    });
  }
  return polishPhrases(lang, {
    currentPhrase: t(
      lang,
      `this month to date (${currentRange})`,
      `el mes en curso (${currentRange})`
    ),
    previousPhrase: t(
      lang,
      `the same days of the previous month (${previousRange})`,
      `el mismo tramo del mes anterior (${previousRange})`
    ),
    deCurrent: t(
      lang,
      `for this month to date (${currentRange})`,
      `del mes en curso (${currentRange})`
    ),
    frenteAPrevious: t(
      lang,
      `versus the same days of the previous month (${previousRange})`,
      `frente al mismo tramo del mes anterior (${previousRange})`
    ),
    chipLabel: t(
      lang,
      `Month to date vs same days last month · ${currentRange} vs ${previousRange}`,
      `Mes en curso vs mismo tramo del mes anterior · ${currentRange} vs ${previousRange}`
    ),
  });
}

function polishPhrases(
  lang: PreferredLanguage,
  phrases: CockpitComparisonPhrases
): CockpitComparisonPhrases {
  if (lang !== "es") return phrases;
  return {
    currentPhrase: contractEs(phrases.currentPhrase),
    previousPhrase: contractEs(phrases.previousPhrase),
    deCurrent: contractEs(phrases.deCurrent),
    frenteAPrevious: contractEs(phrases.frenteAPrevious),
    chipLabel: contractEs(phrases.chipLabel),
  };
}

export function buildCockpitPeriodSnapshot(
  rows: CockpitFactRow[],
  period: CockpitPeriod,
  options: {
    timezone?: string;
    currency?: string;
    lang: PreferredLanguage;
    marginRows?: Array<{
      menu_item_id: string;
      raw_pos_names: string[];
      cost: { status: string; cost: number | null };
    }>;
  }
): CockpitPeriodSnapshot {
  const currency = options.currency;
  const timezone = normalizeTimezone(options.timezone) ?? "UTC";
  const current = emptyBucket();
  const previous = emptyBucket();
  const currentByDay = new Map<string, { net: number; orders: Set<string> }>();
  const previousByDay = new Map<string, { net: number; orders: Set<string> }>();
  const currentChannel = new Map<string, number>();
  const previousChannel = new Map<string, number>();
  const currentRows: CockpitFactRow[] = [];
  const previousRows: CockpitFactRow[] = [];
  let otherCurrencyExcluded = 0;

  const bumpDay = (
    store: Map<string, { net: number; orders: Set<string> }>,
    date: string,
    net: number,
    key: string | null
  ) => {
    let cell = store.get(date);
    if (!cell) {
      cell = { net: 0, orders: new Set() };
      store.set(date, cell);
    }
    cell.net += net;
    if (key) cell.orders.add(key);
  };

  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    if (currency && row.currency && row.currency !== currency) {
      otherCurrencyExcluded += 1;
      continue;
    }
    const dateKey = localSaleDateKey(row, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const line = classifySaleLine(row);
    const key = orderKey(row);
    const inCurrent = inInclusiveRange(dateKey, period.current);
    const inPrevious = inInclusiveRange(dateKey, period.previous);
    if (!inCurrent && !inPrevious) continue;

    const apply = (bucket: ReturnType<typeof emptyBucket>) => {
      addClassifiedLine(bucket.revenue, line);
      if (key) bucket.orders.add(key);
      if (!line.isTip) bucket.units += quantityOf(row);
      bucket.rows += 1;
    };

    if (inCurrent) {
      apply(current);
      currentRows.push(row);
      bumpDay(currentByDay, dateKey, line.net, key);
      if (!line.isTip) {
        const ch = channelKey(row);
        currentChannel.set(ch, (currentChannel.get(ch) ?? 0) + line.net);
      }
    }
    if (inPrevious) {
      apply(previous);
      previousRows.push(row);
      bumpDay(previousByDay, dateKey, line.net, key);
      if (!line.isTip) {
        const ch = channelKey(row);
        previousChannel.set(ch, (previousChannel.get(ch) ?? 0) + line.net);
      }
    }
  }

  const currentFinal = finalizeBucket(current);
  const previousFinal = finalizeBucket(previous);
  const currentDates = enumerateDates(period.current.from, period.current.to);
  const previousDates = enumerateDates(
    period.previous.from,
    period.previous.to
  );

  const daily: DailyNetPoint[] = currentDates.map((date, index) => {
    const cell = currentByDay.get(date);
    const currentNet = cell?.net ?? 0;
    const tickets = cell?.orders.size ?? 0;
    const previousDate =
      period.preset === "month"
        ? (previousDates.find((d) => d.slice(8) === date.slice(8)) ?? null)
        : (previousDates[index] ?? null);
    const previousNet =
      previousDate !== null
        ? (previousByDay.get(previousDate)?.net ?? 0)
        : null;
    return {
      date,
      previous_date: previousDate,
      current_net: Math.round(currentNet * 100) / 100,
      previous_net:
        previousNet === null ? null : Math.round(previousNet * 100) / 100,
      current_tickets: tickets,
      current_avg_ticket: tickets > 0 ? currentNet / tickets : 0,
      vs_previous_pct:
        previousNet === null ? null : deltaPct(currentNet, previousNet),
    };
  });

  const currentNetForShare = currentFinal.net_sales;
  const previousNetForShare = previousFinal.net_sales;
  const channelKeys = Array.from(
    new Set([...currentChannel.keys(), ...previousChannel.keys()])
  ).sort((a, b) => (currentChannel.get(b) ?? 0) - (currentChannel.get(a) ?? 0));

  const channels: ChannelShare[] = channelKeys.map((channel) => {
    const net = Math.round((currentChannel.get(channel) ?? 0) * 100) / 100;
    const prev = previousChannel.get(channel) ?? 0;
    const share = currentNetForShare > 0 ? (net / currentNetForShare) * 100 : 0;
    const prevShare =
      previousNetForShare > 0 ? (prev / previousNetForShare) * 100 : null;
    return {
      channel,
      label: salesChannelLabel(channel, options.lang),
      net_sales: net,
      share_pct: Math.round(share * 10) / 10,
      previous_share_pct:
        prevShare === null ? null : Math.round(prevShare * 10) / 10,
      delta_pp:
        prevShare === null ? null : Math.round((share - prevShare) * 10) / 10,
    };
  });

  const lookup = itemCostLookupFromMarginRows(options.marginRows ?? []);
  const cost = periodCostKpisFromRows(currentRows, lookup, currency);
  const previousCost = periodCostKpisFromRows(previousRows, lookup, currency);

  return {
    period,
    currency: currency ?? "USD",
    timezone,
    current: currentFinal,
    previous: previousFinal,
    daily,
    channels,
    cost,
    previous_cost: previousCost,
    other_currency_excluded: otherCurrencyExcluded,
  };
}

export function unavailableCostKpi(lang: PreferredLanguage): UnavailableKpi {
  return {
    available: false,
    reason: pendingRecipesLabel(lang),
    href: `${COSTS_HREF}/upload`,
    link_label: t(lang, "Add costs", "Agregar costos"),
  };
}

export function buildCockpitKpiStripModel(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage,
  weekWindows: {
    thisWeek: InclusiveDateRange | null;
    lastWeek: InclusiveDateRange | null;
    deltaPct: number | null;
  }
): CockpitKpiStripModel {
  const dateLocale = lang === "es" ? "es" : "en-GB";
  const withDelta = (current: number, previous: number): AvailableKpi => ({
    available: true,
    value: current,
    previous,
    delta_pct: deltaPct(current, previous),
  });

  const costAvailable = snapshot.cost.coverage_pct > 0;
  const previousCostAvailable = snapshot.previous_cost.coverage_pct > 0;
  const costKpi = (value: number | null, previous: number | null): CostKpi => {
    if (!costAvailable || value === null) return unavailableCostKpi(lang);
    return {
      available: true,
      value,
      previous: previous ?? 0,
      delta_pct:
        !previousCostAvailable || previous === null
          ? null
          : deltaPct(value, previous),
    };
  };

  const weekAvailable = weekWindows.thisWeek !== null;

  return {
    currency: snapshot.currency,
    period_label: formatCompactDateRange(
      snapshot.period.current.from,
      snapshot.period.current.to,
      dateLocale
    ),
    net_sales: withDelta(
      snapshot.current.net_sales,
      snapshot.previous.net_sales
    ),
    avg_ticket: withDelta(
      snapshot.current.avg_ticket,
      snapshot.previous.avg_ticket
    ),
    tickets: withDelta(snapshot.current.tickets, snapshot.previous.tickets),
    week_vs_last_week: weekAvailable
      ? {
          available: true,
          delta_pct: weekWindows.deltaPct,
          this_week: weekWindows.thisWeek,
          last_week: weekWindows.lastWeek,
        }
      : {
          available: false,
          delta_pct: null,
          this_week: null,
          last_week: weekWindows.lastWeek,
          reason: t(
            lang,
            "This week is not available yet.",
            "Aún no disponible"
          ),
        },
    gross_margin_pct: costKpi(
      snapshot.cost.gross_margin_pct,
      snapshot.previous_cost.gross_margin_pct
    ),
    food_cost_pct: costKpi(
      snapshot.cost.food_cost_pct,
      snapshot.previous_cost.food_cost_pct
    ),
    secondary: {
      gross_sales: snapshot.current.gross_sales,
      discounts: snapshot.current.discounts,
      net_sales: snapshot.current.net_sales,
      tips: snapshot.current.tips,
      discounts_estimated: snapshot.current.discounts_estimated,
    },
  };
}

export function buildCockpitHeadline(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage
): string {
  const net = formatCockpitMoney(snapshot.current.net_sales, snapshot.currency);
  const delta = deltaPct(
    snapshot.current.net_sales,
    snapshot.previous.net_sales
  );
  const phrases = cockpitComparisonPhrases(snapshot.period, lang);

  if (delta === null) {
    return polishCockpitCopy(
      lang,
      t(
        lang,
        `Net sales ${phrases.deCurrent}: ${net}. There is no previous period to compare yet.`,
        `Ventas netas ${phrases.deCurrent}: ${net}. Aún no hay un periodo anterior para comparar.`
      )
    );
  }
  if (delta === 0) {
    return polishCockpitCopy(
      lang,
      t(
        lang,
        `Net sales ${phrases.deCurrent}: ${net}, in line with ${phrases.previousPhrase}.`,
        `Ventas netas ${phrases.deCurrent}: ${net}, en línea con ${phrases.previousPhrase}.`
      )
    );
  }
  const abs = `${Math.abs(delta).toFixed(1)}%`;
  if (delta > 0) {
    return polishCockpitCopy(
      lang,
      t(
        lang,
        `Net sales ${phrases.deCurrent}: ${net}. Up ${abs} ${phrases.frenteAPrevious}.`,
        `Ventas netas ${phrases.deCurrent}: ${net}. Subió ${abs} ${phrases.frenteAPrevious}.`
      )
    );
  }
  return polishCockpitCopy(
    lang,
    t(
      lang,
      `Net sales ${phrases.deCurrent}: ${net}. Down ${abs} ${phrases.frenteAPrevious}.`,
      `Ventas netas ${phrases.deCurrent}: ${net}. Bajó ${abs} ${phrases.frenteAPrevious}.`
    )
  );
}

export function periodDayCount(range: InclusiveDateRange): number {
  return daysInclusive(range.from, range.to);
}
