// lib/restaurant/cockpit-executive.ts
//
// Period-aware executive snapshot for the Cockpit. One walk over already-
// loaded POS rows (paginated reader ran once). React only renders the DTO.
//
// Metric definitions match cockpit-aggregates + the owners' email briefing:
//   net sales = posted revenue excluding tips
//   avg ticket = net / unique checks
//   cost coverage = share of net sales from dishes with a cost
//   food cost % / gross margin % = on covered net sales only

import {
  addClassifiedLine,
  classifySaleLine,
  emptyRevenueBreakdown,
  finalizeRevenueBreakdown,
  type RevenueBreakdown,
} from "@/lib/restaurant/sales-revenue";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { formatCompactDateRange } from "@/lib/restaurant/cockpit-aggregates";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { salesChannelLabel } from "@/lib/restaurant/sales-channel-labels";
import { COSTS_HREF } from "@/lib/restaurant/navigation";
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
  delta_pct: number | null;
  this_week: InclusiveDateRange;
  last_week: InclusiveDateRange;
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
  other_currency_excluded: number;
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
  const current = emptyBucket();
  const previous = emptyBucket();
  const currentByDay = new Map<string, { net: number; orders: Set<string> }>();
  const previousByDay = new Map<string, { net: number; orders: Set<string> }>();
  const currentChannel = new Map<string, number>();
  const previousChannel = new Map<string, number>();
  const currentRows: CockpitFactRow[] = [];
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
    const line = classifySaleLine(row);
    const key = orderKey(row);
    const inCurrent = inInclusiveRange(row.sale_date, period.current);
    const inPrevious = inInclusiveRange(row.sale_date, period.previous);
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
      bumpDay(currentByDay, row.sale_date, line.net, key);
      if (!line.isTip) {
        const ch = channelKey(row);
        currentChannel.set(ch, (currentChannel.get(ch) ?? 0) + line.net);
      }
    }
    if (inPrevious) {
      apply(previous);
      bumpDay(previousByDay, row.sale_date, line.net, key);
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

  return {
    period,
    currency: currency ?? "USD",
    timezone: options.timezone ?? "UTC",
    current: currentFinal,
    previous: previousFinal,
    daily,
    channels,
    cost,
    other_currency_excluded: otherCurrencyExcluded,
  };
}

export function unavailableCostKpi(lang: PreferredLanguage): UnavailableKpi {
  return {
    available: false,
    reason: t(
      lang,
      "Recipe costs are needed",
      "Se necesitan costos de recetas"
    ),
    href: `${COSTS_HREF}/upload`,
    link_label: t(lang, "Add costs", "Agregar costos"),
  };
}

export function buildCockpitKpiStripModel(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage,
  weekWindows: {
    thisWeek: InclusiveDateRange;
    lastWeek: InclusiveDateRange;
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
  const costKpi = (value: number | null, previous: number | null): CostKpi => {
    if (!costAvailable || value === null) return unavailableCostKpi(lang);
    return {
      available: true,
      value,
      previous: previous ?? 0,
      delta_pct: previous === null ? null : deltaPct(value, previous),
    };
  };

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
    week_vs_last_week: {
      delta_pct: weekWindows.deltaPct,
      this_week: weekWindows.thisWeek,
      last_week: weekWindows.lastWeek,
    },
    gross_margin_pct: costKpi(snapshot.cost.gross_margin_pct, null),
    food_cost_pct: costKpi(snapshot.cost.food_cost_pct, null),
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
  const locale = lang === "es" ? "es-MX" : "en-US";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(snapshot.currency) ? snapshot.currency : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const net = money.format(snapshot.current.net_sales);
  const delta = deltaPct(
    snapshot.current.net_sales,
    snapshot.previous.net_sales
  );
  const periodPhrase =
    snapshot.period.preset === "last_7"
      ? t(lang, "the last 7 days", "los últimos 7 días")
      : t(lang, "this month", "este mes");
  const previousPhrase =
    snapshot.period.preset === "last_7"
      ? t(lang, "the 7 days before", "los 7 días anteriores")
      : t(lang, "the previous month", "el mes anterior");

  if (delta === null) {
    return t(
      lang,
      `Net sales for ${periodPhrase}: ${net}. There is no previous period to compare yet.`,
      `Ventas netas de ${periodPhrase}: ${net}. Aún no hay un periodo anterior para comparar.`
    );
  }
  const sign = delta > 0 ? "+" : "";
  const deltaLabel = `${sign}${delta.toFixed(1)}%`;
  if (delta === 0) {
    return t(
      lang,
      `Net sales for ${periodPhrase}: ${net}, in line with ${previousPhrase}.`,
      `Ventas netas de ${periodPhrase}: ${net}, en línea con ${previousPhrase}.`
    );
  }
  const direction =
    delta > 0 ? t(lang, "above", "arriba de") : t(lang, "below", "abajo de");
  return t(
    lang,
    `Net sales for ${periodPhrase}: ${net} (${deltaLabel} ${direction} ${previousPhrase}).`,
    `Ventas netas de ${periodPhrase}: ${net} (${deltaLabel} ${direction} ${previousPhrase}).`
  );
}

export function periodDayCount(range: InclusiveDateRange): number {
  return daysInclusive(range.from, range.to);
}
