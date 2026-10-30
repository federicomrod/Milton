"use client";

// R1-16b (mock 11): the Cockpit. ONE dataset is loaded with the page (the daily
// net sales of all history, the targets) and ONE more request fills the cost
// and the sales mix once the page has painted. Every control after that —
// period, «Comparar con», the category filter — only recomputes
// computeCockpit() in the browser: no request, no spinner, no router
// navigation.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COMPARISONS,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
import { I18nProvider } from "@/lib/i18n/client";
import { fmt, getDictionary, type Dictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { formatMoney, rangeLabel } from "@/lib/restaurant/cockpit-format";
import {
  PERIODS,
  computeCockpit,
  type Chip,
  type MixDayRow,
  type PeriodKey,
} from "@/lib/restaurant/cockpit-v2";
import type { DayPoint } from "@/lib/restaurant/cockpit-math";
import {
  explainMissingSalesTarget,
  type TargetRow,
} from "@/lib/restaurant/objetivos";
import { cockpitSummaryLines } from "@/lib/restaurant/cockpit-insight";
import {
  OBJECTIVES_HREF,
  SALES_DETAIL_HREF,
  withShellParams,
} from "@/lib/restaurant/navigation";
import {
  DailyBarsChart,
  MixDonut,
  WeekdayCostChart,
  WeeksChart,
} from "@/components/restaurant/cockpit/v2/charts";

export interface CockpitV2Props {
  currency: string;
  daily: DayPoint[];
  refDay: string;
  today: string;
  firstDay: string | null;
  targets: TargetRow[];
  restaurants: Array<{ id: string; name: string }>;
  locationId: string | null;
  defaultComparison: Comparison;
  /** Language of the company; the Cockpit defaults to Spanish. */
  lang?: PreferredLanguage;
}

type CostState =
  | { kind: "loading" }
  | { kind: "ready"; rows: MixDayRow[] }
  | { kind: "error" };

// Kept for the session: coming back to the Cockpit does not read it again.
const costCache = new Map<string, MixDayRow[]>();

const PERIOD_KEYS: Record<PeriodKey, keyof Dictionary["cockpit"]["periods"]> = {
  hoy: "today",
  "7d": "d7",
  "30d": "d30",
  trimestre: "quarter",
};

const COMPARISON_KEYS: Record<
  Comparison,
  keyof Dictionary["cockpit"]["comparisons"]
> = {
  last_week: "lastWeek",
  last_month: "lastMonth",
  months_3: "months3",
  months_6: "months6",
  months_12: "months12",
};

/** The chip text in the company's language; the view keeps the chip KEY, not its words. */
function chipLabel(
  c: Chip,
  comparison: Comparison,
  d: Dictionary["cockpit"]
): string {
  if (c.key === "target") return d.chips.vsTarget;
  if (c.key === "month") return d.chips.vsLastMonth;
  if (c.key === "week") return d.chips.vsLastWeek;
  return fmt(d.chips.vsBaseline, {
    what: d.comparisonsShort[COMPARISON_KEYS[comparison]],
  });
}

function ChipView({
  c,
  comparison,
  d,
}: {
  c: Chip;
  comparison: Comparison;
  d: Dictionary["cockpit"];
}) {
  const arrow = c.value > 0 ? "▲" : c.value < 0 ? "▼" : "=";
  const abs = Math.abs(c.value);
  const label = chipLabel(c, comparison, d);
  const text =
    c.unit === "pts"
      ? c.key === "target"
        ? c.value > 0
          ? fmt(d.chips.ptsAboveTarget, { arrow, abs })
          : c.value < 0
            ? fmt(d.chips.ptsBelowTarget, { arrow, abs })
            : d.chips.atTarget
        : c.value === 0
          ? fmt(d.chips.equal, { label })
          : fmt(d.chips.pts, { arrow, abs, label })
      : c.value === 0
        ? fmt(d.chips.equal, { label })
        : fmt(d.chips.pct, { arrow, abs: Math.round(abs), label });
  const tone =
    c.tone === "good"
      ? "bg-[#A7F3D0] text-[#0F172A]"
      : c.tone === "bad"
        ? "bg-[#FBCFE8] text-[#0F172A]"
        : "bg-[#f2f3f6] text-[#5b6476]";
  return (
    <span
      className={"rounded-full px-2 py-0.5 text-[12px] font-semibold " + tone}
    >
      {text}
    </span>
  );
}

function Card({
  label,
  value,
  sub,
  chips,
  note,
  loading,
  comparison,
  d,
}: {
  label: string;
  value: string;
  sub?: string;
  chips: Chip[];
  note?: string | null;
  loading?: boolean;
  comparison: Comparison;
  d: Dictionary["cockpit"];
}) {
  return (
    <div className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3.5">
      <div className="text-[12px] text-[#6b7385]">{label}</div>
      <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
        {loading ? <span className="text-[#c6d3f5]">…</span> : value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[12px] text-[#8a92a3]">{sub}</div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <ChipView key={c.key} c={c} comparison={comparison} d={d} />
        ))}
      </div>
      {note ? (
        <div className="mt-1 text-[12px] text-[#8a92a3]">{note}</div>
      ) : null}
    </div>
  );
}

export function CockpitV2(props: CockpitV2Props) {
  const lang = props.lang ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  return (
    <I18nProvider lang={lang}>
      <CockpitV2Body {...props} lang={lang} />
    </I18nProvider>
  );
}

function CockpitV2Body(props: CockpitV2Props & { lang: PreferredLanguage }) {
  const { lang } = props;
  const d = getDictionary(lang).cockpit;
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [comparison, setComparison] = useState<Comparison>(
    props.defaultComparison
  );
  const [category, setCategory] = useState<string | null>(null);
  const costKey = props.locationId ?? "todos";
  const [cost, setCost] = useState<CostState>(() => {
    const cached = costCache.get(costKey);
    return cached ? { kind: "ready", rows: cached } : { kind: "loading" };
  });
  const [attempt, setAttempt] = useState(0);

  // The ONE extra request: the day × category costs, after the page has painted.
  // It depends only on the restaurant, never on the period or the comparison.
  useEffect(() => {
    if (costCache.has(costKey) && attempt === 0) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (props.locationId) params.set("location_id", props.locationId);
    fetch(`/api/restaurant/cockpit-cost-days?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("cost"))))
      .then((json: { rows?: MixDayRow[] }) => {
        if (cancelled) return;
        const rows = json.rows ?? [];
        costCache.set(costKey, rows);
        setCost({ kind: "ready", rows });
      })
      .catch(() => {
        if (!cancelled) setCost({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [costKey, props.locationId, attempt]);

  const scope = useMemo(
    () => ({
      locationId: props.locationId,
      restaurantIds: props.restaurants.map((r) => r.id),
    }),
    [props.locationId, props.restaurants]
  );
  const costRows = cost.kind === "ready" ? cost.rows : null;
  const view = useMemo(
    () =>
      computeCockpit({
        daily: props.daily,
        refDay: props.refDay,
        today: props.today,
        firstDay: props.firstDay,
        period,
        comparison,
        targets: props.targets,
        scope,
        costRows,
        category,
        lang,
      }),
    [
      props.daily,
      props.refDay,
      props.today,
      props.firstDay,
      period,
      comparison,
      props.targets,
      scope,
      costRows,
      category,
      lang,
    ]
  );

  const money = (n: number) =>
    formatMoney(n, props.currency, lang, { decimals: 0 });
  const periodText = (key: PeriodKey) => d.periods[PERIOD_KEYS[key]];
  const periodLabel = periodText(period);
  // Ventas reads p=custom&desde&hasta (not from/to).
  const toSales = (from: string, to: string) => {
    const base = withShellParams(SALES_DETAIL_HREF, {
      locationId: props.locationId,
    });
    router.push(
      `${base}${base.includes("?") ? "&" : "?"}p=custom&desde=${from}&hasta=${to}`
    );
  };

  if (view.empty) {
    return (
      <p className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-6 text-[13px] text-[#6b7385]">
        {d.v2.noSales}
      </p>
    );
  }

  const loadingCost = cost.kind === "loading";
  const c = view.cost;
  const insight = buildInsight(view, props.targets.length > 0, lang);

  return (
    <div className="space-y-3" data-testid="cockpit-v2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={d.periods.label}
          className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
        >
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-[9px] px-3.5 py-1.5 " +
                (period === p.key
                  ? "bg-[#1b40c8] text-white shadow-sm"
                  : "text-[#4a5a85] hover:text-[#1b40c8]")
              }
            >
              {periodText(p.key)}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
          {d.v2.compareWith}
          <select
            aria-label={d.v2.compareAria}
            value={comparison}
            onChange={(e) => setComparison(e.target.value as Comparison)}
            className="bg-transparent font-bold outline-none"
          >
            {COMPARISONS.map((k) => (
              <option key={k} value={k}>
                {d.comparisons[COMPARISON_KEYS[k]]}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
          <select
            aria-label={d.v2.restaurantAria}
            value={props.locationId ?? ""}
            onChange={(e) =>
              router.push(
                e.target.value
                  ? `?location=${encodeURIComponent(e.target.value)}`
                  : "?"
              )
            }
            className="bg-transparent outline-none"
          >
            <option value="">{d.v2.allRestaurants}</option>
            {props.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {category ? (
          <button
            type="button"
            onClick={() => setCategory(null)}
            className="rounded-full border border-[#1b40c8] bg-[#e6ecfb] px-3 py-1 text-[12px] font-semibold text-[#1b40c8]"
          >
            {fmt(d.v2.filtering, { category })}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label={d.v2.avgDaily}
          comparison={comparison}
          d={d}
          value={view.avgDaily === null ? "—" : money(view.avgDaily)}
          sub={
            view.dailyTargetAvg !== null
              ? fmt(d.v2.target, { amount: money(view.dailyTargetAvg) })
              : undefined
          }
          chips={view.avgChips}
          note={view.baselineNote}
        />
        <Card
          label={fmt(d.v2.salesCard, { period: periodLabel })}
          comparison={comparison}
          d={d}
          value={money(view.sales)}
          chips={view.salesChips}
        />
        <Card
          label={d.v2.foodCost}
          comparison={comparison}
          d={d}
          loading={loadingCost}
          value={
            c?.food_cost_pct != null
              ? `${Math.round(c.food_cost_pct)}%`
              : d.v2.noPrice
          }
          sub={
            cost.kind === "error"
              ? d.v2.costFailed
              : c
                ? `${view.foodCostTarget !== null ? fmt(d.v2.targetDot, { pct: view.foodCostTarget }) : ""}${fmt(d.v2.coverage, { pct: Math.round(c.coverage_pct ?? 0) })}`
                : d.v2.calculating
          }
          chips={view.costChips}
        />
        <Card
          label={d.v2.grossMargin}
          comparison={comparison}
          d={d}
          loading={loadingCost}
          value={c?.margin != null ? money(c.margin) : d.v2.noPrice}
          sub={
            c
              ? `${c.margin_pct != null ? `${Math.round(c.margin_pct)}%` : "—"}${view.marginTarget !== null ? fmt(d.v2.marginTarget, { pct: view.marginTarget }) : ""}`
              : undefined
          }
          chips={view.marginChips}
        />
      </div>
      {cost.kind === "error" ? (
        <button
          type="button"
          onClick={() => {
            setCost({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="text-[12px] font-semibold text-[#1b40c8] underline"
        >
          {d.v2.retryCost}
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {view.ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setPeriod(r.key)}
            aria-pressed={period === r.key}
            className={
              "flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px] " +
              (period === r.key
                ? "border-[#1b40c8] bg-[#eef2fc]"
                : "border-[#dbe3f7] bg-white hover:border-[#a9bcf0]")
            }
          >
            <span className="font-semibold">{periodText(r.key)}</span>
            <span className="text-right tabular-nums">
              <b>{money(r.sales)}</b>
              <span className="block text-[12px] text-[#8a92a3]">
                {r.avgDaily === null
                  ? "—"
                  : fmt(d.v2.perDay, { amount: money(r.avgDaily) })}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-[14px] font-bold">{d.v2.dailySales}</h2>
          </div>
          <DailyBarsChart
            bars={view.bars}
            baselineAvg={view.baselineAvgDaily}
            baselineLabel={d.comparisonsShort[COMPARISON_KEYS[comparison]]}
            money={money}
            onDay={(d) => toSales(d, d)}
          />
          {!view.bars.some((b) => b.target !== null) ? (
            <p className="mt-1 text-[12px] text-[#8a92a3]">
              {missingGoalText(
                explainMissingSalesTarget(
                  props.targets,
                  scope,
                  view.bars.map((b) => b.date)
                ),
                d,
                lang
              )}
            </p>
          ) : null}
        </section>
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-2 flex items-baseline">
            <h2 className="text-[14px] font-bold">{d.v2.salesMix}</h2>
          </div>
          <MixDonut
            slices={view.mix}
            total={view.mix.reduce((a, s) => a + s.net, 0)}
            money={money}
            active={category}
            onSlice={setCategory}
            loading={loadingCost}
          />
          {view.uncategorizedPct !== null && view.uncategorizedPct > 0 ? (
            <p className="mt-2 text-[12px] text-[#8a92a3]">
              {fmt(d.v2.uncategorized, {
                pct: Math.round(view.uncategorizedPct * 10) / 10,
              })}
            </p>
          ) : null}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-2 flex items-baseline">
            <h2 className="text-[14px] font-bold">{d.v2.weekVsWeek}</h2>
            <span className="ml-auto text-[12px] text-[#8a92a3]">
              {view.weeks.some((w) => w.target !== null)
                ? d.v2.weeklyTargetLine
                : ""}
            </span>
          </div>
          <WeeksChart
            weeks={view.weeks}
            money={money}
            onWeek={(w) => toSales(w.from, w.to)}
          />
        </section>
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-2 flex items-baseline">
            <h2 className="text-[14px] font-bold">{d.v2.foodCostByDay}</h2>
            <span className="ml-auto text-[12px] text-[#8a92a3]">
              {view.foodCostTarget !== null
                ? fmt(d.v2.costLine, { pct: view.foodCostTarget })
                : ""}
            </span>
          </div>
          <WeekdayCostChart
            days={view.weekdayCost}
            target={view.foodCostTarget}
            loading={loadingCost}
          />
        </section>
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <h2 className="mb-2 text-[14px] font-bold">{d.v2.miltonTitle}</h2>
          <ul
            className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed"
            data-testid="cockpit-milton-summary"
          >
            {insight.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3">
            <a
              href={OBJECTIVES_HREF}
              className="inline-block rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
            >
              {props.targets.length > 0
                ? d.v2.adjustTargets
                : d.v2.defineTargets}
            </a>
            {insight.action === "days" ? (
              <button
                type="button"
                onClick={() => toSales(view.range.from, view.range.to)}
                className="ml-2 rounded-lg border border-[#c6d3f5] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1b40c8] hover:bg-[#eef2fc]"
              >
                {d.v2.viewDaysBelow}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function missingGoalText(
  gap: ReturnType<typeof explainMissingSalesTarget>,
  d: Dictionary["cockpit"],
  lang: PreferredLanguage
): string {
  if (gap?.reason === "starts_later") {
    return fmt(d.v2.goalStartsLater, {
      date: rangeLabel(gap.from, gap.from, lang),
    });
  }
  if (gap?.reason === "company_only") return d.v2.goalCompanyOnly;
  return d.v2.noSalesTarget;
}

/** The Milton box: lines from the daily bars; the button follows the days below objetivo. */
function buildInsight(
  view: ReturnType<typeof computeCockpit>,
  hasTargets: boolean,
  lang: PreferredLanguage
): { lines: string[]; action: "days" | "targets" } {
  return {
    lines: cockpitSummaryLines(view, hasTargets, lang),
    action: view.belowDays > 0 ? "days" : "targets",
  };
}
