// app/(restaurant-cockpit)/dashboard/restaurant/page.tsx
//
// Restaurant cockpit — live POS data when available, mock/sample data otherwise.
//
// Mode discrimination:
//   - "live"   : authenticated user, resolved company, ≥1 row in pos_sales_items
//                  → real KPIs from Supabase, dish-sales table from raw_item_name,
//                    recipe-costed margins suppressed (recipes are not seeded yet).
//   - "sample" : anything else (unauth, no company, no sales, supabase error)
//                  → mock cockpit, clearly labeled as sample data.
//
// This page lives in the (restaurant-cockpit) route group so that it bypasses
// app/dashboard/layout.tsx, which calls createClient() synchronously in a
// useMemo and is itself wrapped in client-side guards we don't need here.
// The public URL /dashboard/restaurant is unchanged — route groups are
// URL-transparent.
//
// This file is a Server Component (no "use client"): Supabase access uses the
// SSR client, so the user's session cookie is honored and RLS applies.

import { TrendingDown, AlertTriangle, ShieldAlert, Info } from "lucide-react";
import type React from "react";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  calculateRestaurantOverview,
  getRestaurantMenuItemMargins,
  getTopMarginItems,
  getLowMarginItems,
  getUnknownCostItems,
  getOpenRecommendations,
} from "@/lib/restaurant/calculations";
import { type SampleReason } from "@/lib/restaurant/supabase-sales";
import { PAGINATED_READ_SAFETY_CAP } from "@/lib/restaurant/paginated-read";
import {
  loadCockpitExecutiveFast,
  type CockpitExecutiveFastModel,
} from "@/lib/restaurant/cockpit-page-data";
import { CockpitV2 } from "@/components/restaurant/cockpit/v2/CockpitV2";
import { loadCockpitV2Model } from "@/lib/restaurant/cockpit-v2-server";
import {} from "@/components/restaurant/ProfitabilityCockpit";
import { CockpitHeadlineSkeleton } from "@/components/restaurant/cockpit/CockpitHeadline";
import { CockpitHeroChartSkeleton } from "@/components/restaurant/cockpit/CockpitHeroChart";
import { CockpitInsightsCardSkeleton } from "@/components/restaurant/cockpit/CockpitInsightsCard";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  DataHealthBanner,
  DataHealthIndicator,
} from "@/components/restaurant/shell/DataHealthIndicator";
import { buildCockpitDataHealth } from "@/lib/restaurant/cockpit-data-health";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import {
  MOCK_MENU_ITEMS,
  MOCK_RECIPES,
  MOCK_RECIPE_INGREDIENTS,
  MOCK_INGREDIENTS,
  MOCK_SUPPLIER_INVOICES,
  MOCK_SUPPLIER_INVOICE_LINES,
  MOCK_POS_SALES_ITEMS,
  MOCK_RECOMMENDATIONS,
  MOCK_AGENT_RUNS,
  MOCK_AGENT_DEFINITIONS,
} from "@/lib/restaurant/mock-data";
import type { RecommendationSeverity } from "@/types/restaurant";

// Force runtime rendering (no static cache); session cookies are read.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Formatters — currency formatting is mode-aware so MXN uploads render in MXN
// and the mock fallback (which uses USD-ish numbers) stays sensible.
// ---------------------------------------------------------------------------

function makeFmts(currency: string) {
  // For 3-letter codes Intl already knows. Fallback to USD if locale rejects.
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safeCurrency === "MXN" ? "es-MX" : "en-US";
  return {
    int: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
    dec2: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    code: safeCurrency,
    numLocale: locale,
  };
}

function fmtPct(n: number | null): string {
  return n !== null ? n.toFixed(1) + "%" : "—";
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function KpiCard({
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
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function cockpitSampleCopy(
  lang: PreferredLanguage,
  reason?: SampleReason
): string {
  const sampleCopyByReason: Record<SampleReason, string> = {
    unauthenticated: t(
      lang,
      "Showing sample data — sign in to see your own numbers. Import POS sales to see live revenue.",
      "Estás viendo datos de ejemplo — entra a tu cuenta para ver tus números. Importa ventas del POS para ver ingresos reales."
    ),
    no_company: t(
      lang,
      "Showing sample data — no company is linked to your account yet.",
      "Estás viendo datos de ejemplo — tu cuenta aún no está ligada a una empresa."
    ),
    no_sales: t(
      lang,
      "Showing sample data. Import POS sales to see live revenue and item performance.",
      "Estás viendo datos de ejemplo. Importa ventas del POS para ver ingresos y platillos reales."
    ),
    supabase_error: t(
      lang,
      "Showing sample data — could not reach the sales database. Try refreshing the page.",
      "Estás viendo datos de ejemplo — no se pudo leer la base de ventas. Recarga la página."
    ),
    env_missing: t(
      lang,
      "Showing sample data — sales storage is not configured here.",
      "Estás viendo datos de ejemplo — el almacenamiento de ventas no está configurado aquí."
    ),
  };
  return reason ? sampleCopyByReason[reason] : sampleCopyByReason.no_sales;
}

function SampleDataHealth({
  lang,
  reason,
}: {
  lang: PreferredLanguage;
  reason?: SampleReason;
}) {
  const health = buildCockpitDataHealth({
    lang,
    currency: "USD",
    saleLineCount: 0,
    otherCurrencyExcluded: 0,
    dishesWithoutRecipe: 0,
    recipeCoveragePct: null,
    costCoveragePct: 0,
    lastSyncedAt: null,
    posConnected: false,
    salesLoaded: false,
    readError: false,
    truncated: false,
  });
  return (
    <div className="space-y-2">
      <DataHealthBanner tone="warn">
        {cockpitSampleCopy(lang, reason)}
      </DataHealthBanner>
      <DataHealthIndicator lang={lang} health={health} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sample (mock) view — preserved from the previous mock-only implementation
// so the cockpit still demos cleanly when no real data exists.
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  RecommendationSeverity,
  { badgeClass: string; icon: React.ReactNode }
> = {
  critical: {
    badgeClass:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-0",
    icon: <ShieldAlert className="h-3.5 w-3.5 inline mr-1 shrink-0" />,
  },
  warning: {
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0",
    icon: <AlertTriangle className="h-3.5 w-3.5 inline mr-1 shrink-0" />,
  },
  info: {
    badgeClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0",
    icon: <Info className="h-3.5 w-3.5 inline mr-1 shrink-0" />,
  },
};

function SampleRestaurantView({ reason }: { reason: SampleReason }) {
  // Mock currency is MXN throughout the seed data → use that explicitly.
  const fmts = makeFmts("MXN");

  const overview = calculateRestaurantOverview(
    MOCK_POS_SALES_ITEMS,
    MOCK_MENU_ITEMS,
    MOCK_RECIPES,
    MOCK_RECIPE_INGREDIENTS,
    MOCK_INGREDIENTS,
    MOCK_SUPPLIER_INVOICES,
    MOCK_SUPPLIER_INVOICE_LINES
  );
  const allMargins = getRestaurantMenuItemMargins(
    MOCK_MENU_ITEMS,
    MOCK_RECIPES,
    MOCK_RECIPE_INGREDIENTS,
    MOCK_INGREDIENTS,
    MOCK_SUPPLIER_INVOICES,
    MOCK_SUPPLIER_INVOICE_LINES
  );
  const topItems = getTopMarginItems(
    MOCK_MENU_ITEMS,
    MOCK_RECIPES,
    MOCK_RECIPE_INGREDIENTS,
    MOCK_INGREDIENTS,
    MOCK_SUPPLIER_INVOICES,
    MOCK_SUPPLIER_INVOICE_LINES,
    3
  );
  const lowItems = getLowMarginItems(
    MOCK_MENU_ITEMS,
    MOCK_RECIPES,
    MOCK_RECIPE_INGREDIENTS,
    MOCK_INGREDIENTS,
    MOCK_SUPPLIER_INVOICES,
    MOCK_SUPPLIER_INVOICE_LINES
  );
  const unknownItems = getUnknownCostItems(
    MOCK_MENU_ITEMS,
    MOCK_RECIPES,
    MOCK_RECIPE_INGREDIENTS,
    MOCK_INGREDIENTS,
    MOCK_SUPPLIER_INVOICES,
    MOCK_SUPPLIER_INVOICE_LINES
  );
  const openRecs = getOpenRecommendations(MOCK_RECOMMENDATIONS);
  const agentRunById = new Map(MOCK_AGENT_RUNS.map((r) => [r.id, r]));
  const agentDefById = new Map(MOCK_AGENT_DEFINITIONS.map((d) => [d.id, d]));

  const criticalCount = openRecs.filter(
    (r) => r.severity === "critical"
  ).length;

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-8">
        <OperatingPageHeader
          title={t(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE, "Cockpit", "Cockpit")}
          lang={RESTAURANT_COCKPIT_DEFAULT_LANGUAGE}
        />
        <SampleDataHealth
          lang={RESTAURANT_COCKPIT_DEFAULT_LANGUAGE}
          reason={reason}
        />

        {/* KPIs */}
        <section>
          <h2 className="text-base font-semibold mb-3">
            {t(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE, "Overview", "Resumen")}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Total Revenue",
                "Ventas totales"
              )}
              value={fmts.int.format(overview.total_revenue)}
              sub={overview.currency}
            />
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Total Orders",
                "Pedidos"
              )}
              value={overview.total_orders.toLocaleString(fmts.numLocale)}
              sub={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "unique checks",
                "cuentas únicas"
              )}
            />
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Units Sold",
                "Unidades vendidas"
              )}
              value={overview.total_units_sold.toLocaleString(fmts.numLocale)}
              sub={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "dishes",
                "platillos"
              )}
            />
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Avg Ticket",
                "Ticket promedio"
              )}
              value={fmts.int.format(overview.avg_ticket)}
              sub={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "per order",
                "por pedido"
              )}
            />
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Food Cost",
                "Costo de comida"
              )}
              value={fmtPct(overview.food_cost_pct)}
              sub={fmts.int.format(overview.food_cost_amount)}
            />
            <KpiCard
              label={t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Gross Margin",
                "Margen bruto"
              )}
              value={fmtPct(overview.gross_margin_pct)}
              sub={fmts.int.format(overview.gross_margin_amount)}
            />
          </div>
          {criticalCount > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                {t(
                  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                  `${criticalCount} critical alert${criticalCount > 1 ? "s" : ""} require your attention — see recommendations below.`,
                  `${criticalCount} ${criticalCount > 1 ? "alertas críticas requieren" : "alerta crítica requiere"} tu atención — mira las recomendaciones abajo.`
                )}
              </span>
            </div>
          )}
        </section>

        {/* Dish profitability — kept ONLY in sample mode. */}
        <section>
          <h2 className="text-base font-semibold mb-3">
            {t(
              RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
              "Dish Profitability",
              "Rentabilidad por platillo"
            )}
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left">
                      <th className="p-3 font-medium">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Item",
                          "Platillo"
                        )}
                      </th>
                      <th className="p-3 font-medium text-right">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Price",
                          "Precio"
                        )}
                      </th>
                      <th className="p-3 font-medium text-right">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Est. Cost",
                          "Costo est."
                        )}
                      </th>
                      <th className="p-3 font-medium text-right">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Gross Profit",
                          "Utilidad bruta"
                        )}
                      </th>
                      <th className="p-3 font-medium text-right">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Margin %",
                          "Margen %"
                        )}
                      </th>
                      <th className="p-3 font-medium text-right">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Food Cost %",
                          "Costo de comida %"
                        )}
                      </th>
                      <th className="p-3 font-medium">
                        {t(
                          RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                          "Status",
                          "Estado"
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allMargins.map((item, i) => (
                      <tr
                        key={item.menu_item_id}
                        className={
                          (i % 2 === 0 ? "bg-background" : "bg-muted/20") +
                          " hover:bg-muted/40 transition-colors"
                        }
                      >
                        <td className="p-3 font-medium">{item.name}</td>
                        <td className="p-3 text-right">
                          {fmts.dec2.format(item.selling_price)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {item.calculated_cost !== null
                            ? fmts.dec2.format(item.calculated_cost)
                            : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {item.gross_margin_amount !== null
                            ? fmts.dec2.format(item.gross_margin_amount)
                            : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums font-medium">
                          {fmtPct(item.gross_margin_pct)}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {fmtPct(item.food_cost_pct)}
                        </td>
                        <td className="p-3">
                          {item.gross_margin_pct === null ? (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              {item.cost_result.status === "missing_recipe"
                                ? t(
                                    RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                                    "No recipe",
                                    "Sin receta"
                                  )
                                : t(
                                    RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                                    "Missing cost",
                                    "Falta el costo"
                                  )}
                            </span>
                          ) : item.gross_margin_pct < 60 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                              {t(
                                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                                "Low margin",
                                "Margen bajo"
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-green-600 dark:text-green-400">
                              {t(
                                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                                "OK",
                                "OK"
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Top margin items */}
        <section>
          <h2 className="text-base font-semibold mb-3">
            {t(
              RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
              "Top Margin Dishes",
              "Platillos de mayor margen"
            )}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {topItems.map((item, rank) => (
              <Card key={item.menu_item_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">{item.name}</CardTitle>
                    <span className="text-xs text-muted-foreground shrink-0">
                      #{rank + 1}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {fmtPct(item.gross_margin_pct)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE, "FC", "Costo")}{" "}
                    {fmtPct(item.food_cost_pct)} ·{" "}
                    {t(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE, "Cost", "Costo")}{" "}
                    {item.calculated_cost !== null
                      ? fmts.dec2.format(item.calculated_cost)
                      : "—"}{" "}
                    ·{" "}
                    {t(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE, "Price", "Precio")}{" "}
                    {fmts.dec2.format(item.selling_price)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Margin risk */}
        {(lowItems.length > 0 || unknownItems.length > 0) && (
          <section>
            <h2 className="text-base font-semibold mb-3">
              {t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                "Margin Risk",
                "Riesgo de margen"
              )}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lowItems.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-900">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      {t(
                        RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                        "Low Margin Items (<60%)",
                        "Platillos de margen bajo (<60%)"
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {lowItems.map((item) => (
                        <li
                          key={item.menu_item_id}
                          className="flex items-center justify-between text-sm gap-2"
                        >
                          <span>{item.name}</span>
                          <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400 shrink-0">
                            {fmtPct(item.gross_margin_pct)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {unknownItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                      {t(
                        RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                        "Unknown Cost Items",
                        "Platillos sin costo"
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {unknownItems.map((item) => (
                        <li
                          key={item.menu_item_id}
                          className="flex items-center justify-between text-sm gap-2"
                        >
                          <span>{item.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0 uppercase">
                            {item.cost_result.status.replace(/_/g, " ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        )}

        {/* Recommendations */}
        <section>
          <h2 className="text-base font-semibold mb-3">
            {t(
              RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
              "Recommendations",
              "Recomendaciones"
            )}{" "}
            <span className="text-muted-foreground font-normal text-sm">
              (
              {t(
                RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
                `${openRecs.length} open`,
                `${openRecs.length} abiertas`
              )}
              )
            </span>
          </h2>
          <div className="space-y-3">
            {openRecs.map((rec) => {
              const cfg = SEVERITY_CONFIG[rec.severity];
              const agentKey = rec.agent_run_id
                ? agentDefById.get(
                    agentRunById.get(rec.agent_run_id)?.agent_definition_id ??
                      ""
                  )?.key
                : undefined;
              return (
                <Card key={rec.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badgeClass}`}
                          >
                            {cfg.icon}
                            {rec.severity}
                          </span>
                          {agentKey && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {agentKey}
                            </span>
                          )}
                          {rec.related_entity_type && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {rec.related_entity_type.replace(/_/g, " ")}
                            </span>
                          )}
                          <span className="text-sm font-semibold">
                            {rec.title}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {rec.body}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs capitalize shrink-0"
                      >
                        {rec.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page entry — branches on live vs sample mode.
// ---------------------------------------------------------------------------

async function CockpitLiveBody({
  location,
  period,
}: {
  location?: string;
  period?: string;
}) {
  const fast: CockpitExecutiveFastModel = await loadCockpitExecutiveFast(
    location,
    period
  );
  if (fast.mode !== "live") {
    return <SampleRestaurantView reason={fast.reason ?? "no_sales"} />;
  }
  const lang = fast.lang;
  const model = await loadCockpitV2Model(fast);
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-3">
      <OperatingPageHeader
        title={t(lang, "Cockpit", "Cockpit")}
        lang={lang}
        showDateRange={false}
        lastSyncedAt={fast.lastSyncedAt}
      />
      {fast.readError ? (
        <DataHealthBanner tone="error">
          {t(
            lang,
            "Could not load all sales rows. Totals are unavailable — they are not a smaller number from a partial read. Try refreshing the page.",
            "No se pudieron cargar todas las ventas. Los totales no están disponibles: no son un número más chico de una lectura parcial. Recarga la página."
          )}
        </DataHealthBanner>
      ) : null}
      {fast.truncated && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 p-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {t(
              lang,
              `Totals may be incomplete. This view stopped after ${PAGINATED_READ_SAFETY_CAP.toLocaleString("es-MX")} rows. The numbers shown are partial.`,
              `Los totales pueden estar incompletos. Esta vista se detuvo después de ${PAGINATED_READ_SAFETY_CAP.toLocaleString("es-MX")} filas. Los números que ves son parciales.`
            )}
          </span>
        </div>
      )}
      {/* R1-16b: the Cockpit v2. One dataset, all filtering in the browser. */}
      {model.refDay ? (
        <CockpitV2
          currency={fast.currency}
          daily={model.daily}
          refDay={model.refDay}
          today={model.today}
          firstDay={model.firstDay}
          targets={model.targets}
          restaurants={model.restaurants}
          locationId={fast.scope?.locationId ?? null}
          defaultComparison={model.defaultComparison}
        />
      ) : (
        <SampleRestaurantView reason="no_sales" />
      )}
    </div>
  );
}

export default async function RestaurantCockpitPage({
  searchParams,
}: {
  // Next.js 15+/16: searchParams is a Promise in a page Server Component.
  searchParams: Promise<{ location?: string; period?: string }>;
}) {
  const { location: requestedLocationId, period } = await searchParams;
  return (
    <Suspense fallback={<RestaurantCockpitLoadingFallback />}>
      <CockpitLiveBody location={requestedLocationId} period={period} />
    </Suspense>
  );
}

function RestaurantCockpitLoadingFallback() {
  return (
    <div className="w-full py-3 px-6 lg:px-10">
      <div className="space-y-3">
        <PageSkeleton height="2rem" width="16rem" label="period" />
        <CockpitHeadlineSkeleton />
        <PageSkeleton height="4.5rem" width="100%" label="kpi strip" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="lg:col-span-2">
            <CockpitHeroChartSkeleton />
          </div>
          <PageSkeleton height="220px" width="100%" label="channels" />
        </div>
        <CockpitInsightsCardSkeleton />
      </div>
    </div>
  );
}
