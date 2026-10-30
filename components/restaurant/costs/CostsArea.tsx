// components/restaurant/costs/CostsArea.tsx
//
// Costos (R1-09b, A9/D6): KPI row, the three real tabs and the
// "Cambios de precio" table (click a header to sort). The active tab comes
// from ?tab= on the page.

"use client";

import Link from "next/link";
import { SortTh } from "@/components/restaurant/sort/SortTh";
import { useTableSort } from "@/components/restaurant/sort/use-table-sort";
import { sortRows, type SortValue } from "@/lib/restaurant/table-sort";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { dishHref, ingredientHref } from "@/lib/restaurant/menu-links";
import { costsTabHref, type CostsTab } from "@/lib/restaurant/costs-tabs";
import { formatPct, formatUnitPrice } from "@/lib/restaurant/costs-format";
import type { IngredientPriceTrendRow } from "@/lib/restaurant/profitability-server";

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

export function CostsKpiCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  help,
  href,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone?: "neutral" | "bad" | "good";
  /** Tooltip text (no explanatory paragraphs on the page). */
  help?: string;
  /** Makes the whole card a link (e.g. «con facturas pendientes» → Compras). */
  href?: string;
}) {
  // Brand colours only: «needs a look» is Ink on an amarillo chip and «good»
  // is plain Ink.
  const alert = deltaTone === "bad";
  const toneClass = alert
    ? "inline-block rounded-full bg-[#FDE68A] px-2 py-0.5 font-semibold text-[#0F172A]"
    : deltaTone === "good"
      ? "text-[#0F172A]"
      : "text-[#6b7385]";
  const body = (
    <>
      <p className="text-[12px] font-medium text-[#6b7385]">{label}</p>
      <p className="mt-1 text-[28px] font-extrabold leading-tight tabular-nums text-[#151c2c]">
        {value}
      </p>
      <p className="mt-0.5">
        <span className={`text-[12px] ${toneClass}`}>{delta}</span>
      </p>
    </>
  );
  const box = "rounded-[14px] border border-[#dfe3ea] bg-white px-4 py-3.5";
  return href ? (
    <Link
      href={href}
      title={help}
      className={`block ${box} hover:border-[#1B40C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]`}
    >
      {body}
    </Link>
  ) : (
    <div className={box} title={help}>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS: Array<{ id: CostsTab; en: string; es: string; de: string }> = [
  {
    id: "costos-fijos",
    en: "Fixed costs",
    es: "Costos fijos",
    de: "Fixkosten",
  },
  {
    id: "precios",
    en: "Price changes",
    es: "Cambios de precio",
    de: "Preisänderungen",
  },
  { id: "compras", en: "Purchases", es: "Compras", de: "Einkäufe" },
  { id: "proveedores", en: "Suppliers", es: "Proveedores", de: "Lieferanten" },
];

export function CostsAreaTabs({
  active,
  lang,
  shellParams,
}: {
  active: CostsTab;
  lang: PreferredLanguage;
  /** location / from / to — ride along on every tab. */
  shellParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <nav
      aria-label={t(
        lang,
        "Cost sections",
        "Secciones de costos",
        "Kostenbereiche"
      )}
      className="flex flex-wrap gap-x-5 sm:gap-x-7 border-b border-[#dfe3ea]"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={costsTabHref(tab.id, shellParams)}
          aria-current={active === tab.id ? "page" : undefined}
          className={
            "-mb-px border-b-[3px] py-2 text-[15px] font-semibold " +
            (active === tab.id
              ? "border-[#1B40C8] text-[#151c2c]"
              : "border-transparent text-[#6b7385] hover:text-[#151c2c]")
          }
        >
          {t(lang, tab.en, tab.es, tab.de)}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Cambios de precio
// ---------------------------------------------------------------------------

function AffectsCell({
  trend,
  lang,
}: {
  trend: IngredientPriceTrendRow;
  lang: PreferredLanguage;
}) {
  const dishes = trend.affected_dishes;
  if (dishes === undefined || dishes.length === 0) return <>—</>;
  const names = dishes.map((d) => d.name).join(", ");
  if (dishes.length === 1) {
    return (
      <Link
        href={dishHref(dishes[0].odoo_product_id)}
        title={names}
        className="font-medium text-[#151c2c] hover:underline"
      >
        {t(lang, "Affects 1 dish", "Afecta 1 plato", "Betrifft 1 Gericht")}
      </Link>
    );
  }
  return (
    <Link
      href={ingredientHref(trend.ingredient_id)}
      title={names}
      className="font-medium text-[#151c2c] hover:underline"
    >
      {t(
        lang,
        `Affects ${dishes.length} dishes`,
        `Afecta ${dishes.length} platos`,
        `Betrifft ${dishes.length} Gerichte`
      )}
    </Link>
  );
}

function trendValue(trend: IngredientPriceTrendRow, key: string): SortValue {
  switch (key) {
    case "ingredient":
      return trend.ingredient_name;
    case "supplier":
      return trend.latest_supplier_name;
    case "before":
      return trend.previous_cost;
    case "now":
      return trend.latest_cost;
    case "change":
      return trend.pct_change;
    case "affects":
      return trend.affected_dishes?.length ?? null;
    default:
      return null;
  }
}

export function PriceChangesTable({
  trends,
  lang,
}: {
  trends: readonly IngredientPriceTrendRow[];
  lang: PreferredLanguage;
}) {
  const { sort, toggle } = useTableSort("costos-cambios-de-precio");
  const rows = sortRows(trends, sort, trendValue);
  if (trends.length === 0) {
    return (
      <p
        className="rounded-[14px] border border-[#dfe3ea] bg-white px-4 py-6 text-sm text-[#6b7385]"
        title={t(
          lang,
          "Shows up after two prices for the same ingredient.",
          "Aparece cuando un ingrediente tiene dos precios.",
          "Erscheint, sobald eine Zutat zwei Preise hat."
        )}
      >
        {t(
          lang,
          "No price changes yet.",
          "Aún no hay cambios de precio.",
          "Noch keine Preisänderungen."
        )}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-[#dfe3ea] bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-[#dfe3ea]">
          <tr className="text-left text-[12px] font-medium text-[#6b7385]">
            <SortTh
              sortKey="ingredient"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
            >
              {t(lang, "Ingredient", "Ingrediente", "Zutat")}
            </SortTh>
            <SortTh
              sortKey="supplier"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
            >
              {t(lang, "Supplier", "Proveedor", "Lieferant")}
            </SortTh>
            <SortTh
              sortKey="before"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
              align="right"
            >
              {t(lang, "Before", "Antes", "Vorher")}
            </SortTh>
            <SortTh
              sortKey="now"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
              align="right"
            >
              {t(lang, "Now", "Ahora", "Jetzt")}
            </SortTh>
            <SortTh
              sortKey="change"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
              align="right"
            >
              {t(lang, "Change", "Cambio", "Änderung")}
            </SortTh>
            <SortTh
              sortKey="affects"
              sort={sort}
              onSort={toggle}
              className="px-4 py-2.5 font-medium"
            >
              {t(lang, "Affects", "Afecta", "Betrifft")}
            </SortTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((trend) => (
            <tr
              key={trend.ingredient_id}
              className="border-b border-[#eef0f4] last:border-0"
            >
              <td className="px-4 py-2.5">
                <Link
                  href={ingredientHref(trend.ingredient_id)}
                  className="font-semibold text-[#151c2c] hover:underline"
                >
                  {trend.ingredient_name}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-[#6b7385]">
                {trend.latest_supplier_name ?? "—"}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums text-[#6b7385]"
                title={trend.previous_date}
              >
                {formatUnitPrice(
                  trend.previous_cost,
                  trend.unit,
                  trend.currency,
                  lang
                )}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums"
                title={trend.latest_date}
              >
                {formatUnitPrice(
                  trend.latest_cost,
                  trend.unit,
                  trend.currency,
                  lang
                )}
              </td>
              <td
                className={
                  "px-4 py-2.5 text-right tabular-nums font-semibold " +
                  (trend.pct_change > 0 ? "text-[#c2410c]" : "text-[#15803d]")
                }
              >
                {formatPct(trend.pct_change)}
              </td>
              <td className="px-4 py-2.5">
                <AffectsCell trend={trend} lang={lang} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
