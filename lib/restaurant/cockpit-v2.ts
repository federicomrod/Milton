// lib/restaurant/cockpit-v2.ts
//
// R1-16b: everything the Cockpit v2 shows, computed in the browser from ONE
// loaded dataset (the daily sales series, the targets, and — once loaded — the
// day × category cost rows). Changing the period, the comparison or the
// category never asks the server for anything: it is this function again.
//
// Pure: no I/O, no clock (the caller says what "today" is). Rules live in
// cockpit-math.ts and objetivos.ts; here they are put together.
//
//   * Sales cards use net sales (tips out) over CALENDAR days.
//   * A % KPI is Σcost ÷ Σsales over the window — never the average of daily
//     percentages — and is compared in points.
//   * Cost only covers products with a known cost; coverage says how much of
//     the sales that is. A product without a cost is never $0.
//   * No target = no line and no chip.
//   * A comparison never lines a full period up against a partial one, and a
//     comparison window that starts before the data does is not shown.

import {
  type DayPoint,
  type Range,
  addDays,
  dataSpanNote,
  daysBetween,
  eachDay,
  indexByDate,
  pctChange,
  previousMonthRange,
  previousWeekRange,
  ptsChange,
  ratioOfSums,
  trailingWindow,
  weekdayIndex,
  windowSales,
} from "@/lib/restaurant/cockpit-math";
import {
  type Comparison,
  COMPARISON_SHORT,
  trailingMonths,
} from "@/lib/restaurant/cockpit-comparison";
import {
  type TargetRow,
  type TargetScope,
  dailySalesTarget,
  levelTarget,
  periodSalesTarget,
} from "@/lib/restaurant/objetivos";

export type PeriodKey = "hoy" | "7d" | "30d" | "trimestre";
export const PERIODS: ReadonlyArray<{
  key: PeriodKey;
  label: string;
  days: number;
}> = [
  { key: "hoy", label: "Hoy", days: 1 },
  { key: "7d", label: "7 d", days: 7 },
  { key: "30d", label: "30 d", days: 30 },
  { key: "trimestre", label: "Trimestre", days: 90 },
];

/** Net sales, cost of the costed part, and the sales that cost covers, per day and category. */
export interface MixDayRow {
  date: string;
  category: string;
  net: number;
  cost: number;
  covered_net: number;
}

export const NO_CATEGORY = "Sin categoría";

export function periodRange(period: PeriodKey, refDay: string): Range {
  const days = PERIODS.find((p) => p.key === period)!.days;
  return { from: addDays(refDay, -(days - 1)), to: refDay };
}

export type Tone = "good" | "bad" | "flat";

export interface Chip {
  key: string;
  /** "vs 6 meses", "vs mes pasado", "vs objetivo". */
  label: string;
  /** Percent change (sales) or points (percentages). */
  value: number;
  unit: "pct" | "pts";
  tone: Tone;
}

/** Colour only when the change matters: ≥ 2 % on sales, ≥ 0.5 points on a percentage. */
function toneOf(value: number, unit: "pct" | "pts", upIsGood: boolean): Tone {
  const meaningful =
    unit === "pct" ? Math.abs(value) >= 2 : Math.abs(value) >= 0.5;
  if (!meaningful) return "flat";
  return value > 0 === upIsGood ? "good" : "bad";
}

function chip(
  key: string,
  label: string,
  value: number | null,
  unit: "pct" | "pts",
  upIsGood: boolean
): Chip | null {
  if (value === null) return null;
  return { key, label, value, unit, tone: toneOf(value, unit, upIsGood) };
}

export interface CockpitInput {
  daily: readonly DayPoint[];
  /** The last day with sales: "Hoy" is this day, windows end here. */
  refDay: string;
  /** The real today (company timezone). */
  today: string;
  firstDay: string | null;
  period: PeriodKey;
  comparison: Comparison;
  targets: readonly TargetRow[];
  scope: TargetScope;
  /** The day × category cost rows; null until they have loaded. */
  costRows: readonly MixDayRow[] | null;
  /** Only this category (needs costRows); null = everything. */
  category: string | null;
}

export interface CostFigures {
  net: number;
  cost: number;
  covered_net: number;
  /** Σcost ÷ Σcovered sales; null with no costed sales. */
  food_cost_pct: number | null;
  /** (covered sales − cost) ÷ covered sales. */
  margin_pct: number | null;
  /** $ of margin on the costed sales. */
  margin: number | null;
  /** Costed sales ÷ all sales, 0–100. */
  coverage_pct: number | null;
}

export interface DayBar {
  date: string;
  sales: number;
  target: number | null;
  /** null when there is no target for that day. */
  above: boolean | null;
  deltaPct: number | null;
}

export interface WeekBar {
  label: string;
  from: string;
  to: string;
  sales: number;
  target: number | null;
  above: boolean | null;
}

export interface WeekdayCost {
  weekday: number;
  food_cost_pct: number | null;
  coverage_pct: number | null;
  above: boolean | null;
}

export interface MixSlice {
  category: string;
  net: number;
  share_pct: number;
}

export interface CockpitView {
  range: Range;
  days: number;
  empty: boolean;
  /** Sales over the period and the average per calendar day. */
  sales: number;
  avgDaily: number | null;
  /** Σ daily targets of the period / the average daily target; null = no target. */
  salesTarget: number | null;
  dailyTargetAvg: number | null;
  avgChips: Chip[];
  salesChips: Chip[];
  /** "solo 4 meses de datos" when the trailing window is cut. */
  baselineNote: string | null;
  /** The orange line: the baseline's average per day (null when it cannot be drawn). */
  baselineAvgDaily: number | null;
  baselineLabel: string;
  cost: CostFigures | null;
  costChips: Chip[];
  marginChips: Chip[];
  foodCostTarget: number | null;
  marginTarget: number | null;
  foodCostOverTarget: boolean | null;
  bars: DayBar[];
  aboveDays: number;
  belowDays: number;
  weeks: WeekBar[];
  weekdayCost: WeekdayCost[];
  mix: MixSlice[];
  /** Share of period sales with no category: reported, never invented. */
  uncategorizedPct: number | null;
  ranges: Array<{
    key: PeriodKey;
    label: string;
    sales: number;
    avgDaily: number | null;
  }>;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function costOver(
  rows: readonly MixDayRow[],
  from: string,
  to: string,
  category: string | null,
  netOverride?: number
): CostFigures {
  let net = 0;
  let cost = 0;
  let covered = 0;
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (category && r.category !== category) continue;
    net += r.net;
    cost += r.cost;
    covered += r.covered_net;
  }
  const totalNet = netOverride ?? net;
  return {
    net: totalNet,
    cost,
    covered_net: covered,
    food_cost_pct: ratioOfSums(cost, covered),
    margin_pct: covered > 0 ? ratioOfSums(covered - cost, covered) : null,
    margin: covered > 0 ? covered - cost : null,
    coverage_pct: totalNet > 0 ? (covered / totalNet) * 100 : null,
  };
}

export function computeCockpit(input: CockpitInput): CockpitView {
  const { refDay, firstDay, period } = input;
  const costRows = input.costRows;
  const filtering = !!input.category && !!costRows;

  // The sales series: the rollup's, or one category's from the cost rows.
  const series: DayPoint[] = filtering
    ? (() => {
        const m = new Map<string, number>();
        for (const r of costRows!) {
          if (r.category !== input.category) continue;
          m.set(r.date, (m.get(r.date) ?? 0) + r.net);
        }
        return [...m.entries()].map(([date, net_sales]) => ({
          date,
          net_sales,
        }));
      })()
    : [...input.daily];
  const byDate = indexByDate(series);
  const first = firstDay;

  const range = periodRange(period, refDay);
  const days = daysBetween(range.from, range.to);
  // No sales at all: nothing is computed, nothing is invented.
  if (!first || input.daily.length === 0) {
    return {
      range,
      days,
      empty: true,
      sales: 0,
      avgDaily: null,
      salesTarget: null,
      dailyTargetAvg: null,
      avgChips: [],
      salesChips: [],
      baselineNote: null,
      baselineAvgDaily: null,
      baselineLabel: `vs ${COMPARISON_SHORT[input.comparison]}`,
      cost: null,
      costChips: [],
      marginChips: [],
      foodCostTarget: null,
      marginTarget: null,
      foodCostOverTarget: null,
      bars: [],
      aboveDays: 0,
      belowDays: 0,
      weeks: [],
      weekdayCost: [],
      mix: [],
      uncategorizedPct: null,
      ranges: [],
    };
  }
  const now = windowSales(byDate, range.from, range.to, first);
  const empty = refDay < first;

  // Comparison windows. A shifted window that starts before the data is not shown.
  const shifted = (r: Range): WindowOrNull => {
    if (first && r.from < first) return null;
    const w = windowSales(byDate, r.from, r.to, first);
    return w.avg === null ? null : w;
  };
  type WindowOrNull = ReturnType<typeof windowSales> | null;
  const weekRange = previousWeekRange(range);
  const monthRange = previousMonthRange(range);
  const week = shifted(weekRange);
  const month = shifted(monthRange);

  // The selected baseline.
  const months = trailingMonths(input.comparison);
  const baselineEnd = refDay === input.today ? addDays(refDay, -1) : refDay;
  let baselineAvg: number | null = null;
  let baselineNote: string | null = null;
  if (months !== null) {
    const win = trailingWindow(baselineEnd, months, first);
    const w =
      win.days > 0 ? windowSales(byDate, win.from, win.to, first) : null;
    baselineAvg = w?.avg ?? null;
    baselineNote = baselineAvg === null ? null : dataSpanNote(win);
  } else {
    baselineAvg =
      (input.comparison === "last_week" ? week : month)?.avg ?? null;
  }
  const baselineLabel = `vs ${COMPARISON_SHORT[input.comparison]}`;

  // Targets.
  const salesTarget = periodSalesTarget(
    input.targets,
    range.from,
    range.to,
    input.scope
  );
  const dailyTargetAvg = salesTarget === null ? null : salesTarget / days;

  const avgChips: Chip[] = [];
  const add = (list: Chip[], c: Chip | null) => c && list.push(c);
  add(
    avgChips,
    chip(
      "baseline",
      baselineLabel,
      pctChange(now.avg, baselineAvg),
      "pct",
      true
    )
  );
  if (input.comparison !== "last_month")
    add(
      avgChips,
      chip(
        "month",
        "vs mes pasado",
        pctChange(now.avg, month?.avg ?? null),
        "pct",
        true
      )
    );
  if (input.comparison !== "last_week")
    add(
      avgChips,
      chip(
        "week",
        "vs semana pasada",
        pctChange(now.avg, week?.avg ?? null),
        "pct",
        true
      )
    );
  add(
    avgChips,
    chip(
      "target",
      "vs objetivo",
      pctChange(now.avg, dailyTargetAvg),
      "pct",
      true
    )
  );

  const salesChips: Chip[] = [];
  add(
    salesChips,
    chip(
      "target",
      "vs objetivo",
      pctChange(now.sales, salesTarget),
      "pct",
      true
    )
  );
  add(
    salesChips,
    chip(
      "month",
      "vs mes pasado",
      pctChange(now.avg, month?.avg ?? null),
      "pct",
      true
    )
  );

  // Cost.
  let cost: CostFigures | null = null;
  const costChips: Chip[] = [];
  const marginChips: Chip[] = [];
  const foodCostTarget = levelTarget(
    input.targets,
    "food_cost_pct",
    refDay,
    input.scope.locationId
  );
  const marginTarget = levelTarget(
    input.targets,
    "gross_margin_pct",
    refDay,
    input.scope.locationId
  );
  if (costRows) {
    cost = costOver(
      costRows,
      range.from,
      range.to,
      filtering ? input.category : null,
      now.sales
    );
    const prior = (r: Range, ok: boolean) =>
      ok
        ? costOver(costRows, r.from, r.to, filtering ? input.category : null)
        : null;
    const cMonth = prior(monthRange, month !== null);
    const cWeek = prior(weekRange, week !== null);
    let cBase: CostFigures | null = null;
    if (months !== null) {
      const win = trailingWindow(baselineEnd, months, first);
      cBase =
        win.days > 0
          ? costOver(
              costRows,
              win.from,
              win.to,
              filtering ? input.category : null
            )
          : null;
    } else {
      cBase = input.comparison === "last_week" ? cWeek : cMonth;
    }
    add(
      costChips,
      chip(
        "baseline",
        baselineLabel,
        ptsChange(cost.food_cost_pct, cBase?.food_cost_pct ?? null),
        "pts",
        false
      )
    );
    if (input.comparison !== "last_month")
      add(
        costChips,
        chip(
          "month",
          "vs mes pasado",
          ptsChange(cost.food_cost_pct, cMonth?.food_cost_pct ?? null),
          "pts",
          false
        )
      );
    add(
      costChips,
      chip(
        "target",
        "vs objetivo",
        ptsChange(cost.food_cost_pct, foodCostTarget),
        "pts",
        false
      )
    );
    add(
      marginChips,
      chip(
        "target",
        "vs objetivo",
        ptsChange(cost.margin_pct, marginTarget),
        "pts",
        true
      )
    );
    add(
      marginChips,
      chip(
        "month",
        "vs mes pasado",
        pctChange(cost.margin, cMonth?.margin ?? null),
        "pct",
        true
      )
    );
  }

  // Daily bars: the period, at least two weeks so "Hoy" still has a picture.
  const chartDays = Math.min(90, Math.max(days, 14));
  const chartFrom = addDays(refDay, -(chartDays - 1));
  const bars: DayBar[] = eachDay(chartFrom, refDay).map((date) => {
    const sales = byDate.get(date)?.net_sales ?? 0;
    const target = dailySalesTarget(input.targets, date, input.scope);
    return {
      date,
      sales,
      target,
      above: target === null ? null : sales >= target,
      deltaPct: pctChange(sales, target),
    };
  });
  const aboveDays = bars.filter((b) => b.above === true).length;
  const belowDays = bars.filter((b) => b.above === false).length;

  // Weeks: four 7-day blocks ending on the reference day.
  const weeks: WeekBar[] = [3, 2, 1, 0]
    .map((back) => {
      const to = addDays(refDay, -7 * back);
      const from = addDays(to, -6);
      const cut = !!first && from < first;
      const sales = cut ? 0 : windowSales(byDate, from, to, first).sales;
      const target = periodSalesTarget(input.targets, from, to, input.scope);
      return {
        label: weekLabel(to),
        from,
        to,
        sales: cut ? 0 : sales,
        target,
        above: cut || target === null ? null : sales >= target,
      };
    })
    .filter((w) => !first || w.from >= first);

  // Food cost by weekday over the period (ratio of sums per weekday).
  const weekdayCost: WeekdayCost[] = Array.from({ length: 7 }, (_, weekday) => {
    if (!costRows)
      return { weekday, food_cost_pct: null, coverage_pct: null, above: null };
    let c = 0,
      cov = 0,
      net = 0;
    for (const r of costRows) {
      if (r.date < range.from || r.date > range.to) continue;
      if (filtering && r.category !== input.category) continue;
      if (weekdayIndex(r.date) !== weekday) continue;
      c += r.cost;
      cov += r.covered_net;
      net += r.net;
    }
    const pct = ratioOfSums(c, cov);
    return {
      weekday,
      food_cost_pct: pct,
      coverage_pct: net > 0 ? (cov / net) * 100 : null,
      above:
        pct === null || foodCostTarget === null ? null : pct > foodCostTarget,
    };
  });

  // Mix by category over the period (all categories, never the filtered one only).
  const mixMap = new Map<string, number>();
  if (costRows) {
    for (const r of costRows) {
      if (r.date < range.from || r.date > range.to) continue;
      mixMap.set(r.category, (mixMap.get(r.category) ?? 0) + r.net);
    }
  }
  const mixTotal = sum([...mixMap.values()]);
  const mix: MixSlice[] = [...mixMap.entries()]
    .map(([category, net]) => ({
      category,
      net,
      share_pct: mixTotal > 0 ? (net / mixTotal) * 100 : 0,
    }))
    .sort((a, b) => b.net - a.net);
  const uncategorized = mixMap.get(NO_CATEGORY) ?? 0;

  const ranges = PERIODS.map((p) => {
    const r = periodRange(p.key, refDay);
    const w = windowSales(byDate, r.from, r.to, first);
    return { key: p.key, label: p.label, sales: w.sales, avgDaily: w.avg };
  });

  return {
    range,
    days,
    empty,
    sales: now.sales,
    avgDaily: now.avg,
    salesTarget,
    dailyTargetAvg,
    avgChips,
    salesChips,
    baselineNote,
    baselineAvgDaily: baselineAvg,
    baselineLabel,
    cost,
    costChips,
    marginChips,
    foodCostTarget,
    marginTarget,
    foodCostOverTarget:
      cost?.food_cost_pct == null || foodCostTarget === null
        ? null
        : cost.food_cost_pct > foodCostTarget,
    bars,
    aboveDays,
    belowDays,
    weeks,
    weekdayCost,
    mix,
    uncategorizedPct: mixTotal > 0 ? (uncategorized / mixTotal) * 100 : null,
    ranges,
  };
}

/** "S40": the ISO week number of a day. */
export function weekLabel(ymd: string): string {
  const d = new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
  );
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `S${week}`;
}
