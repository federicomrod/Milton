// components/restaurant/ProfitabilityCockpit.tsx
//
// Section building blocks for the cockpit's profitability views. The
// cockpit page composes these into tabs via CockpitTabs; nothing here
// owns the full page layout.
//
// Honesty rules (unchanged):
//   * Unknown costs render as "—" — never as 0.
//   * Coverage is always surfaced under the headline KPIs.
//   * Each margin-risk slice has an explicit threshold in its title.

import Link from "next/link";
import {
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Circle,
  BookOpen,
  Carrot,
  Upload,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ProfitabilityData,
  MenuMarginRow,
} from "@/lib/restaurant/profitability-server";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function makeFmt(currency: string) {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return {
    money: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
    money2: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    num: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
  };
}

function pct(n: number | null, digits = 1): string {
  return n !== null && Number.isFinite(n) ? n.toFixed(digits) + "%" : "—";
}

const STATUS_LABEL: Record<string, string> = {
  complete: "Complete",
  missing_recipe: "Missing recipe",
  missing_component_recipe: "Missing component recipe",
  missing_input_cost: "Missing ingredient cost",
  missing_unit_conversion: "Unit mismatch",
  circular_component_reference: "Circular reference",
  no_cost_entries: "No cost entries",
  inactive_recipe: "Inactive recipe",
};

function formatUnitCost(n: number, unit: string, currency: string): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return (
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(n) + ` / ${unit}`
  );
}

// ---------------------------------------------------------------------------
// Profitability KPIs
// ---------------------------------------------------------------------------

export function ProfitabilityKpisSection({
  data,
}: {
  data: ProfitabilityData;
}) {
  const fmt = makeFmt(data.kpis.currency);
  const { kpis } = data;
  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold">Profitability</h2>
        <Badge variant="outline" className="text-xs">
          Cost coverage: {pct(kpis.cost_coverage_pct)} of revenue
        </Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="Revenue"
          value={fmt.money.format(kpis.revenue_total)}
          sub={kpis.currency}
        />
        <Kpi
          label="Estimated COGS"
          value={fmt.money.format(kpis.estimated_cogs)}
          sub={`from ${pct(kpis.cost_coverage_pct, 0)} of revenue`}
        />
        <Kpi
          label="Gross Profit"
          value={
            kpis.revenue_with_known_cost > 0
              ? fmt.money.format(kpis.estimated_gross_profit)
              : "—"
          }
          sub={
            kpis.revenue_with_known_cost > 0
              ? "on covered revenue"
              : "no cost coverage"
          }
        />
        <Kpi
          label="Gross Margin"
          value={pct(kpis.estimated_gross_margin_pct)}
          sub="on covered revenue"
        />
        <Kpi
          label="Food Cost %"
          value={pct(kpis.food_cost_pct)}
          sub="cogs / covered revenue"
        />
        <Kpi
          label="Items w/ Issues"
          value={`${
            kpis.menu_items_with_issues + kpis.menu_items_without_recipe
          }`}
          sub={`${kpis.menu_items_without_recipe} no recipe · ${kpis.menu_items_with_issues} other`}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Margin numbers include only menu items with complete recipes and
        ingredient costs. Items with missing recipes or unit mismatches are
        excluded — see Margin Risk and Setup tabs.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Margin risk (4 cards)
// ---------------------------------------------------------------------------

export function MarginRiskSection({
  data,
  compact = false,
}: {
  data: ProfitabilityData;
  /** When true, only the two most actionable cards render (used on Overview). */
  compact?: boolean;
}) {
  const fmt = makeFmt(data.kpis.currency);
  const cards = (
    <>
      <RiskCard
        title="Low margin items"
        subtitle={`Gross margin below 60% · ${data.lowMargin.length} items`}
        icon={<TrendingDown className="h-4 w-4 text-amber-600" />}
        empty="No low-margin items below 60%."
      >
        {data.lowMargin.map((r) => (
          <RiskLine
            key={r.menu_item_id}
            title={r.name}
            detail={`${pct(r.cost.gross_margin_pct)} margin · ${fmt.money.format(r.revenue)} revenue`}
            trailing={pct(r.cost.gross_margin_pct)}
            trailingClass="text-amber-700 dark:text-amber-300"
          />
        ))}
      </RiskCard>

      <RiskCard
        title="High food cost items"
        subtitle={`Food cost above 35% · ${data.highFoodCost.length} items`}
        icon={<TrendingUp className="h-4 w-4 text-red-600" />}
        empty="No items with food cost above 35%."
      >
        {data.highFoodCost.map((r) => (
          <RiskLine
            key={r.menu_item_id}
            title={r.name}
            detail={`${pct(r.cost.food_cost_pct)} food cost · ${fmt.money.format(r.revenue)} revenue`}
            trailing={pct(r.cost.food_cost_pct)}
            trailingClass="text-red-700 dark:text-red-300"
          />
        ))}
      </RiskCard>

      {!compact && (
        <RiskCard
          title="High revenue, incomplete costing"
          subtitle={`Revenue but unknown cost · ${data.highRevenueIncomplete.length} items`}
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          empty="Every revenue-generating item has a complete cost."
        >
          {data.highRevenueIncomplete.map((r) => (
            <RiskLine
              key={r.menu_item_id}
              title={r.name}
              detail={`${fmt.money.format(r.revenue)} revenue · ${STATUS_LABEL[r.cost.status] ?? r.cost.status}`}
              trailing={fmt.money.format(r.revenue)}
              trailingClass="text-amber-700 dark:text-amber-300"
            />
          ))}
        </RiskCard>
      )}

      {!compact && (
        <RiskCard
          title="Missing recipe, high volume"
          subtitle={`No recipe but selling · ${data.missingRecipeHighVolume.length} items`}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          empty="Every selling menu item has at least a draft recipe."
        >
          {data.missingRecipeHighVolume.map((r) => (
            <RiskLine
              key={r.menu_item_id}
              title={r.name}
              detail={`${fmt.num.format(r.units_sold)} units · ${fmt.money.format(r.revenue)} revenue`}
              trailing={fmt.money.format(r.revenue)}
              trailingClass="text-red-700 dark:text-red-300"
            />
          ))}
        </RiskCard>
      )}
    </>
  );

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Margin risk</h2>
      <div
        className={
          "grid gap-4 " +
          (compact
            ? "grid-cols-1 md:grid-cols-2"
            : "grid-cols-1 lg:grid-cols-2")
        }
      >
        {cards}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Supplier trends
// ---------------------------------------------------------------------------

export function SupplierTrendsSection({ data }: { data: ProfitabilityData }) {
  const fmt = makeFmt(data.kpis.currency);
  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold">Supplier trends</h2>
        <span className="text-xs text-muted-foreground">
          Uses all available cost entries (not filtered by date)
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ingredient price changes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Ingredient price changes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.ingredientPriceTrends.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-3">
                No ingredients with at least two cost entries yet. Upload
                another cost file or add manual entries.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Ingredient</th>
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 font-medium text-right">
                        Previous
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Latest
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Change
                      </th>
                      <th className="px-3 py-2 font-medium">Latest date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ingredientPriceTrends.map((t, i) => (
                      <tr
                        key={t.ingredient_id}
                        className={
                          (i % 2 === 1 ? "bg-muted/20" : "bg-background") +
                          " border-b border-border last:border-0"
                        }
                      >
                        <td className="px-3 py-2 font-medium">
                          {t.ingredient_name}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.latest_supplier_name ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatUnitCost(t.previous_cost, t.unit, t.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatUnitCost(t.latest_cost, t.unit, t.currency)}
                        </td>
                        <td
                          className={
                            "px-3 py-2 text-right tabular-nums font-medium " +
                            (t.pct_change >= 0
                              ? "text-red-700 dark:text-red-300"
                              : "text-green-700 dark:text-green-300")
                          }
                        >
                          {t.pct_change >= 0 ? "+" : ""}
                          {t.pct_change.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.latest_date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top supplier spend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-orange-500" />
              Top supplier spend
              <span className="text-xs text-muted-foreground font-normal">
                · total {fmt.money.format(data.total_supplier_spend)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.topSupplierSpend.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-3">
                No supplier-tagged cost entries yet. Bulk-upload a cost file or
                pick a supplier when adding a manual cost entry.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 font-medium text-right">
                        Spend
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Share
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Ingredients
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topSupplierSpend.map((s, i) => (
                      <tr
                        key={s.supplier_id}
                        className={
                          (i % 2 === 1 ? "bg-muted/20" : "bg-background") +
                          " border-b border-border last:border-0"
                        }
                      >
                        <td className="px-3 py-2 font-medium">
                          <Link
                            href="/dashboard/restaurant/suppliers"
                            className="hover:underline"
                          >
                            {s.supplier_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt.money.format(s.total_spend)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-orange-500"
                                style={{
                                  width: `${Math.min(100, s.pct_of_total).toFixed(1)}%`,
                                }}
                              />
                            </div>
                            {pct(s.pct_of_total, 0)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.ingredient_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data quality checklist
// ---------------------------------------------------------------------------

export function DataQualityChecklistSection({
  data,
}: {
  data: ProfitabilityData;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Costing setup checklist</h2>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            <ChecklistItem
              count={data.dataQuality.unmapped_pos_items}
              doneCopy="All POS items mapped to menu items"
              problemCopy="POS items unmapped"
              href="/dashboard/restaurant/menu"
              hrefLabel="Open Menu & Recipes"
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.menu_items_without_recipe}
              doneCopy="Every menu item has a recipe"
              problemCopy="Menu items without a recipe"
              href="/dashboard/restaurant/menu"
              hrefLabel="Open Menu & Recipes"
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.recipes_with_unit_mismatch}
              doneCopy="No recipes blocked by unit mismatch"
              problemCopy="Recipes blocked by unit mismatch"
              href="/dashboard/restaurant/menu"
              hrefLabel="Fix recipes"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.ingredients_without_cost_entries}
              doneCopy="Every ingredient has at least one cost entry"
              problemCopy="Ingredients without any cost entry"
              href="/dashboard/restaurant/ingredients"
              hrefLabel="Open Ingredients"
              icon={<Carrot className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.components_without_recipe}
              doneCopy="Every prepared component has a recipe"
              problemCopy="Prepared components without a recipe"
              href="/dashboard/restaurant/menu"
              hrefLabel="Open Components"
              icon={<BookOpen className="h-4 w-4" />}
            />
            <li className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  Supplier-linked ingredients
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-medium tabular-nums">
                  {data.dataQuality.supplier_linked_ingredients}
                </span>
                <Link
                  href="/dashboard/restaurant/suppliers"
                  className="text-xs text-primary hover:underline"
                >
                  Open Suppliers ↗
                </Link>
              </div>
            </li>
            <li className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Upload className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  Import more cost data
                </span>
              </div>
              <Link
                href="/dashboard/restaurant/costs/upload"
                className="text-xs text-primary hover:underline shrink-0"
              >
                Open Import Costs ↗
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top issues (a small Overview-only widget)
// ---------------------------------------------------------------------------

/** Compact "items needing attention" list for the Overview tab. */
export function ItemsNeedingAttention({ data }: { data: ProfitabilityData }) {
  const fmt = makeFmt(data.kpis.currency);

  // Pick the 6 most impactful items: blend missing-recipe-high-volume and
  // high-revenue-incomplete and low-margin, prefer revenue desc.
  const seen = new Set<string>();
  const items: Array<{ row: MenuMarginRow; reason: string }> = [];
  const pushIf = (row: MenuMarginRow, reason: string) => {
    if (seen.has(row.menu_item_id) || items.length >= 6) return;
    seen.add(row.menu_item_id);
    items.push({ row, reason });
  };
  for (const r of data.missingRecipeHighVolume) pushIf(r, "no recipe");
  for (const r of data.highRevenueIncomplete) {
    pushIf(r, STATUS_LABEL[r.cost.status] ?? r.cost.status);
  }
  for (const r of data.lowMargin)
    pushIf(r, `low margin ${pct(r.cost.gross_margin_pct)}`);

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Everything in order
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No items need urgent attention. Run a fresh costing cycle if your
            menu changed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Items needing attention
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map(({ row, reason }) => (
            <li
              key={row.menu_item_id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{row.name}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {reason} · {fmt.money.format(row.revenue)} revenue
                </div>
              </div>
              <span className="font-medium tabular-nums shrink-0 text-amber-700 dark:text-amber-300">
                {fmt.money.format(row.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Compact "supplier price alerts" list for the Overview tab. */
export function SupplierPriceAlerts({ data }: { data: ProfitabilityData }) {
  // Show the top 5 by absolute % change (largest moves first), regardless of
  // direction — increases AND decreases are operationally relevant.
  const top = [...data.ingredientPriceTrends]
    .sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change))
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-orange-500" />
          Supplier price alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Supplier price trends will appear once at least two cost entries
            exist for the same ingredient.
          </p>
        ) : (
          <ul className="space-y-2">
            {top.map((t) => (
              <li
                key={t.ingredient_id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {t.ingredient_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.latest_supplier_name ?? "Unknown supplier"} ·{" "}
                    {t.latest_date}
                  </div>
                </div>
                <span
                  className={
                    "font-medium tabular-nums shrink-0 " +
                    (t.pct_change >= 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-green-700 dark:text-green-300")
                  }
                >
                  {t.pct_change >= 0 ? "+" : ""}
                  {t.pct_change.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (private to this file)
// ---------------------------------------------------------------------------

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function RiskCard({
  title,
  subtitle,
  icon,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  empty: string;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) && children.length === 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

function RiskLine({
  title,
  detail,
  trailing,
  trailingClass,
}: {
  title: string;
  detail: string;
  trailing: string;
  trailingClass?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{detail}</div>
      </div>
      <span
        className={`font-medium tabular-nums shrink-0 ${trailingClass ?? ""}`}
      >
        {trailing}
      </span>
    </li>
  );
}

function ChecklistItem({
  count,
  doneCopy,
  problemCopy,
  href,
  hrefLabel,
  icon,
}: {
  count: number;
  doneCopy: string;
  problemCopy: string;
  href: string;
  hrefLabel: string;
  icon: React.ReactNode;
}) {
  const done = count === 0;
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        ) : (
          <Circle className="h-4 w-4 text-amber-600 shrink-0" />
        )}
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="text-sm truncate">
          {done ? doneCopy : `${problemCopy} (${count})`}
        </span>
      </div>
      {!done && (
        <Link
          href={href}
          className="text-xs text-primary hover:underline shrink-0"
        >
          {hrefLabel} ↗
        </Link>
      )}
    </li>
  );
}
