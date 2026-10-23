// lib/restaurant/briefing-periods.ts
//
// Pure period maths for the daily briefing. The briefing used to quote the
// total of EVERY loaded POS day as "ventas"; it now speaks about explicit,
// dated periods computed in the company's own timezone:
//
//   - "Ayer"  = the previous LOCAL calendar day, compared with the same
//     weekday one week earlier.
//   - "Últimos 7 días" = the 7 local days ending yesterday, compared with
//     the 7 days before them.
//
// No I/O, no server-locale dependence: weekday / month names come from the
// tables below, calendar arithmetic is done on UTC-noon dates, and the only
// timezone-aware step is `localDateKey` (Intl with an explicit IANA zone).
//
// Honesty rules: a missing comparison is "Sin datos para comparar", never
// $0 or 0%. A day with no sales rows at all is reported as such (the sync may
// not have run) instead of being treated as a day with zero sales.

import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface DailySalesPoint {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  net_sales: number;
  tickets?: number | null;
}

export interface PeriodMetrics {
  /** Human label with dates, e.g. "Ayer, jue 22 oct". */
  label: string;
  from: string;
  to: string;
  /** null when the period has no sales rows at all. */
  sales: number | null;
  orders: number | null;
  avg_ticket: number | null;
  days_with_data: number;
  days_total: number;
}

export interface PeriodComparison {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  /** null when either side has no data or the base is not positive. */
  delta_pct: number | null;
  delta_amount: number | null;
}

export interface BriefingSalesPeriods {
  timezone: string;
  /** YYYY-MM-DD of the previous local day. */
  yesterday_date: string;
  yesterday: PeriodComparison;
  last_7_days: PeriodComparison;
  /** Preformatted, labelled lines. The AI may only quote these numbers. */
  facts: string[];
}

// ---------------------------------------------------------------------------
// Calendar helpers (deterministic, no locale)
// ---------------------------------------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAYS: Record<PreferredLanguage, readonly string[]> = {
  es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const MONTHS: Record<PreferredLanguage, readonly string[]> = {
  es: [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
};

function parseYmd(key: string): Date | null {
  const m = YMD.exec(key);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function addDaysToKey(key: string, days: number): string {
  const d = parseYmd(key);
  if (!d) return key;
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

/** The calendar date (YYYY-MM-DD) of `now` in an IANA timezone. */
export function localDateKey(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    if (YMD.test(key)) return key;
  } catch {
    /* fall through to UTC */
  }
  return toYmd(now);
}

/** "jue 22 oct". */
export function formatDayLabel(
  key: string,
  lang: PreferredLanguage = "es"
): string {
  const d = parseYmd(key);
  if (!d) return key;
  return `${WEEKDAYS[lang][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`;
}

/** "16–22 oct", or "28 sep–4 oct" when the range crosses a month. */
export function formatRangeLabel(
  from: string,
  to: string,
  lang: PreferredLanguage = "es"
): string {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return `${from}–${to}`;
  const mA = MONTHS[lang][a.getUTCMonth()];
  const mB = MONTHS[lang][b.getUTCMonth()];
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${mB}`;
  }
  return `${a.getUTCDate()} ${mA}–${b.getUTCDate()} ${mB}`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregate(
  byDate: Map<string, DailySalesPoint>,
  from: string,
  to: string,
  label: string
): PeriodMetrics {
  let sales = 0;
  let orders = 0;
  let daysWithData = 0;
  let daysTotal = 0;
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) {
    daysTotal++;
    const p = byDate.get(k);
    if (!p) continue;
    daysWithData++;
    sales += p.net_sales;
    orders += p.tickets && p.tickets > 0 ? p.tickets : 0;
  }
  const hasData = daysWithData > 0;
  return {
    label,
    from,
    to,
    sales: hasData ? round2(sales) : null,
    orders: hasData && orders > 0 ? orders : null,
    avg_ticket: hasData && orders > 0 ? round2(sales / orders) : null,
    days_with_data: daysWithData,
    days_total: daysTotal,
  };
}

function compare(
  current: PeriodMetrics,
  previous: PeriodMetrics
): PeriodComparison {
  let deltaPct: number | null = null;
  let deltaAmount: number | null = null;
  if (
    current.sales !== null &&
    previous.sales !== null &&
    previous.sales > 0 &&
    Number.isFinite(current.sales)
  ) {
    deltaAmount = round2(current.sales - previous.sales);
    deltaPct =
      Math.round(((current.sales - previous.sales) / previous.sales) * 1000) /
      10;
  }
  return { current, previous, delta_pct: deltaPct, delta_amount: deltaAmount };
}

export interface ComputeBriefingPeriodsInput {
  daily: readonly DailySalesPoint[];
  now: Date;
  timezone: string;
  lang?: PreferredLanguage;
  formatMoney: (amount: number) => string;
}

export function computeBriefingSalesPeriods(
  input: ComputeBriefingPeriodsInput
): BriefingSalesPeriods {
  const lang = input.lang ?? "es";
  const byDate = new Map<string, DailySalesPoint>();
  for (const p of input.daily) {
    if (!YMD.test(p.date)) continue;
    const prev = byDate.get(p.date);
    byDate.set(
      p.date,
      prev
        ? {
            date: p.date,
            net_sales: prev.net_sales + p.net_sales,
            tickets: (prev.tickets ?? 0) + (p.tickets ?? 0),
          }
        : p
    );
  }

  const today = localDateKey(input.now, input.timezone);
  const yDate = addDaysToKey(today, -1);
  const yWeekAgo = addDaysToKey(yDate, -7);

  const yLabel = `${lang === "es" ? "Ayer" : "Yesterday"}, ${formatDayLabel(yDate, lang)}`;
  const yesterday = compare(
    aggregate(byDate, yDate, yDate, yLabel),
    aggregate(
      byDate,
      yWeekAgo,
      yWeekAgo,
      `${lang === "es" ? "Mismo día de la semana pasada" : "Same weekday last week"}, ${formatDayLabel(yWeekAgo, lang)}`
    )
  );

  const curFrom = addDaysToKey(yDate, -6);
  const prevTo = addDaysToKey(curFrom, -1);
  const prevFrom = addDaysToKey(prevTo, -6);
  const week = compare(
    aggregate(
      byDate,
      curFrom,
      yDate,
      `${lang === "es" ? "Últimos 7 días" : "Last 7 days"} (${formatRangeLabel(curFrom, yDate, lang)})`
    ),
    aggregate(
      byDate,
      prevFrom,
      prevTo,
      `${lang === "es" ? "7 días anteriores" : "Previous 7 days"} (${formatRangeLabel(prevFrom, prevTo, lang)})`
    )
  );

  const periods: BriefingSalesPeriods = {
    timezone: input.timezone,
    yesterday_date: yDate,
    yesterday,
    last_7_days: week,
    facts: [],
  };
  periods.facts = buildSalesFacts(periods, lang, input.formatMoney);
  return periods;
}

// ---------------------------------------------------------------------------
// Preformatted facts
// ---------------------------------------------------------------------------

export function formatDeltaPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function noComparisonText(lang: PreferredLanguage): string {
  return lang === "es" ? "Sin datos para comparar" : "No data to compare";
}

export function noYesterdaySalesText(lang: PreferredLanguage): string {
  return lang === "es"
    ? "No hay ventas sincronizadas para ayer"
    : "No synced sales for yesterday";
}

function metricsText(
  m: PeriodMetrics,
  lang: PreferredLanguage,
  money: (n: number) => string
): string {
  if (m.sales === null) return noComparisonText(lang);
  const parts = [money(m.sales)];
  if (m.orders !== null) {
    parts.push(lang === "es" ? `${m.orders} órdenes` : `${m.orders} orders`);
  }
  if (m.avg_ticket !== null) {
    parts.push(
      lang === "es"
        ? `ticket promedio ${money(m.avg_ticket)}`
        : `avg ticket ${money(m.avg_ticket)}`
    );
  }
  return parts.join(" · ");
}

function deltaText(
  c: PeriodComparison,
  lang: PreferredLanguage,
  money: (n: number) => string
): string {
  if (c.delta_pct === null || c.delta_amount === null) {
    return noComparisonText(lang);
  }
  const sign = c.delta_amount > 0 ? "+" : c.delta_amount < 0 ? "-" : "";
  return `${formatDeltaPct(c.delta_pct)} (${sign}${money(Math.abs(c.delta_amount))})`;
}

export function buildSalesFacts(
  p: BriefingSalesPeriods,
  lang: PreferredLanguage,
  money: (n: number) => string
): string[] {
  const facts: string[] = [];
  const y = p.yesterday;
  if (y.current.sales === null) {
    facts.push(`${y.current.label}: ${noYesterdaySalesText(lang)}`);
  } else {
    facts.push(`${y.current.label}: ${metricsText(y.current, lang, money)}`);
    facts.push(
      `${lang === "es" ? "vs" : "vs"} ${y.previous.label}: ${
        y.previous.sales === null
          ? noComparisonText(lang)
          : `${metricsText(y.previous, lang, money)} → ${deltaText(y, lang, money)}`
      }`
    );
  }

  const w = p.last_7_days;
  const header = `${w.current.label} vs ${w.previous.label}`;
  if (w.current.sales === null) {
    facts.push(
      `${header}: ${
        lang === "es"
          ? "No hay ventas sincronizadas en los últimos 7 días"
          : "No synced sales in the last 7 days"
      }`
    );
  } else {
    facts.push(`${w.current.label}: ${metricsText(w.current, lang, money)}`);
    facts.push(`${w.previous.label}: ${metricsText(w.previous, lang, money)}`);
    facts.push(`${header}: ${deltaText(w, lang, money)}`);
    const partial = [w.current, w.previous].filter(
      (m) => m.days_with_data > 0 && m.days_with_data < m.days_total
    );
    for (const m of partial) {
      facts.push(
        lang === "es"
          ? `${m.label}: solo ${m.days_with_data} de ${m.days_total} días con ventas sincronizadas`
          : `${m.label}: only ${m.days_with_data} of ${m.days_total} days have synced sales`
      );
    }
  }
  return facts;
}
