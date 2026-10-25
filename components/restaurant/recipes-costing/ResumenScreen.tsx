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
import { COSTS_HREF } from "@/lib/restaurant/navigation";
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

function IaChip() {
  return (
    <span
      title="Costo estimado por IA: revísalo en Platos"
      className="ml-1 rounded-md bg-[#f2ecff] px-1 py-px text-[10px] font-bold text-[#6b3fc9]"
    >
      IA
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
        <p className="text-[#c03535]">No pude cargar el resumen del menú.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 rounded-lg bg-[#1b40c8] px-3 py-1.5 text-[12.5px] font-semibold text-white"
        >
          Reintentar
        </button>
      </div>
    );
  return (
    <ResumenCockpit
      view={view}
      currency={data.currency}
      period={period}
      onPeriod={setPeriod}
      monthText={days?.last_day ? monthLabel(days.last_day) : "Mes"}
      missingPriceIngredients={summary.missing_price_ingredients}
      latestUpload={data.latest_upload}
      now={now}
      extraEstimated={extraEstimated}
      menuReader={
        <MenuReaderCard
          canEdit={canEditRecipes(data.actor)}
          noRecipeDishes={summary.dish_kpis?.no_recipe_dishes ?? null}
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
  const money = (n: number, d = 0) =>
    formatMoneyEs(n, currency, { decimals: d });
  return (
    <div className="space-y-3" data-testid="menu-resumen">
      <div
        role="group"
        aria-label="Rango"
        className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
      >
        {(
          [
            ["7d", "7 días"],
            ["month", monthText],
            ["90d", "90 días"],
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
            Todavía no hay ventas de platos en este rango.
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
      label: "Costo de comida",
      value:
        k.food_cost_pct !== null
          ? `${Math.round(k.food_cost_pct)}%`
          : "Sin precio",
      sub: allCosted
        ? "sobre el 100% de ventas"
        : `sobre ventas con costo · ${costed} de ${k.dish_count} platos`,
      href: platosHref(["aprobado"]),
    },
    {
      label: "Margen bruto",
      value:
        k.gross_margin !== null
          ? money(k.gross_margin, allCosted ? 0 : 2)
          : "—",
      sub: allCosted ? "en el rango" : "solo ventas con costo",
      href: platosHref(["aprobado"]),
    },
    {
      label: "Ventas con costo",
      value: `${Math.round(k.coverage_pct)}%`,
      sub: allCosted
        ? `${costed} de ${k.dish_count} platos`
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
          label: "Platos bajo objetivo",
          value: String(k.low_margin_count),
          sub: "margen < 60%",
          href: platosHref(["aprobado"]),
          tone: k.low_margin_count > 0 ? "bad" : undefined,
        }
      : {
          label: "Platos con problema",
          value: String(k.problem_count),
          sub: `de ${k.dish_count}`,
          href: platosHref(["falta_precio", "sin_receta"]),
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

function marginChip(d: DishRow) {
  const g = groupStatusDisplay(d);
  if (g.mixed && d.approved_margin_pct !== null) {
    return (
      <span
        className="inline-flex items-center"
        title={g.label}
        data-testid="margen-parcial"
      >
        <span className="rounded-md bg-[#eef2fd] px-1.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]">
          {Math.round(d.approved_margin_pct)}% · {d.approved_count} de{" "}
          {d.variant_count} tamaños
        </span>
      </span>
    );
  }
  if (d.margin_pct === null)
    return <span className="text-[12px] text-[#8a92a3]">margen —</span>;
  if (d.cost_status === "aprobado" || d.cost_status === "estimado") {
    return (
      <span className="inline-flex items-center">
        <span className="rounded-md bg-[#e7f6ee] px-1.5 py-0.5 text-[12px] font-semibold text-[#1f7a45]">
          {Math.round(d.margin_pct)}%
        </span>
        {d.cost_status === "estimado" ? <IaChip /> : null}
      </span>
    );
  }
  return <span className="text-[12px] text-[#8a92a3]">margen —</span>;
}

function TopPlatos({ view }: { view: ResumenView }) {
  const max = Math.max(...view.top.map((d) => d.share), 0.0001);
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid="menu-resumen-top"
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">Top platos por ventas</h2>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          % de ventas · clic para abrir el plato
        </span>
      </div>
      {view.top.map((d) => (
        <Link
          key={d.id}
          href={dishHrefOf(d)}
          className="flex items-center gap-2 border-t border-[#f2f3f6] py-1.5 text-[13px] first:mt-1 hover:bg-[#f7f9ff]"
        >
          <span className="w-[190px] shrink-0 truncate">{d.name}</span>
          <span className="h-2.5 flex-1 rounded-full bg-[#eef0f4]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(d.share / max) * 100}%`, background: BLUE }}
            />
          </span>
          <b className="w-[52px] text-right tabular-nums">{pctOf(d.share)}</b>
          <span className="w-[84px] text-right">{marginChip(d)}</span>
        </Link>
      ))}
      <p className="mt-1 text-[12px] text-[#8a92a3]">
        Top {view.top.length} = {pctOf(view.top_share)} de tus ventas
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
  const r = view.ranking;
  const list = kind === "best" ? r.best : r.worst;
  const title = kind === "best" ? "Mejor margen" : "Peor margen";
  const missingLink =
    kind === "best"
      ? {
          href: ingredientesHref("falta_precio"),
          text:
            view.counts.falta_precio.dishes > 0
              ? `Completa los precios en Costos →`
              : "Revisa tus costos →",
        }
      : view.counts.sin_receta.dishes > 0
        ? {
            href: platosHref(["sin_receta"]),
            text: `Ver ${view.counts.sin_receta.dishes} platos sin receta →`,
          }
        : {
            href: platosHref(["falta_precio"]),
            text: "Ver platos sin precio →",
          };
  const topNames = new Set(view.top.map((d) => d.id));
  const flagged =
    kind === "worst"
      ? list.find((d) => d.id !== null && topNames.has(d.id))
      : undefined;
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid={`menu-resumen-${kind}`}
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">{title}</h2>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          margen de {r.costed} de {r.total} platos
        </span>
      </div>
      <div
        className="my-1.5 h-1.5 rounded-full bg-[#eef0f4]"
        aria-label={`Cobertura ${Math.round(r.coverage * 100)}%`}
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
          {kind === "best"
            ? `Necesitas al menos ${MIN} platos con costo para ver el top ${MIN}. Hoy ${r.costed === 1 ? "solo hay 1" : `solo hay ${r.costed}`}.`
            : "Sin ranking hasta que haya más platos costeados. Los platos sin costo nunca cuentan como $0."}
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
          {list.map((d) => (
            <RankRow
              key={d.id ?? d.name}
              d={d}
              money={money}
              tone={kind === "best" ? "good" : "bad"}
            />
          ))}
          {flagged ? (
            <p className="mt-1 text-[12px] text-[#8a92a3]">
              {flagged.name} vende mucho con margen bajo → revisa precio
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
  return (
    <div className="flex items-center gap-2 border-t border-[#f2f3f6] py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">
        {d.name}
        {d.ai ? <IaChip /> : null}
      </span>
      <span className="text-[12px] text-[#8a92a3]">
        {money(d.net_sales)} ventas
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

function ageText(createdAt: string | null, now: number): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0 ? "Hoy" : days === 1 ? "Hace 1 día" : `Hace ${days} días`;
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
  const sharePct = (n: number) => `${Math.round(n * 100)}% de ventas`;
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
      label: missing === 1 ? "Precio por completar" : "Precios por completar",
      sub: `${Math.round(view.counts.falta_precio.share * 100)}% de ventas afectadas`,
      href: ingredientesHref("falta_precio"),
    });
  if (view.counts.sin_receta.dishes > 0)
    items.push({
      key: "receta",
      count: view.counts.sin_receta.dishes,
      label: "Platos sin receta",
      sub: sharePct(view.counts.sin_receta.share),
      href: platosHref(["sin_receta"]),
    });
  if (view.counts.estimado.dishes > 0)
    items.push({
      key: "ia",
      count: view.counts.estimado.dishes,
      label: "Costos estimados por IA",
      sub: `${sharePct(view.counts.estimado.share)} · revisa`,
      href: platosHref(["estimado"]),
    });
  const age = ageText(latestUpload?.created_at ?? null, now);
  const complete = items.length === 0;
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
      data-testid="menu-resumen-pendientes"
    >
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-bold">Pendientes</h2>
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
            Menú completo
            <div className="text-[12px] text-[#8a92a3]">Costos al día</div>
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
          Sube tus costos más recientes
          <div className="text-[12px] text-[#8a92a3]">
            {latestUpload
              ? age
                ? `${age} · ${latestUpload.filename}`
                : `Último: ${latestUpload.filename}`
              : "Aún no subes un archivo"}
          </div>
        </div>
      </div>
      <Link
        href={COSTS_HREF}
        className="mt-2 inline-flex rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
      >
        Ir a Costos →
      </Link>
    </section>
  );
}
