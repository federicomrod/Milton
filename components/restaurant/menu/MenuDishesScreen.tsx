"use client";

// Menú › Platos (R1-10, mock 2): one row per menu dish (its POS variants
// grouped), with sales, margin, cost %, coverage and Estado. Variants
// collapse under the dish by size. "Mover variante a otro plato" and
// "Excluir plato" save at once and are undone on screen if the save fails.
// Every number comes from the shared loader; the screen only re-adds the
// sums after a move (dishSums, the loader's own function).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { RowActions } from "@/components/restaurant/groups/RowActions";
import {
  useEventCallback,
  useProgressiveCount,
} from "@/components/restaurant/groups/use-progressive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  dishSums,
  moveVariantAcross,
  type MenuDish,
  type MenuDishVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";
import {
  DISH_STATUS_LABELS,
  type DishStatus,
} from "@/lib/restaurant/costing/dish-status";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { platosHref } from "@/lib/restaurant/menu-links";
import { Chip } from "@/components/restaurant/recipes-costing/ui";
import Link from "next/link";
import { StickyPanel, STICKY_TH } from "@/components/restaurant/ui/StickyPanel";
import { SortTh } from "@/components/restaurant/sort/SortTh";
import { useTableSort } from "@/components/restaurant/sort/use-table-sort";
import { sortRows, type SortValue } from "@/lib/restaurant/table-sort";
import { DrillErrorBoundary } from "@/components/restaurant/menu/DrillErrorBoundary";
import { DrillView } from "@/components/restaurant/menu/DrillView";
import { ProductosView } from "@/components/restaurant/groups/ProductosView";
import { useItemGroups } from "@/components/restaurant/groups/use-item-groups";

const TONE: Record<DishStatus, "ok" | "pur" | "warn" | "grey"> = {
  aprobado: "ok",
  estimado: "pur",
  falta_precio: "warn",
  sin_receta: "grey",
};

const EXCLUDED_LABELS: Record<string, string> = {
  bebida: "Bebida",
  extra: "Extra",
  empleados: "Empleados",
  descuento: "Descuento",
  excluido: "Excluido",
  excluido_a_mano: "Excluido",
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/restaurant/menu-dishes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    menu_dish_id?: string;
  };
  if (!res.ok) throw new Error(json.error ?? "No pude guardar el cambio.");
  return json;
}

const SCOPE_LABELS = {
  restaurante: "ventas del restaurante con su propio vínculo",
  compartido: "ventas con el vínculo compartido",
  sin_vinculo: "ventas de un restaurante sin vínculo: sin costo",
} as const;

/** A variant's name; a restaurant part says whose link costs it. */
function variantTitle(v: MenuDishVariant): string {
  return v.sales_scope
    ? `${v.name} (${SCOPE_LABELS[v.sales_scope.kind]})`
    : v.name;
}

/** One row per POS product (its restaurant parts move together). */
function uniqueProducts(variants: readonly MenuDishVariant[]) {
  const seen = new Set<number>();
  return variants.filter((v) =>
    seen.has(v.odoo_product_id) ? false : (seen.add(v.odoo_product_id), true)
  );
}

const STATUS_RANK: Record<DishStatus, number> = {
  sin_receta: 0,
  falta_precio: 1,
  estimado: 2,
  aprobado: 3,
};

/** What each Platos column sorts by; a missing price is null (last both ways). */
function dishValue(d: MenuDish, key: string): SortValue {
  const excluded = d.status === "excluded";
  switch (key) {
    case "name":
      return d.name;
    case "sales":
      return d.net_sales;
    case "margin":
      return d.margin_pct;
    case "cost":
      return d.food_cost_pct;
    case "coverage":
      return excluded ? null : d.coverage;
    case "status":
      return excluded ? null : STATUS_RANK[d.cost_status];
    default:
      return null;
  }
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);

export function MenuDishesScreen({
  data,
  onOpenDish,
  statusFilter = [],
}: {
  data: RecipeCostingWorkspace;
  /** Open the dish's recipe (its base variant) in the editor. */
  onOpenDish: (odooProductId: number) => void;
  statusFilter?: readonly string[];
}) {
  const menu = data.menu_dishes;
  const [dishes, setDishes] = useState<MenuDish[]>(menu?.dishes ?? []);
  const [excluded, setExcluded] = useState<MenuDish[]>(menu?.excluded ?? []);
  const [showExcluded, setShowExcluded] = useState(false);
  const { sort, toggle: toggleSort } = useTableSort("platos");
  // Indicators: the person can hide them (remembered for the session) and
  // they fold away by themselves once the page has scrolled past them.
  const [kpiUserHidden, setKpiUserHidden] = useState(false);
  const [kpiScrolled, setKpiScrolled] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("milton:menu:kpis-hidden") === "1")
        queueMicrotask(() => setKpiUserHidden(true));
    } catch {
      // No storage: indicators stay visible.
    }
    const onScroll = () =>
      setKpiScrolled((was) =>
        was ? window.scrollY > 8 : window.scrollY > 200
      );
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const kpiHidden = kpiUserHidden || kpiScrolled;
  const toggleKpis = () =>
    setKpiUserHidden((was) => {
      try {
        window.sessionStorage.setItem(
          "milton:menu:kpis-hidden",
          was ? "0" : "1"
        );
      } catch {
        // ignore
      }
      return !was;
    });
  // Opening a Desglose remembers where the person was in the list, so
  // coming back lands on the same row with the same filter and search (the
  // list stays mounted underneath).
  const scrollBefore = useRef(0);
  const [drill, setDrillState] = useState<
    | { kind: "dish"; id: string }
    | { kind: "group"; name: string; keys: string[] }
    | null
  >(null);

  const setDrill = useCallback(
    (
      next:
        | { kind: "dish"; id: string }
        | { kind: "group"; name: string; keys: string[] }
        | null
    ) => {
      if (next) {
        scrollBefore.current = window.scrollY;
        window.scrollTo({ top: 0 });
      } else {
        const y = scrollBefore.current;
        requestAnimationFrame(() => window.scrollTo({ top: y }));
      }
      setDrillState(next);
    },
    []
  );
  /** The list the person opened it from. */
  const [drillFrom, setDrillFrom] = useState<"platos" | "productos">("platos");
  const [view, setView] = useState<"platos" | "productos">("platos");
  const grouping = useItemGroups(data.item_groups);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<{
    dish: MenuDish;
    variant: MenuDishVariant | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = useCallback(
    (n: number) => formatMoneyEs(n, data.currency, { decimals: 0 }),
    [data.currency]
  );

  // The lists are this screen's own after the first load: moves and
  // exclusions apply here at once (the page remounts on navigation).

  // Opening Platos never writes. Milton's grouping is saved after a
  // recipe import, or here with "Guardar agrupación" when new products
  // arrived (only those are written).
  const [unsaved, setUnsaved] = useState(menu?.unsaved_variant_count ?? 0);
  const [saving, setSaving] = useState(false);
  async function saveGrouping() {
    setSaving(true);
    setError(null);
    try {
      await post({ action: "sync" });
      setUnsaved(0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pude guardar la agrupación."
      );
    } finally {
      setSaving(false);
    }
  }

  const shown = useMemo(() => {
    const list = showExcluded ? [...dishes, ...excluded] : dishes;
    const filtered =
      statusFilter.length === 0
        ? list
        : list.filter((d) => statusFilter.includes(d.cost_status));
    // Variants stay under their dish: only the dishes are ordered.
    return sortRows(filtered, sort, dishValue);
  }, [dishes, excluded, showExcluded, statusFilter, sort]);

  const openDrill = (
    target:
      | { kind: "dish"; id: string }
      | { kind: "group"; name: string; keys: string[] }
  ) => {
    setDrillFrom(view);
    setDrill(target);
  };
  // Stable handlers, so the 100+ dish rows do not re-render on every change.
  const onToggleRow = useEventCallback((id: string) => toggle(id));
  const onDrillRow = useEventCallback((id: string) =>
    openDrill({ kind: "dish", id })
  );
  const onOpenRow = useEventCallback((dish: MenuDish) => {
    if (dish.base_odoo_product_id != null)
      onOpenDish(dish.base_odoo_product_id);
  });
  const onMoveRow = useEventCallback(
    (dish: MenuDish, variant: MenuDishVariant | null) =>
      setMoving({ dish, variant })
  );
  const onExcludeRow = useEventCallback(
    (dish: MenuDish, exclude: boolean) => void setDishExcluded(dish, exclude)
  );
  const visibleRows = useProgressiveCount(
    shown.length,
    `${showExcluded}|${statusFilter.join(",")}|${sort?.key}|${sort?.dir}`
  );
  /** The variants of the group being drilled (follows moves made meanwhile). */
  const drillVariants = useMemo(() => {
    if (drill?.kind !== "group") return [];
    const wanted = new Set(drill.keys);
    return [...dishes, ...excluded]
      .flatMap((d) => d.variants)
      .filter((v) => wanted.has(v.key));
  }, [drill, dishes, excluded]);

  if (!menu) return null;
  const k = menu.kpis;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function move(variant: MenuDishVariant, target: MenuDish | string) {
    const before = { dishes, excluded };
    const targetId = typeof target === "string" ? `nuevo:${target}` : target.id;
    setError(null);
    setMoving(null);
    const moved = moveVariantAcross(
      dishes,
      excluded,
      variant.odoo_product_id,
      targetId,
      typeof target === "string" ? target : undefined
    );
    setDishes(moved.dishes);
    setExcluded(moved.excluded);
    try {
      const saved = await post({
        action: "move",
        odoo_product_id: variant.odoo_product_id,
        odoo_name: variant.name,
        menu_dish_id: typeof target === "string" ? null : target.id,
        dish_name: typeof target === "string" ? target : target.name,
      });
      if (saved.menu_dish_id && saved.menu_dish_id !== targetId) {
        setDishes((prev) =>
          prev.map((d) =>
            d.id === targetId
              ? { ...d, id: saved.menu_dish_id!, stored: true }
              : d
          )
        );
      }
    } catch (err) {
      setDishes(before.dishes);
      setExcluded(before.excluded);
      setError(
        err instanceof Error ? err.message : "No pude mover la variante."
      );
    }
  }

  /** Productos view: add products to a dish with the same move, all in one render. */
  async function addProductsToDish(productIds: number[], dish: MenuDish) {
    const before = { dishes, excluded };
    const all = [...dishes, ...excluded].flatMap((d) => d.variants);
    const variants = productIds
      .map((id) => all.find((v) => v.odoo_product_id === id))
      .filter((v): v is MenuDishVariant => !!v);
    let nextDishes = dishes;
    let nextExcluded = excluded;
    for (const v of variants) {
      const moved = moveVariantAcross(
        nextDishes,
        nextExcluded,
        v.odoo_product_id,
        dish.id
      );
      nextDishes = moved.dishes;
      nextExcluded = moved.excluded;
    }
    setError(null);
    setDishes(nextDishes);
    setExcluded(nextExcluded);
    try {
      for (const v of variants) {
        await post({
          action: "move",
          odoo_product_id: v.odoo_product_id,
          odoo_name: v.name,
          menu_dish_id: dish.id,
          dish_name: dish.name,
        });
      }
    } catch (err) {
      setDishes(before.dishes);
      setExcluded(before.excluded);
      setError(
        err instanceof Error ? err.message : "No pude mover los productos."
      );
    }
  }

  async function setDishExcluded(dish: MenuDish, exclude: boolean) {
    const before = { dishes, excluded };
    setError(null);
    if (exclude) {
      setDishes((prev) => prev.filter((d) => d.id !== dish.id));
      setExcluded((prev) => [
        ...prev,
        {
          ...dish,
          status: "excluded" as const,
          excluded_reason: "excluido_a_mano",
        },
      ]);
    } else {
      setExcluded((prev) => prev.filter((d) => d.id !== dish.id));
      setDishes((prev) =>
        [
          ...prev,
          { ...dish, status: "confirmed" as const, excluded_reason: null },
        ].sort((a, b) => b.net_sales - a.net_sales)
      );
    }
    try {
      await post({
        action: "exclude",
        dish_name: dish.name,
        menu_dish_id: dish.id,
        excluded: exclude,
        variants: dish.variants.map((v) => ({
          odoo_product_id: v.odoo_product_id,
          odoo_name: v.name,
        })),
      });
    } catch (err) {
      setDishes(before.dishes);
      setExcluded(before.excluded);
      setError(
        err instanceof Error ? err.message : "No pude guardar el cambio."
      );
    }
  }

  const controlsRow = (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Vista"
        className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
      >
        {(["platos", "productos"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={
              "rounded-[9px] px-3.5 py-1.5 " +
              (view === v
                ? "bg-[#1b40c8] text-white shadow-sm"
                : "text-[#4a5a85] hover:text-[#1b40c8]")
            }
          >
            {v === "platos" ? "Platos" : "Productos"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={toggleKpis}
        className="rounded-md px-2 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb]"
        aria-pressed={kpiUserHidden}
      >
        {kpiUserHidden ? "Mostrar indicadores" : "Ocultar indicadores"}
      </button>
    </div>
  );

  const drillDish =
    drill?.kind === "dish"
      ? ([...dishes, ...excluded].find((d) => d.id === drill.id) ?? null)
      : null;
  const drilling = drillDish
    ? {
        title: drillDish.name,
        variants: drillDish.variants,
        scopeId: drillDish.id as string | null,
        recipe: drillDish.base_odoo_product_id,
      }
    : drill?.kind === "group"
      ? {
          title: drill.name,
          variants: drillVariants,
          scopeId: null as string | null,
          recipe: null,
        }
      : null;

  return (
    <>
      {drilling ? (
        <DrillErrorBoundary
          title={drilling.title}
          onBack={() => setDrill(null)}
        >
          <DrillView
            title={drilling.title}
            variants={drilling.variants}
            scopeId={drilling.scopeId}
            menuSales={dishes.reduce((sum, d) => sum + d.net_sales, 0)}
            grouping={grouping}
            canEdit={data.actor.can_submit}
            money={money}
            onBack={() => setDrill(null)}
            backLabel={drillFrom === "productos" ? "Productos" : "Platos"}
            restaurants={data.restaurants}
            showRestaurants={
              (data.restaurants?.length ?? 0) > 1 && !data.view_location_id
            }
            onOpenRecipe={
              drilling.recipe != null
                ? () => onOpenDish(drilling.recipe!)
                : undefined
            }
          />
        </DrillErrorBoundary>
      ) : null}
      {/* Kept mounted while drilling, so coming back is instant and keeps the filter and search. */}
      <div className="space-y-[14px]" hidden={!!drilling}>
        <div
          className={
            "overflow-hidden transition-[max-height,opacity] duration-200 " +
            (kpiHidden ? "max-h-0 opacity-0" : "max-h-48 opacity-100")
          }
          aria-hidden={kpiHidden}
        >
          <div className="grid grid-cols-4 gap-3">
            <Kpi
              label="Costo de comida"
              value={
                k.food_cost_pct !== null ? pct(k.food_cost_pct) : "Sin precio"
              }
              sub="sobre ventas con costo"
              href={platosHref(["aprobado"])}
            />
            <Kpi
              label="Margen bruto"
              value={k.gross_margin !== null ? money(k.gross_margin) : "—"}
              sub={data.period_label ?? "ventas con costo"}
              href={platosHref(["aprobado"])}
            />
            <Kpi
              label="Ventas con costo"
              value={`${Math.round(k.coverage_pct)}%`}
              sub={`${k.covered_dishes} de ${k.dish_count} platos`}
              href={platosHref()}
            />
            <Kpi
              label="Platos con problema"
              value={String(k.problem_count)}
              sub={`${k.missing_price_dishes} sin precio · ${k.no_recipe_dishes} sin receta`}
              href={platosHref(["falta_precio", "sin_receta"])}
              alert={k.problem_count > 0}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[13px]">
          <span
            className="rounded-md bg-[#f1f3f7] px-2 py-0.5 text-[12px] font-semibold text-[#5b6476]"
            title={
              menu.stored
                ? "Milton agrupó los productos del POS en platos del menú. Corrige con ⋯ › Mover variante."
                : "Agrupación de Milton en pantalla. Para guardar cambios falta aplicar la migración 045 en este ambiente."
            }
          >
            ✦ Agrupado por Milton ·{" "}
            {menu.variant_count + menu.excluded_variant_count} productos →{" "}
            {dishes.length} platos
          </span>
          {menu.stored && unsaved > 0 ? (
            <button
              type="button"
              onClick={() => void saveGrouping()}
              disabled={saving}
              className="font-semibold text-[#3557c9] disabled:opacity-60"
              title="Productos nuevos del POS que Milton agrupó y todavía no están guardados."
            >
              {saving
                ? "Guardando…"
                : `Guardar agrupación (${unsaved} ${unsaved === 1 ? "producto nuevo" : "productos nuevos"})`}
            </button>
          ) : null}
          {statusFilter.length > 0 ? (
            <Link href={platosHref()} className="font-semibold text-[#3557c9]">
              Ver todos
            </Link>
          ) : null}
          <label className="ml-auto inline-flex items-center gap-1.5 text-[#5b6476]">
            <input
              type="checkbox"
              checked={showExcluded}
              onChange={(e) => setShowExcluded(e.target.checked)}
            />
            Mostrar excluidos ({menu.excluded_variant_count})
          </label>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        {view === "platos" ? <StickyPanel>{controlsRow}</StickyPanel> : null}

        {view === "productos" ? (
          <ProductosView
            dishes={dishes}
            excluded={excluded}
            grouping={grouping}
            canEdit={data.actor.can_submit}
            money={money}
            onAddToDish={addProductsToDish}
            onDrillDish={(id) => openDrill({ kind: "dish", id })}
            onDrillGroup={(name, keys) =>
              openDrill({ kind: "group", name, keys })
            }
            onOpenRecipe={onOpenDish}
            restaurants={data.restaurants}
            viewLocationId={data.view_location_id}
            leading={controlsRow}
          />
        ) : null}

        {view === "platos" && moving ? (
          <MovePanel
            moving={moving}
            dishes={dishes}
            onCancel={() => setMoving(null)}
            onMove={(variant, target) => void move(variant, target)}
            onPickVariant={(variant) => setMoving({ ...moving, variant })}
          />
        ) : null}

        {view === "platos" ? (
          <section className="rounded-[14px] border border-[#dbe3f7] bg-white px-3 py-1.5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#dbe3f7] bg-[#f3f6fd] text-left text-[12px] font-semibold text-[#4a5a85]">
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="name"
                    sort={sort}
                    onSort={toggleSort}
                  >
                    Plato del menú
                  </SortTh>
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="sales"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  >
                    Ventas
                  </SortTh>
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="margin"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  >
                    Margen
                  </SortTh>
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="cost"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  >
                    Costo %
                  </SortTh>
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="coverage"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  >
                    Cobertura
                  </SortTh>
                  <SortTh
                    className={"px-2 py-1.5 " + STICKY_TH}
                    sortKey="status"
                    sort={sort}
                    onSort={toggleSort}
                  >
                    Estado
                  </SortTh>
                  <th className={"w-8 " + STICKY_TH} />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, visibleRows).map((dish) => (
                  <DishRows
                    key={dish.id}
                    dish={dish}
                    open={expanded.has(dish.id)}
                    money={money}
                    canEdit={data.actor.can_submit}
                    onToggle={onToggleRow}
                    onDrill={onDrillRow}
                    onOpen={onOpenRow}
                    onMove={onMoveRow}
                    onExclude={onExcludeRow}
                  />
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-[#5b6476]">
                      No hay platos con ese filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <p className="px-2 py-2 text-[12px] text-[#8a92a3]">
              Doble clic en un plato para ver su desglose por tamaño,
              acompañante, punto y canal
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  href,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px] hover:border-[#f28c28]"
    >
      <div className="text-[12px] text-[#6b7385]">{label}</div>
      <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
        {value}
      </div>
      <div
        className={
          "mt-0.5 text-[12px] " + (alert ? "text-[#d14343]" : "text-[#8a92a3]")
        }
      >
        {sub}
      </div>
    </Link>
  );
}

/** Variants by size ("6 oz · 14 variantes"), sums only. */
function bySize(variants: readonly MenuDishVariant[]) {
  const groups = new Map<string, MenuDishVariant[]>();
  for (const v of variants) {
    const key =
      v.size !== null
        ? `${v.size} ${v.size_unit === "personas" ? "personas" : "oz"}`
        : "Sin tamaño";
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.entries()]
    .map(([label, list]) => ({ label, list, sums: dishSums(list) }))
    .sort((a, b) => b.sums.net_sales - a.sums.net_sales);
}

/** ⋯ built only when first used: 100+ rows do not each carry a menu. */
function RowMenu({
  isExcluded,
  onMove,
  onExclude,
}: {
  isExcluded: boolean;
  onMove: () => void;
  onExclude: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const trigger = (
    <button
      type="button"
      aria-label="Más acciones"
      onClick={armed ? undefined : () => setArmed(true)}
      className="rounded-md p-1 text-[#6b7385] hover:bg-[#e6ecfb]"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
  if (!armed) return trigger;
  return (
    <DropdownMenu defaultOpen onOpenChange={(o) => !o && setArmed(false)}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={onMove}>
          Mover variante a otro plato
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExclude}>
          {isExcluded ? "Volver a incluir" : "Excluir plato"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DishRows = memo(function DishRows({
  dish,
  open,
  money,
  canEdit,
  onToggle,
  onDrill,
  onOpen,
  onMove,
  onExclude,
}: {
  dish: MenuDish;
  open: boolean;
  money: (n: number) => string;
  canEdit: boolean;
  onToggle: (id: string) => void;
  onDrill: (id: string) => void;
  onOpen: (dish: MenuDish) => void;
  onMove: (dish: MenuDish, variant: MenuDishVariant | null) => void;
  onExclude: (dish: MenuDish, exclude: boolean) => void;
}) {
  const isExcluded = dish.status === "excluded";
  const coverage = Math.round(dish.coverage * 100);
  return (
    <>
      <tr
        className={
          "group/row border-b border-[#f2f3f6] hover:bg-[#f5f8ff] " +
          (isExcluded ? "text-[#8a92a3]" : "")
        }
        onDoubleClick={() => onDrill(dish.id)}
      >
        <td className="px-2 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggle(dish.id)}
              className="text-[#1b40c8]"
              aria-label={open ? "Ocultar variantes" : "Ver variantes"}
            >
              {open ? "▾" : "▸"}
            </button>
            <button
              type="button"
              onClick={() => onDrill(dish.id)}
              className="font-bold text-[#151c2c] hover:text-[#1b40c8] hover:underline"
              title="Ver el desglose del plato"
            >
              {dish.name}
            </button>
            <span className="text-[12px] text-[#8a92a3]">
              {dish.variants.length}{" "}
              {dish.variants.length === 1 ? "variante" : "variantes"}
            </span>
            <span className="pl-1">
              <RowActions
                onDrill={() => onDrill(dish.id)}
                onRecipe={
                  !isExcluded && dish.base_odoo_product_id != null
                    ? () => onOpen(dish)
                    : undefined
                }
              />
            </span>
          </div>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {money(dish.net_sales)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {pct(dish.margin_pct)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {pct(dish.food_cost_pct)}
        </td>
        <td className="px-2 py-2 text-right">
          {isExcluded ? (
            "—"
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-2 w-[70px] overflow-hidden rounded bg-[#eef0f4] align-middle">
                <i
                  className="block h-full bg-[#1f9d55]"
                  style={{ width: `${coverage}%` }}
                />
              </span>
              <span className="w-9 text-right tabular-nums">{coverage}%</span>
            </span>
          )}
        </td>
        <td className="px-2 py-2">
          {isExcluded ? (
            <Chip tone="grey">
              {EXCLUDED_LABELS[dish.excluded_reason ?? ""] ?? "Excluido"}
            </Chip>
          ) : (
            <Chip tone={TONE[dish.cost_status]}>
              {DISH_STATUS_LABELS[dish.cost_status]}
            </Chip>
          )}
        </td>
        <td className="px-1 py-2 text-right">
          {canEdit ? (
            <RowMenu
              isExcluded={isExcluded}
              onMove={() => onMove(dish, null)}
              onExclude={() => onExclude(dish, !isExcluded)}
            />
          ) : null}
        </td>
      </tr>
      {open
        ? bySize(dish.variants).map((group) => (
            <tr
              key={`${dish.id}:${group.label}`}
              className="border-b border-[#f2f3f6] bg-[#fafbfc] text-[#4a5263]"
            >
              <td
                className="py-2 pl-[34px] pr-2"
                title={group.list.map(variantTitle).join("\n")}
              >
                {group.label} · {group.list.length}{" "}
                {group.list.length === 1 ? "variante" : "variantes"}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {money(group.sums.net_sales)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {pct(group.sums.margin_pct)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {pct(group.sums.food_cost_pct)}
              </td>
              <td colSpan={3} />
            </tr>
          ))
        : null}
    </>
  );
});

function MovePanel({
  moving,
  dishes,
  onCancel,
  onMove,
  onPickVariant,
}: {
  moving: { dish: MenuDish; variant: MenuDishVariant | null };
  dishes: readonly MenuDish[];
  onCancel: () => void;
  onMove: (variant: MenuDishVariant, target: MenuDish | string) => void;
  onPickVariant: (variant: MenuDishVariant) => void;
}) {
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const variant = moving.variant;
  return (
    <section className="space-y-2 rounded-[14px] border border-[#f5c98b] bg-[#fff8ec] px-4 py-3 text-[13px]">
      <div className="font-semibold">
        Mover una variante de {moving.dish.name}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Variante"
          value={variant?.odoo_product_id ?? ""}
          onChange={(e) => {
            const v = moving.dish.variants.find(
              (x) => x.odoo_product_id === Number(e.target.value)
            );
            if (v) onPickVariant(v);
          }}
          className="max-w-md rounded-md border border-[#d5dae3] bg-white px-2 py-1"
        >
          <option value="">Elige la variante…</option>
          {uniqueProducts(moving.dish.variants).map((v) => (
            <option key={v.odoo_product_id} value={v.odoo_product_id}>
              {v.name}
            </option>
          ))}
        </select>
        <span>a</span>
        <select
          aria-label="Plato"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-md border border-[#d5dae3] bg-white px-2 py-1"
        >
          <option value="">Elige el plato…</option>
          {dishes
            .filter((d) => d.id !== moving.dish.id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          <option value="__nuevo">Un plato nuevo…</option>
        </select>
        {target === "__nuevo" ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del plato"
            className="rounded-md border border-[#d5dae3] bg-white px-2 py-1"
          />
        ) : null}
        <button
          type="button"
          disabled={
            !variant || !target || (target === "__nuevo" && !newName.trim())
          }
          onClick={() => {
            if (!variant) return;
            const dest =
              target === "__nuevo"
                ? newName.trim()
                : dishes.find((d) => d.id === target);
            if (dest) onMove(variant, dest);
          }}
          className="rounded-lg bg-[#f28c28] px-3 py-1.5 font-semibold text-white disabled:opacity-45"
        >
          Mover
        </button>
        <button type="button" onClick={onCancel} className="text-[#5b6476]">
          Cancelar
        </button>
      </div>
    </section>
  );
}
