"use client";

// Menú › Resumen (R1-18): the menu's cockpit on one page. Four KPIs, Top
// platos por ventas, Mejor / Peor margen and a compact Pendientes panel.
// Setup (Excel de costos, recetas importadas, Costos por decidir) lives at the
// top of Costos now. Like Cockpit v2 it reads ONE dataset after paint
// (lib/restaurant/menu-resumen.ts) and recomputes range and rankings in the
// browser: no navigation, no spinner. Nothing here is a made-up number: a
// missing price is «Sin precio» / «margen —», never $0 or 0%.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  computeResumen,
  monthLabel,
  resumenRange,
  type DishRow,
  type ResumenPeriod,
  type ResumenView,
} from "@/lib/restaurant/menu-resumen";
import {
  RANKING_INCLUDES_ESTIMATED,
  type RankedDish,
} from "@/lib/restaurant/costing/menu-summary";
import {
  dishHref,
  ingredientesHref,
  platosHref,
} from "@/lib/restaurant/menu-links";
import { dishCoverageLabel } from "@/lib/restaurant/costing/dish-coverage";
import { groupStatusDisplay } from "@/lib/restaurant/costing/rollup";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import type { DishEstimateRow } from "@/lib/restaurant/menu-reading/estimate";
import {
  canEditRecipes,
  extraEstimatedDishes,
  extraEstimatedLabel,
} from "@/components/restaurant/menu/estimate-overlay";
import { MenuReaderCard } from "@/components/restaurant/menu/MenuReaderCard";
import { markTabsStale } from "@/lib/restaurant/recipe-costing/menu-tab-cache";
import { useResumenData } from "./use-resumen-data";

const BLUE = "#1b40c8";
const pctOf = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

/** «Junio 2026»: Spanish keeps the shared label; other languages use Intl. */
function localMonthLabel(
  lastDay: string,
  lang: string,
  locale: string
): string {
  if (lang === "es") return monthLabel(lastDay);
  const month = new Date(
    Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(5, 7) - 1, 1)
  );
  const name = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(month);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${lastDay.slice(0, 4)}`;
}

function IaChip() {
  const { d } = useT();
  return (
    <span
      title={d.menu.workspace.resumen.iaTitle}
      className="ml-1 rounded-md bg-[#f2ecff] px-1 py-px text-[10px] font-bold text-[#6b3fc9]"
    >
      {d.menu.workspace.resumen.ia}
    </span>
  );
}

export function ResumenScreen({
  data,
  locationId,
  estimates = [],
}: {
  data: RecipeCostingWorkspace;
  locationId: string | null;
  /** «Estimado por Milton»: only counted in one separate line. */
  estimates?: DishEstimateRow[];
}) {
  const router = useRouter();
  const { d, lang, locale } = useT();
  const w = d.menu.workspace.resumen;
  const { data: days, failed, retry } = useResumenData(locationId);
  const [period, setPeriod] = useState<ResumenPeriod>("month");
  const [now] = useState(() => Date.now());
  const view = useMemo(
    () =>
      days && days.last_day
        ? computeResumen(days, resumenRange(period, days.last_day), {
            includeEstimatedInRanking: RANKING_INCLUDES_ESTIMATED,
          })
        : null,
    [days, period]
  );
  const extraEstimated = useMemo(
    () => (view ? extraEstimatedDishes(estimates, view.dishes) : 0),
    [view, estimates]
  );
  const summary = data.menu_summary;
  if (!summary) return null;
  if (failed)
    return (
      <div
        role="alert"
        className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-6 text-[13px]"
      >
        <p className="text-[#c03535]">{w.loadFailed}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 rounded-lg bg-[#1b40c8] px-3 py-1.5 text-[12.5px] font-semibold text-white"
        >
          {w.retry}
        </button>
      </div>
    );
  return (
    <ResumenCockpit
      view={view}
      currency={data.currency}
      period={period}
      onPeriod={setPeriod}
      monthText={
        days?.last_day
          ? localMonthLabel(days.last_day, lang, locale)
          : w.monthFallback
      }
      missingPriceIngredients={summary.missing_price_ingredients}
      latestUpload={data.latest_upload}
      now={now}
      extraEstimated={extraEstimated}
      menuReader={
        <MenuReaderCard
          canEdit={canEditRecipes(data.actor)}
          companyId={data.company_id}
          noRecipeDishes={
            !view || view.empty ? null : view.counts.sin_receta.dishes
          }
          locationId={locationId}
          onDone={() => {
            markTabsStale();
            router.refresh();
          }}
        />
      }
    />
  );
}

export function ResumenCockpit({
  view,
  currency,
  period,
  onPeriod,
  monthText,
  missingPriceIngredients,
  latestUpload,
  now,
  extraEstimated = 0,
  menuReader = null,
}: {
  /** «Lee tu menú y estima costos» card, above Top platos. */
  menuReader?: React.ReactNode;
  /** Dishes with an approximate margin only from Milton's estimate (separate line). */
  extraEstimated?: number;
  view: ResumenView | null;
  currency: string;
  period: ResumenPeriod;
  onPeriod: (p: ResumenPeriod) => void;
  monthText: string;
  missingPriceIngredients: number;
  latestUpload: { filename: string; created_at: string | null } | null;
  now: number;
}) {
  const { d, lang } = useT();
  const w = d.menu.workspace.resumen;
  const money = (n: number, dec = 0) =>
    formatMoneyEs(n, currency, { decimals: dec }, lang);
  return (
    <div className="space-y-3" data-testid="menu-resumen">
      <div
        role="group"
        aria-label={w.rangeAria}
        className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
      >
        {(
          [
            ["7d", w.range7d],
            ["month", monthText],
            ["90d", w.range90d],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={period === key}
            onClick={() => onPeriod(key)}
            className={
              "rounded-[9px] px-3.5 py-1 " +
              (period === key
                ? "bg-white text-[#151c2c] shadow-sm"
                : "text-[#4a5a85] hover:text-[#1b40c8]")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {!view ? (
        <ResumenSkeleton />
      ) : view.empty ? (
        <>
          {menuReader}
          <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#6b7385]">
            {w.noSales}
          </p>
        </>
      ) : (
        <>
          <Kpis view={view} money={money} />
          {extraEstimated > 0 ? (
            <p
              className="text-[12px] text-[#6b7280]"
              data-testid="resumen-estimates-line"
            >
              {extraEstimatedLabel(extraEstimated)}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_290px]">
            <div className="space-y-3">
              {menuReader}
              <TopPlatos view={view} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <MarginCard kind="best" view={view} money={money} />
                <MarginCard kind="worst" view={view} money={money} />
              </div>
            </div>
            <Pendientes
              view={view}
              missing={missingPriceIngredients}
              latestUpload={latestUpload}
              now={now}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ResumenSkeleton() {
  return (
    <div
      className="space-y-3"
      aria-busy="true"
      data-testid="menu-resumen-loading"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[92px] animate-pulse rounded-[14px] bg-[#e9ecf2]"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_290px]">
        <div className="h-[330px] animate-pulse rounded-[14px] bg-[#e9ecf2]" />
        <div className="h-[330px] animate-pulse rounded-[14px] bg-[#e9ecf2]" />
      </div>
    </div>
  );
}

function Kpis({
  view,
  money,
}: {
  view: ResumenView;
  money: (n: number, d?: number) => string;
}) {
  const { d, fmt } = useT();
  const w = d.menu.workspace.resumen;
  const k = view.kpis;
  const allCosted = k.all_costed;
  const costed = k.covered_dishes;
  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    href: string;
    tone?: "bad" | "good";
  }> = [
    {
      label: w.foodCost,
      value:
        k.food_cost_pct !== null
          ? `${Math.round(k.food_cost_pct)}%`
          : w.noPrice,
      sub: allCosted ? w.subAllSales : w.subOnlyCosted,
      href: platosHref(["aprobado"]),
    },
    {
      label: w.grossMargin,
      value:
        k.gross_margin !== null
          ? money(k.gross_margin, allCosted ? 0 : 2)
          : "—",
      sub: allCosted ? w.subInRange : w.subOnlyCosted,
      href: platosHref(["aprobado"]),
    },
    {
      label: w.salesWithCost,
      value: `${Math.round(k.coverage_pct)}%`,
      sub: allCosted
        ? fmt(w.subDishesOf, { costed, total: k.dish_count })
        : dishCoverageLabel({
            covered: costed,
            partial: k.partial_dishes,
            total: k.dish_count,
          }),
      href: platosHref(),
      tone: allCosted ? "good" : undefined,
    },
    allCosted
      ? {
          label: w.lowMarginTitle,
          value: String(k.low_margin_count),
          sub: w.lowMarginSub,
          href: platosHref(["aprobado"]),
          tone: k.low_margin_count > 0 ? "bad" : undefined,
        }
      : {
          label: w.problemTitle,
          value: String(k.problem_count),
          sub: fmt(w.problemSub, { total: k.dish_count }),
          href: platosHref(["falta_precio", "borrador", "sin_receta"]),
          tone: k.problem_count > 0 ? "bad" : undefined,
        },
  ];
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="menu-resumen-kpis"
    >
      {cards.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3 hover:border-[#1b40c8]"
        >
          <div className="text-[12px] text-[#6b7385]">{c.label}</div>
          <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
            {c.value}
          </div>
          <div
            className={
              "mt-0.5 text-[12px] " +
              (c.tone === "bad"
                ? "text-[#d14343]"
                : c.tone === "good"
                  ? "text-[#1f9d55] font-semibold"
                  : "text-[#8a92a3]")
            }
          >
            {c.sub}
          </div>
        </Link>
      ))}
    </div>
  );
}

function MarginChip({ d: dish }: { d: DishRow }) {
  const { d, fmt } = useT();
  const w = d.menu.workspace.resumen;
  const g = groupStatusDisplay(dish);
  if (g.mixed && dish.approved_margin_pct !== null) {
    return (
      <span
        className="inline-flex items-center"
        title={g.label}
        data-testid="margen-parcial"
      >
        <span className="rounded-md bg-[#eef2fd] px-1.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]">
          {fmt(w.partialSizes, {
            pct: Math.round(dish.approved_margin_pct),
            approved: dish.approved_count,
            total: dish.variant_count,
          })}
        </span>
      </span>
    );
  }
  if (dish.margin_pct === null)
    return <span className="text-[12px] text-[#8a92a3]">{w.marginDash}</span>;
  if (dish.cost_status === "aprobado" || dish.cost_status === "estimado") {
    return (
      <span className="inline-flex items-center">
        <span className="rounded-md bg-[#e7f6ee] px-1.5 py-0.5 text-[12px] font-semibold text-[#1f7a45]">
          {Math.round(dish.margin_pct)}%
        </span>
        {dish.cost_status === "estimado" ? <IaChip /> : null}
      </span>
    );
  }
  return <span className="text-[12px] text-[#8a92a3]">{w.marginDash}</span>;
}

function TopPlatos({ view }: { view: ResumenView }) {
  const { d, fmt } = useT();
  const w = d.menu.workspace.resumen;
  const max = Math.max(...view.top.map((row) => row.share), 0.0001);
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid="menu-resumen-top"
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">{w.topTitle}</h2>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          {w.pctOfSales}
        </span>
      </div>
      {view.top.map((row) => (
        <Link
          key={row.id}
          href={dishHrefOf(row)}
          title={w.openDish}
          className="flex items-center gap-2 border-t border-[#f2f3f6] py-1.5 text-[13px] first:mt-1 hover:bg-[#f7f9ff]"
        >
          <span className="w-[190px] shrink-0 truncate">{row.name}</span>
          <span className="h-2.5 flex-1 rounded-full bg-[#eef0f4]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(row.share / max) * 100}%`, background: BLUE }}
            />
          </span>
          <b className="w-[52px] text-right tabular-nums">{pctOf(row.share)}</b>
          <span className="w-[84px] text-right">
            <MarginChip d={row} />
          </span>
        </Link>
      ))}
      <p className="mt-1 text-[12px] text-[#8a92a3]">
        {fmt(w.topSummary, {
          n: view.top.length,
          pct: pctOf(view.top_share),
        })}
      </p>
    </section>
  );
}

/** A dish opens in Platos (its first variant's product). */
function dishHrefOf(d: DishRow): string {
  return d.product_id !== null ? dishHref(d.product_id) : platosHref();
}

function MarginCard({
  kind,
  view,
  money,
}: {
  kind: "best" | "worst";
  view: ResumenView;
  money: (n: number, d?: number) => string;
}) {
  const { d, fmt } = useT();
  const w = d.menu.workspace.resumen;
  const r = view.ranking;
  const list = kind === "best" ? r.best : r.worst;
  const title = kind === "best" ? w.bestMargin : w.worstMargin;
  const missingLink =
    kind === "best"
      ? {
          href: ingredientesHref("falta_precio"),
          text:
            view.counts.falta_precio.dishes > 0
              ? w.completePrices
              : w.reviewCosts,
        }
      : view.counts.sin_receta.dishes > 0
        ? {
            href: platosHref(["sin_receta"]),
            text: fmt(w.seeNoRecipe, { n: view.counts.sin_receta.dishes }),
          }
        : {
            href: platosHref(["falta_precio"]),
            text: w.seeNoPrice,
          };
  const topNames = new Set(view.top.map((row) => row.id));
  const flagged =
    kind === "worst"
      ? list.find((row) => row.id !== null && topNames.has(row.id))
      : undefined;
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid={`menu-resumen-${kind}`}
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">{title}</h2>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          {fmt(w.marginOf, { costed: r.costed, total: r.total })}
        </span>
      </div>
      <div
        className="my-1.5 h-1.5 rounded-full bg-[#eef0f4]"
        aria-label={fmt(w.coverageAria, { pct: Math.round(r.coverage * 100) })}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(r.costed > 0 ? 2 : 0, r.coverage * 100)}%`,
            background: BLUE,
          }}
        />
      </div>
      {!r.enough ? (
        <div className="rounded-[10px] border border-dashed border-[#d5dae3] px-2.5 py-2 text-[12.5px] text-[#6b7385]">
          {fmt(w.noRanking, { min: MIN })}
          <br />
          <Link
            href={missingLink.href}
            className="font-semibold text-[#1b40c8] hover:underline"
          >
            {missingLink.text}
          </Link>
        </div>
      ) : (
        <>
          {list.map((row) => (
            <RankRow
              key={row.id ?? row.name}
              d={row}
              money={money}
              tone={kind === "best" ? "good" : "bad"}
            />
          ))}
          {flagged ? (
            <p className="mt-1 text-[12px] text-[#8a92a3]">
              {fmt(w.flagged, { name: flagged.name })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

const MIN = 3;

function RankRow({
  d,
  money,
  tone,
}: {
  d: RankedDish;
  money: (n: number, d?: number) => string;
  tone: "good" | "bad";
}) {
  const { d: dict, fmt } = useT();
  return (
    <div className="flex items-center gap-2 border-t border-[#f2f3f6] py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">
        {d.name}
        {d.ai ? <IaChip /> : null}
      </span>
      <span className="text-[12px] text-[#8a92a3]">
        {fmt(dict.menu.workspace.resumen.salesSuffix, {
          amount: money(d.net_sales),
        })}
      </span>
      <b
        className={
          "w-12 text-right tabular-nums " +
          (tone === "good" ? "text-[#1f9d55]" : "text-[#d14343]")
        }
      >
        {Math.round(d.margin_pct)}%
      </b>
    </div>
  );
}

function ageText(
  createdAt: string | null,
  now: number,
  w: { ageToday: string; ageOne: string; ageMany: string },
  fmt: (template: string, vars: Record<string, string | number>) => string
): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0
    ? w.ageToday
    : days === 1
      ? w.ageOne
      : fmt(w.ageMany, { n: days });
}

function Pendientes({
  view,
  missing,
  latestUpload,
  now,
}: {
  view: ResumenView;
  missing: number;
  latestUpload: { filename: string; created_at: string | null } | null;
  now: number;
}) {
  const { d, fmt } = useT();
  const w = d.menu.workspace.resumen;
  const sharePct = (n: number) => fmt(w.sharePct, { pct: Math.round(n * 100) });
  const items: Array<{
    key: string;
    count: number;
    label: string;
    sub: string;
    href: string;
  }> = [];
  if (missing > 0 || view.counts.falta_precio.dishes > 0)
    items.push({
      key: "precios",
      count: missing,
      label: missing === 1 ? w.ingredientNoPriceOne : w.ingredientNoPriceMany,
      sub: fmt(
        view.counts.falta_precio.dishes === 1 ? w.affectsOne : w.affectsMany,
        {
          n: view.counts.falta_precio.dishes,
          share: sharePct(view.counts.falta_precio.share),
        }
      ),
      href: ingredientesHref("falta_precio"),
    });
  if (view.counts.sin_receta.dishes > 0)
    items.push({
      key: "receta",
      count: view.counts.sin_receta.dishes,
      label: w.dishesNoRecipe,
      sub: sharePct(view.counts.sin_receta.share),
      href: platosHref(["sin_receta"]),
    });
  if (view.counts.estimado.dishes > 0)
    items.push({
      key: "ia",
      count: view.counts.estimado.dishes,
      label: w.aiCosts,
      sub: fmt(w.aiSub, { share: sharePct(view.counts.estimado.share) }),
      href: platosHref(["estimado"]),
    });
  const age = ageText(latestUpload?.created_at ?? null, now, w, fmt);
  const complete = items.length === 0;
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid="menu-resumen-pendientes"
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">{w.pendingTitle}</h2>
        {!complete ? (
          <span className="ml-auto text-[12px] text-[#8a92a3]">
            {items.length}
          </span>
        ) : null}
      </div>
      {complete ? (
        <div className="flex gap-2.5 border-t border-[#f2f3f6] py-2 text-[13px]">
          <b className="w-[26px] text-[#1b40c8]">✓</b>
          <div>
            {w.menuComplete}
            <div className="text-[12px] text-[#8a92a3]">{w.costsUpToDate}</div>
          </div>
        </div>
      ) : (
        items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className="flex gap-2.5 border-t border-[#f2f3f6] py-2 text-[13px] first:mt-1 hover:bg-[#f7f9ff]"
          >
            <b className="min-w-[26px] text-[#1b40c8]">{it.count}</b>
            <div>
              {it.label}
              <div className="text-[12px] text-[#8a92a3]">{it.sub}</div>
            </div>
          </Link>
        ))
      )}
      <div className="flex gap-2.5 border-t border-[#f2f3f6] py-2 text-[13px]">
        <b className="w-[26px] text-[#1b40c8]">↑</b>
        <div>
          {w.uploadLatest}
          <div className="text-[12px] text-[#8a92a3]">
            {latestUpload
              ? age
                ? `${age} · ${latestUpload.filename}`
                : fmt(w.lastFile, { filename: latestUpload.filename })
              : w.noFile}
          </div>
        </div>
      </div>
      <Link
        href={costsTabHref("precios")}
        className="mt-2 inline-flex rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
      >
        {w.goCosts}
      </Link>
    </section>
  );
}
