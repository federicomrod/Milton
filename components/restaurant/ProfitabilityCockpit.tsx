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
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

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
  complete: "Completo",
  missing_recipe: "Sin receta",
  missing_component_recipe: "Falta receta del componente",
  missing_input_cost: "Falta el costo del ingrediente",
  missing_unit_conversion: "Unidades que no coinciden",
  circular_component_reference: "Referencia circular",
  no_cost_entries: "Sin costos",
  inactive_recipe: "Receta inactiva",
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
        <h2 className="text-base font-semibold">
          {t("es", "Profitability", "Rentabilidad")}
        </h2>
        <Badge variant="outline" className="text-xs">
          {t("es", "Cost coverage:", "Cobertura de costo:")}{" "}
          {pct(kpis.cost_coverage_pct)} {t("es", "of revenue", "de las ventas")}
        </Badge>
      </div>
      {data.dataQuality.currency_mismatch_rows > 0 && (
        <div className="mb-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {t(
              "es",
              `${data.dataQuality.currency_mismatch_rows} row${data.dataQuality.currency_mismatch_rows === 1 ? "" : "s"} used a different currency than ${kpis.currency} and were not summed into these KPIs. There is no FX conversion.`,
              `${data.dataQuality.currency_mismatch_rows} ${data.dataQuality.currency_mismatch_rows === 1 ? "fila usó" : "filas usaron"} una moneda distinta a ${kpis.currency} y no se sumaron a estas cifras. No hay conversión de tipo de cambio.`
            )}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label={t("es", "Revenue", "Ventas")}
          value={fmt.money.format(kpis.revenue_total)}
          sub={kpis.currency}
        />
        <Kpi
          label={t("es", "Estimated COGS", "Costo estimado")}
          value={fmt.money.format(kpis.estimated_cogs)}
          sub={t(
            "es",
            `from ${pct(kpis.cost_coverage_pct, 0)} of revenue`,
            `sobre el ${pct(kpis.cost_coverage_pct, 0)} de las ventas`
          )}
        />
        <Kpi
          label={t("es", "Gross Profit", "Utilidad bruta")}
          value={
            kpis.revenue_with_known_cost > 0
              ? fmt.money.format(kpis.estimated_gross_profit)
              : "—"
          }
          sub={
            kpis.revenue_with_known_cost > 0
              ? t("es", "on covered revenue", "sobre ventas con costo")
              : t("es", "no cost coverage", "sin cobertura de costo")
          }
        />
        <Kpi
          label={t("es", "Gross Margin", "Margen bruto")}
          value={pct(kpis.estimated_gross_margin_pct)}
          sub={t("es", "on covered revenue", "sobre ventas con costo")}
        />
        <Kpi
          label={t("es", "% costo de comida", "% costo de comida")}
          value={pct(kpis.food_cost_pct)}
          sub={t("es", "cogs / covered revenue", "costo / ventas con costo")}
        />
        <Kpi
          label={t("es", "Items w/ Issues", "Platillos con problemas")}
          value={`${
            kpis.menu_items_with_issues + kpis.menu_items_without_recipe
          }`}
          sub={t(
            "es",
            `${kpis.menu_items_without_recipe} no recipe · ${kpis.menu_items_with_issues} other`,
            `${kpis.menu_items_without_recipe} sin receta · ${kpis.menu_items_with_issues} otros`
          )}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        {t(
          "es",
          "Margin numbers include only menu items with complete recipes and ingredient costs. Items with missing recipes or unit mismatches are excluded — see Margin Risk and Setup tabs.",
          "El margen solo incluye platillos con receta y costos completos. Los que no tienen receta o tienen unidades distintas quedan fuera: míralos en Riesgo de margen y Configuración."
        )}
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
        title={t("es", "Low margin items", "Platillos de margen bajo")}
        subtitle={t(
          "es",
          `Gross margin below 60% · ${data.lowMargin.length} items`,
          `Margen bruto menor a 60% · ${data.lowMargin.length} platillos`
        )}
        icon={<TrendingDown className="h-4 w-4 text-amber-600" />}
        empty={t(
          "es",
          "No low-margin items below 60%.",
          "No hay platillos con margen menor a 60%."
        )}
      >
        {data.lowMargin.map((r) => (
          <RiskLine
            key={r.menu_item_id}
            title={r.name}
            detail={t(
              "es",
              `${pct(r.cost.gross_margin_pct)} margin · ${fmt.money.format(r.revenue)} revenue`,
              `${pct(r.cost.gross_margin_pct)} de margen · ${fmt.money.format(r.revenue)} en ventas`
            )}
            trailing={pct(r.cost.gross_margin_pct)}
            trailingClass="text-amber-700 dark:text-amber-300"
          />
        ))}
      </RiskCard>

      <RiskCard
        title={t("es", "High food cost items", "Platillos de costo alto")}
        subtitle={t(
          "es",
          `Food cost above 35% · ${data.highFoodCost.length} items`,
          `Costo de comida mayor a 35% · ${data.highFoodCost.length} platillos`
        )}
        icon={<TrendingUp className="h-4 w-4 text-red-600" />}
        empty={t(
          "es",
          "No items with food cost above 35%.",
          "No hay platillos con costo de comida mayor a 35%."
        )}
      >
        {data.highFoodCost.map((r) => (
          <RiskLine
            key={r.menu_item_id}
            title={r.name}
            detail={t(
              "es",
              `${pct(r.cost.food_cost_pct)} food cost · ${fmt.money.format(r.revenue)} revenue`,
              `${pct(r.cost.food_cost_pct)} de costo · ${fmt.money.format(r.revenue)} en ventas`
            )}
            trailing={pct(r.cost.food_cost_pct)}
            trailingClass="text-red-700 dark:text-red-300"
          />
        ))}
      </RiskCard>

      {!compact && (
        <RiskCard
          title={t(
            "es",
            "High revenue, incomplete costing",
            "Alto ingreso, costeo incompleto"
          )}
          subtitle={t(
            "es",
            `Revenue but unknown cost · ${data.highRevenueIncomplete.length} items`,
            `Ventas sin costo conocido · ${data.highRevenueIncomplete.length} platillos`
          )}
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          empty={t(
            "es",
            "Every revenue-generating item has a complete cost.",
            "Todos los platillos que venden ya tienen costo completo."
          )}
        >
          {data.highRevenueIncomplete.map((r) => (
            <RiskLine
              key={r.menu_item_id}
              title={r.name}
              detail={`${fmt.money.format(r.revenue)} · ${STATUS_LABEL[r.cost.status] ?? r.cost.status}`}
              trailing={fmt.money.format(r.revenue)}
              trailingClass="text-amber-700 dark:text-amber-300"
            />
          ))}
        </RiskCard>
      )}

      {!compact && (
        <RiskCard
          title={t(
            "es",
            "Missing recipe, high volume",
            "Sin receta, alto volumen"
          )}
          subtitle={t(
            "es",
            `No recipe but selling · ${data.missingRecipeHighVolume.length} items`,
            `Sin receta y se venden · ${data.missingRecipeHighVolume.length} platillos`
          )}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          empty={t(
            "es",
            "Every selling menu item has at least a draft recipe.",
            "Todos los platillos que se venden ya tienen al menos un borrador de receta."
          )}
        >
          {data.missingRecipeHighVolume.map((r) => (
            <RiskLine
              key={r.menu_item_id}
              title={r.name}
              detail={t(
                "es",
                `${fmt.num.format(r.units_sold)} units · ${fmt.money.format(r.revenue)} revenue`,
                `${fmt.num.format(r.units_sold)} unidades · ${fmt.money.format(r.revenue)} en ventas`
              )}
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
      <h2 className="text-base font-semibold mb-3">
        {t("es", "Margin risk", "Riesgo de margen")}
      </h2>
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
        <h2 className="text-base font-semibold">
          {t("es", "Supplier trends", "Tendencias de proveedores")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t(
            "es",
            "Uses all available cost entries (not filtered by date)",
            "Usa todos los costos disponibles (no el filtro de fechas)"
          )}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ingredient price changes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              {t(
                "es",
                "Ingredient price changes",
                "Cambios de precio de ingredientes"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.ingredientPriceTrends.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-3">
                {t(
                  "es",
                  "Supplier price trends will appear after at least two cost entries for the same ingredient.",
                  "Las tendencias de precio aparecen cuando hay al menos dos costos del mismo ingrediente."
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">
                        {t("es", "Ingredient", "Ingrediente")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("es", "Supplier", "Proveedor")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Previous", "Anterior")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Latest", "Último")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Change", "Cambio")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("es", "Latest date", "Última fecha")}
                      </th>
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
              {t("es", "Top supplier spend", "Mayor gasto por proveedor")}
              <span className="text-xs text-muted-foreground font-normal">
                · {t("es", "total", "total")}{" "}
                {fmt.money.format(data.total_supplier_spend)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.topSupplierSpend.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-3">
                {t(
                  "es",
                  "No supplier-tagged cost entries yet. Bulk-upload a cost file or pick a supplier when adding a manual cost entry.",
                  "Aún no hay costos con proveedor. Sube un archivo de costos o elige un proveedor al agregar un costo."
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">
                        {t("es", "Supplier", "Proveedor")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Spend", "Gasto")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Share", "Parte")}
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        {t("es", "Ingredients", "Ingredientes")}
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
      <h2 className="text-base font-semibold mb-3">
        {t("es", "Costing setup checklist", "Lista de costeo")}
      </h2>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            <ChecklistItem
              count={data.dataQuality.unmapped_pos_items}
              doneCopy={t(
                "es",
                "All POS items mapped to menu items",
                "Todos los platillos del POS están ligados al menú"
              )}
              problemCopy={t(
                "es",
                "POS items unmapped",
                "Platillos del POS sin ligar"
              )}
              href="/dashboard/restaurant/menu"
              hrefLabel={t("es", "Open Menu & Recipes", "Abrir Menú y recetas")}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.menu_items_without_recipe}
              doneCopy={t(
                "es",
                "Every menu item has a recipe",
                "Todos los platillos tienen receta"
              )}
              problemCopy={t(
                "es",
                "Menu items without a recipe",
                "Platillos sin receta"
              )}
              href="/dashboard/restaurant/menu"
              hrefLabel={t("es", "Open Menu & Recipes", "Abrir Menú y recetas")}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.recipes_with_unit_mismatch}
              doneCopy={t(
                "es",
                "No recipes blocked by unit mismatch",
                "Ninguna receta está bloqueada por unidades"
              )}
              problemCopy={t(
                "es",
                "Recipes blocked by unit mismatch",
                "Recetas bloqueadas por unidades"
              )}
              href="/dashboard/restaurant/menu"
              hrefLabel={t("es", "Fix recipes", "Corregir recetas")}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.ingredients_without_cost_entries}
              doneCopy={t(
                "es",
                "Every ingredient has at least one cost entry",
                "Todos los ingredientes tienen al menos un costo"
              )}
              problemCopy={t(
                "es",
                "Ingredients without any cost entry",
                "Ingredientes sin costo"
              )}
              href="/dashboard/restaurant/ingredients"
              hrefLabel={t("es", "Open Ingredients", "Abrir Ingredientes")}
              icon={<Carrot className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.components_without_recipe}
              doneCopy={t(
                "es",
                "Every prepared component has a recipe",
                "Todos los componentes preparados tienen receta"
              )}
              problemCopy={t(
                "es",
                "Prepared components without a recipe",
                "Componentes preparados sin receta"
              )}
              href="/dashboard/restaurant/menu"
              hrefLabel={t("es", "Open Components", "Abrir Componentes")}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ChecklistItem
              count={data.dataQuality.currency_mismatch_rows}
              doneCopy={t(
                "es",
                `All money rows match ${data.kpis.currency}`,
                `Todas las filas coinciden con ${data.kpis.currency}`
              )}
              problemCopy={t(
                "es",
                "Rows in a different currency (excluded from totals)",
                "Filas en otra moneda (fuera de los totales)"
              )}
              href="/dashboard/restaurant/costs/upload"
              hrefLabel={t("es", "Review costs", "Revisar costos")}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <li className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {t(
                    "es",
                    "Supplier-linked ingredients",
                    "Ingredientes ligados a un proveedor"
                  )}
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
                  {t("es", "Open Suppliers", "Abrir Proveedores")} ↗
                </Link>
              </div>
            </li>
            <li className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Upload className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {t("es", "Import more cost data", "Importar más costos")}
                </span>
              </div>
              <Link
                href="/dashboard/restaurant/costs/upload"
                className="text-xs text-primary hover:underline shrink-0"
              >
                {t("es", "Open Import Costs", "Abrir Importar costos")} ↗
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
  for (const r of data.missingRecipeHighVolume)
    pushIf(r, t("es", "no recipe", "sin receta"));
  for (const r of data.highRevenueIncomplete) {
    pushIf(r, STATUS_LABEL[r.cost.status] ?? r.cost.status);
  }
  for (const r of data.lowMargin)
    pushIf(
      r,
      t(
        "es",
        `low margin ${pct(r.cost.gross_margin_pct)}`,
        `margen bajo ${pct(r.cost.gross_margin_pct)}`
      )
    );

  if (items.length === 0) {
    const noCoverage = data.kpis.cost_coverage_pct === 0;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {noCoverage ? (
              <Info className="h-4 w-4 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            )}
            {noCoverage
              ? t(
                  "es",
                  "Margins are not available yet",
                  "El margen aún no está disponible"
                )
              : t("es", "Everything in order", "Todo en orden")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {noCoverage
              ? t(
                  "es",
                  "Import ingredient costs and create recipes to unlock food cost and gross margin.",
                  "Importa costos de ingredientes y crea recetas para ver el costo de comida y el margen."
                )
              : t(
                  "es",
                  "No items need urgent attention. Run a fresh costing cycle if your menu changed.",
                  "Nada urgente. Vuelve a costear si cambió el menú."
                )}
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
          {t(
            "es",
            "Items needing attention",
            "Platillos que necesitan atención"
          )}
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
                  {reason} · {fmt.money.format(row.revenue)}{" "}
                  {t("es", "revenue", "en ventas")}
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
          {t("es", "Supplier price alerts", "Alertas de precio de proveedores")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              "es",
              "Supplier price trends will appear after at least two cost entries for the same ingredient.",
              "Las tendencias de precio aparecen cuando hay al menos dos costos del mismo ingrediente."
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {top.map((trend) => (
              <li
                key={trend.ingredient_id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {trend.ingredient_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {trend.latest_supplier_name ??
                      t("es", "Unknown supplier", "Proveedor desconocido")}{" "}
                    · {trend.latest_date}
                  </div>
                </div>
                <span
                  className={
                    "font-medium tabular-nums shrink-0 " +
                    (trend.pct_change >= 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-green-700 dark:text-green-300")
                  }
                >
                  {trend.pct_change >= 0 ? "+" : ""}
                  {trend.pct_change.toFixed(1)}%
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
