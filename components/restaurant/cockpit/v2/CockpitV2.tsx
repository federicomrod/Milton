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
  COMPARISON_LABEL,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
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
import { weekdayIndex } from "@/lib/restaurant/cockpit-math";
import {
  OBJECTIVES_HREF,
  SALES_DETAIL_HREF,
  withShellParams,
} from "@/lib/restaurant/navigation";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
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
}

type CostState =
  | { kind: "loading" }
  | { kind: "ready"; rows: MixDayRow[] }
  | { kind: "error" };

// Kept for the session: coming back to the Cockpit does not read it again.
const costCache = new Map<string, MixDayRow[]>();

const WEEKDAYS_PLURAL = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábados",
  "domingos",
];

function ChipView({ c }: { c: Chip }) {
  const arrow = c.value > 0 ? "▲" : c.value < 0 ? "▼" : "=";
  const abs = Math.abs(c.value);
  const text =
    c.unit === "pts"
      ? c.label === "vs objetivo"
        ? c.value > 0
          ? `${arrow} ${abs} pts sobre objetivo`
          : c.value < 0
            ? `${arrow} ${abs} pts bajo objetivo`
            : "= objetivo"
        : c.value === 0
          ? `= ${c.label}`
          : `${arrow} ${abs} pts ${c.label}`
      : c.value === 0
        ? `= ${c.label}`
        : `${arrow} ${Math.round(abs)}% ${c.label}`;
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
}: {
  label: string;
  value: string;
  sub?: string;
  chips: Chip[];
  note?: string | null;
  loading?: boolean;
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
          <ChipView key={c.key} c={c} />
        ))}
      </div>
      {note ? (
        <div className="mt-1 text-[12px] text-[#8a92a3]">{note}</div>
      ) : null}
    </div>
  );
}

export function CockpitV2(props: CockpitV2Props) {
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
    ]
  );

  const money = (n: number) =>
    formatMoneyEs(n, props.currency, { decimals: 0 });
  const periodLabel = PERIODS.find((p) => p.key === period)!.label;
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
        Aún no hay ventas para mostrar.
      </p>
    );
  }

  const loadingCost = cost.kind === "loading";
  const c = view.cost;
  const insight = buildInsight(view, props.targets.length > 0);

  return (
    <div className="space-y-3" data-testid="cockpit-v2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Periodo"
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
              {p.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
          Comparar con:
          <select
            aria-label="Comparar con"
            value={comparison}
            onChange={(e) => setComparison(e.target.value as Comparison)}
            className="bg-transparent font-bold outline-none"
          >
            {COMPARISONS.map((k) => (
              <option key={k} value={k}>
                {COMPARISON_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
          <select
            aria-label="Restaurante"
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
            <option value="">Todos los restaurantes</option>
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
            Filtrando: {category} ×
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Venta promedio diaria"
          value={view.avgDaily === null ? "—" : money(view.avgDaily)}
          sub={
            view.dailyTargetAvg !== null
              ? `objetivo ${money(view.dailyTargetAvg)}`
              : undefined
          }
          chips={view.avgChips}
          note={view.baselineNote}
        />
        <Card
          label={`Ventas · ${periodLabel}`}
          value={money(view.sales)}
          chips={view.salesChips}
        />
        <Card
          label="Costo de comida"
          loading={loadingCost}
          value={
            c?.food_cost_pct != null
              ? `${Math.round(c.food_cost_pct)}%`
              : "Sin precio"
          }
          sub={
            cost.kind === "error"
              ? "No pude calcular el costo ahora"
              : c
                ? `${view.foodCostTarget !== null ? `objetivo ${view.foodCostTarget}% · ` : ""}cobertura ${Math.round(c.coverage_pct ?? 0)}% de las ventas`
                : "Calculando…"
          }
          chips={view.costChips}
        />
        <Card
          label="Margen bruto"
          loading={loadingCost}
          value={c?.margin != null ? money(c.margin) : "Sin precio"}
          sub={
            c
              ? `${c.margin_pct != null ? `${Math.round(c.margin_pct)}%` : "—"}${view.marginTarget !== null ? ` · objetivo ${view.marginTarget}%` : ""}`
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
          Reintentar el costo
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
            <span className="font-semibold">{r.label}</span>
            <span className="text-right tabular-nums">
              <b>{money(r.sales)}</b>
              <span className="block text-[12px] text-[#8a92a3]">
                {r.avgDaily === null ? "—" : `${money(r.avgDaily)}/día`}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-[14px] font-bold">Ventas diarias</h2>
          </div>
          <DailyBarsChart
            bars={view.bars}
            baselineAvg={view.baselineAvgDaily}
            baselineLabel={view.baselineLabel}
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
                )
              )}
            </p>
          ) : null}
        </section>
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-2 flex items-baseline">
            <h2 className="text-[14px] font-bold">Mezcla de ventas</h2>
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
              {Math.round(view.uncategorizedPct * 10) / 10}% de las ventas no
              tiene categoría.
            </p>
          ) : null}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <div className="mb-2 flex items-baseline">
            <h2 className="text-[14px] font-bold">Semana vs semana</h2>
            <span className="ml-auto text-[12px] text-[#8a92a3]">
              {view.weeks.some((w) => w.target !== null)
                ? "línea = objetivo semanal"
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
            <h2 className="text-[14px] font-bold">Costo de comida por día</h2>
            <span className="ml-auto text-[12px] text-[#8a92a3]">
              {view.foodCostTarget !== null
                ? `línea = ${view.foodCostTarget}%`
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
          <h2 className="mb-2 text-[14px] font-bold">✦ Milton</h2>
          <p className="text-[13px] leading-relaxed">{insight.text}</p>
          <div className="mt-3">
            <a
              href={OBJECTIVES_HREF}
              className="inline-block rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
            >
              {props.targets.length > 0
                ? "Ajusta tus objetivos"
                : "Definir objetivos"}
            </a>
            {insight.action === "days" ? (
              <button
                type="button"
                onClick={() => toSales(view.range.from, view.range.to)}
                className="ml-2 rounded-lg border border-[#c6d3f5] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1b40c8] hover:bg-[#eef2fc]"
              >
                Ver días bajo objetivo
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

const MONTHS_ES = [
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
];
function missingGoalText(
  gap: ReturnType<typeof explainMissingSalesTarget>
): string {
  if (gap?.reason === "starts_later") {
    const d = gap.from;
    return `Tus objetivos empiezan el ${Number(d.slice(8))} ${MONTHS_ES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)} y estos datos son anteriores: elige «Vigente desde» antes en Configuración › Objetivos.`;
  }
  if (gap?.reason === "company_only") {
    return "Tu objetivo de ventas es para todos los restaurantes: elige «Todos los restaurantes» o define uno para este restaurante.";
  }
  return "Sin objetivo de ventas.";
}

/** One short reading from real numbers only; nothing is said that was not computed. */
function buildInsight(
  view: ReturnType<typeof computeCockpit>,
  hasTargets: boolean
): { text: string; action: "days" | "targets" } {
  const parts: string[] = [];
  const base = view.avgChips.find((c) => c.key === "baseline");
  if (base) {
    const word = base.value >= 0 ? "sobre" : "bajo";
    parts.push(
      `Vas ${Math.abs(Math.round(base.value))}% ${word} tu promedio (${view.baselineLabel.replace("vs ", "")}).`
    );
  }
  // Weekdays whose days with a target fall well short of it.
  const byDay = new Map<number, number[]>();
  for (const b of view.bars) {
    if (b.deltaPct === null) continue;
    const wd = weekdayIndex(b.date);
    byDay.set(wd, [...(byDay.get(wd) ?? []), b.deltaPct]);
  }
  const weak = [...byDay.entries()]
    .map(([wd, v]) => ({
      wd,
      avg: v.reduce((a, b) => a + b, 0) / v.length,
      n: v.length,
    }))
    .filter((x) => x.n >= 2 && x.avg <= -10)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 2);
  if (weak.length > 0) {
    const names = weak.map((w) => WEEKDAYS_PLURAL[w.wd]).join(" y ");
    parts.push(
      `Los ${names} quedan bajo objetivo (${Math.round(weak[0].avg)}%).`
    );
  }
  const target = view.costChips.find((c) => c.key === "target");
  if (target && target.value !== 0) {
    parts.push(
      `El costo de comida está ${Math.abs(target.value)} pts ${target.value > 0 ? "sobre" : "bajo"} tu objetivo.`
    );
  }
  if (parts.length === 0) {
    parts.push(
      hasTargets
        ? "Aún no hay suficientes datos para una lectura."
        : "Define tus objetivos y Milton te dice cómo vas contra ellos."
    );
  }
  return {
    text: parts.join(" "),
    action: view.belowDays > 0 ? "days" : "targets",
  };
}
