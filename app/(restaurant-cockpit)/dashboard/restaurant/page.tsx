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

import Link from "next/link";
import { TrendingDown, AlertTriangle, ShieldAlert, Info } from "lucide-react";
import type React from "react";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type TargetMap } from "@/lib/restaurant/supabase-targets";
import {
  calculateRestaurantOverview,
  getRestaurantMenuItemMargins,
  getTopMarginItems,
  getLowMarginItems,
  getUnknownCostItems,
  getOpenRecommendations,
} from "@/lib/restaurant/calculations";
import {
  type RestaurantDashboardData,
  type SampleReason,
} from "@/lib/restaurant/supabase-sales";
import { type ProfitabilityData } from "@/lib/restaurant/profitability-server";
import { PAGINATED_READ_SAFETY_CAP } from "@/lib/restaurant/paginated-read";
import {
  loadCockpitExecutivePage,
  type CockpitExecutiveView,
} from "@/lib/restaurant/cockpit-page-data";
import {
  ProfitabilityKpisSection,
  MarginRiskSection,
  SupplierTrendsSection,
  DataQualityChecklistSection,
  ItemsNeedingAttention,
  SupplierPriceAlerts,
} from "@/components/restaurant/ProfitabilityCockpit";
import { CockpitTabs } from "@/components/restaurant/cockpit/CockpitTabs";
import { CockpitKpiStrip } from "@/components/restaurant/cockpit/CockpitKpiStrip";
import { RevenueAndChannelsTab } from "@/components/restaurant/cockpit/RevenueAndChannelsTab";
import { MenuProfitabilityTab } from "@/components/restaurant/cockpit/MenuProfitabilityTab";
import { CockpitPeriodControl } from "@/components/restaurant/cockpit/CockpitPeriodControl";
import {
  CockpitHeadline,
  CockpitHeadlineSkeleton,
} from "@/components/restaurant/cockpit/CockpitHeadline";
import {
  CockpitHeroChart,
  CockpitHeroChartSkeleton,
} from "@/components/restaurant/cockpit/CockpitHeroChart";
import { CockpitChannelBreakdown } from "@/components/restaurant/cockpit/CockpitChannelBreakdown";
import {
  CockpitInsightsCard,
  CockpitInsightsCardSkeleton,
} from "@/components/restaurant/cockpit/CockpitInsightsCard";
import { CockpitInsightsUpgrade } from "@/components/restaurant/cockpit/CockpitInsightsUpgrade";
import { CockpitOnboardingChip } from "@/components/restaurant/cockpit/CockpitOnboardingChip";
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
import { RestaurantSetupChecklist } from "@/components/restaurant/RestaurantSetupChecklist";
import { type CockpitPeriodPreset } from "@/lib/restaurant/cockpit-period";
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
// Live (real-data) view
// ---------------------------------------------------------------------------

function LiveRestaurantView({
  data,
  targets,
  profitability,
  executive,
  periodPreset,
}: {
  data: Extract<RestaurantDashboardData, { mode: "live" }>;
  /** Daily KPI targets for the same company; empty when nothing is set. */
  targets: TargetMap;
  /** Profitability aggregate; null when the load failed (we still render
   *  the POS explorer so the page degrades cleanly). */
  profitability: ProfitabilityData | null;
  executive: CockpitExecutiveView | null;
  periodPreset: CockpitPeriodPreset;
}) {
  const lang: PreferredLanguage = data.preferredLanguage;
  // Tab content is built once on the server and passed through the
  // client tab shell. Server-rendered ReactNodes flow through fine
  // (Next.js App Router supports this); only the active-tab state
  // lives in the client component.
  const issueCount = profitability
    ? profitability.kpis.menu_items_with_issues +
      profitability.kpis.menu_items_without_recipe
    : 0;
  const setupOutstanding = profitability
    ? profitability.dataQuality.unmapped_pos_items +
      profitability.dataQuality.menu_items_without_recipe +
      profitability.dataQuality.recipes_with_unit_mismatch +
      profitability.dataQuality.ingredients_without_cost_entries +
      profitability.dataQuality.components_without_recipe +
      profitability.dataQuality.currency_mismatch_rows
    : 0;

  const tabs = profitability
    ? [
        {
          id: "overview",
          label: t(lang, "Overview", "Resumen"),
          content: (
            <OverviewTab
              profitability={profitability}
              rowCount={data.rowCount}
              lang={lang}
            />
          ),
        },
        {
          id: "menu",
          label: t(lang, "Menu Profitability", "Rentabilidad del menú"),
          badge: issueCount > 0 ? String(issueCount) : undefined,
          content: <MenuProfitabilityTab profitability={profitability} />,
        },
        {
          id: "suppliers",
          label: t(lang, "Suppliers & Costs", "Proveedores y costos"),
          content: <SupplierTrendsSection data={profitability} />,
        },
        {
          id: "revenue",
          label: t(lang, "Sales", "Ventas"),
          content: (
            <RevenueAndChannelsTab
              rows={data.explorerRows}
              targets={targets}
              displayCurrency={profitability.kpis.currency}
              cockpit={data.cockpit}
              lang={lang}
            />
          ),
        },
        {
          id: "setup",
          label: t(lang, "Setup / Data Quality", "Configuración y datos"),
          badge: setupOutstanding > 0 ? String(setupOutstanding) : undefined,
          content: <SetupTab profitability={profitability} lang={lang} />,
        },
      ]
    : [
        // Profitability load failed — collapse to a single "Revenue & Channels"
        // tab so the user still gets the POS explorer.
        {
          id: "revenue",
          label: t(lang, "Sales", "Ventas"),
          content: (
            <RevenueAndChannelsTab
              rows={data.explorerRows}
              targets={targets}
              displayCurrency={data.overview.currency}
              cockpit={data.cockpit}
              lang={lang}
            />
          ),
        },
      ];

  return (
    <div className="w-full py-3 px-6 lg:px-10">
      <div className="space-y-3">
        <OperatingPageHeader
          title={t(lang, "Cockpit", "Cockpit")}
          lang={lang}
          dateRange={
            <Suspense fallback={<PageSkeleton width="16rem" height="2rem" />}>
              <CockpitPeriodControl
                lang={lang}
                preset={periodPreset}
                range={
                  executive
                    ? executive.snapshot.period.current
                    : data.cockpit.period_from && data.cockpit.period_to
                      ? {
                          from: data.cockpit.period_from,
                          to: data.cockpit.period_to,
                        }
                      : null
                }
                comparisonLabel={executive?.comparisonLabel}
              />
            </Suspense>
          }
        />
        {executive ? (
          <div className="flex items-center gap-2 flex-wrap">
            {executive.setup ? (
              <CockpitOnboardingChip lang={lang} progress={executive.setup} />
            ) : null}
            <DataHealthIndicator lang={lang} health={executive.health} />
          </div>
        ) : null}

        {executive ? (
          <CockpitHeadline text={executive.headline} />
        ) : (
          <CockpitHeadlineSkeleton />
        )}

        {executive ? (
          <CockpitKpiStrip model={executive.kpis} lang={lang} />
        ) : null}

        {executive ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="lg:col-span-2">
              <CockpitHeroChart
                lang={lang}
                currency={executive.snapshot.currency}
                points={executive.snapshot.daily}
              />
            </div>
            <CockpitChannelBreakdown
              lang={lang}
              currency={executive.snapshot.currency}
              channels={executive.snapshot.channels}
            />
          </div>
        ) : (
          <CockpitHeroChartSkeleton />
        )}

        {executive ? (
          <Suspense
            fallback={
              <CockpitInsightsCard
                lang={lang}
                insights={executive.insights.insights}
                source="deterministic"
              />
            }
          >
            <CockpitInsightsUpgrade
              facts={executive.insightFacts}
              lang={lang}
              cacheKey={executive.insightCacheKey}
            />
          </Suspense>
        ) : (
          <CockpitInsightsCardSkeleton />
        )}

        {executive?.health.tone === "error" ||
        data.readError ||
        profitability?.readError ? (
          <DataHealthBanner tone="error">
            {t(
              lang,
              "Could not load all sales rows. Totals are unavailable — they are not a smaller number from a partial read. Try refreshing the page.",
              "No se pudieron cargar todas las ventas. Los totales no están disponibles: no son un número más chico de una lectura parcial. Recarga la página."
            )}
          </DataHealthBanner>
        ) : null}

        {(data.truncated || profitability?.truncated) && (
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

        <CockpitTabs tabs={tabs} defaultTab="overview" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function OverviewTab({
  profitability,
  rowCount,
  lang,
}: {
  profitability: ProfitabilityData;
  rowCount: number;
  lang: PreferredLanguage;
}) {
  return (
    <div className="space-y-8">
      <ProfitabilityKpisSection data={profitability} />

      {/* Two-column overview panel: top items + supplier price alerts */}
      <section>
        <h2 className="text-base font-semibold mb-3">
          {t(lang, "Today's attention", "Atención de hoy")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ItemsNeedingAttention data={profitability} />
          <SupplierPriceAlerts data={profitability} />
        </div>
      </section>

      {/* Margin risk (compact: 2 most actionable cards on Overview) */}
      <MarginRiskSection data={profitability} compact />

      {/* Placeholders for future signals — clearly labelled. */}
      <section>
        <h2 className="text-base font-semibold mb-3">
          {t(lang, "Coming soon", "Próximamente")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Placeholder
            title={t(
              lang,
              "Waste & expiry risk",
              "Riesgo de merma y caducidad"
            )}
            body={t(
              lang,
              "Will appear once inventory and expiry data are wired in.",
              "Aparecerá cuando conectemos inventario y caducidad."
            )}
          />
          <Placeholder
            title={t(lang, "Invoice OCR", "OCR de facturas")}
            body={t(
              lang,
              `Invoice reading will connect supplier invoices to your ${rowCount.toLocaleString("es-MX")} sales rows and cost data. Still in design.`,
              `La lectura de facturas conectará las facturas de proveedores con tus ${rowCount.toLocaleString("es-MX")} filas de ventas y costos. Todavía está en diseño.`
            )}
          />
        </div>
      </section>
    </div>
  );
}

function SetupTab({
  profitability,
  lang,
}: {
  profitability: ProfitabilityData;
  lang: PreferredLanguage;
}) {
  return (
    <div className="space-y-6">
      <RestaurantSetupChecklist
        setupCounts={profitability.setupCounts}
        dataQuality={profitability.dataQuality}
      />
      <DataQualityChecklistSection data={profitability} />
      {/* Pull two of the most actionable lists into this tab so the user
          can see what's actually blocking margin computation. */}
      <section>
        <h2 className="text-base font-semibold mb-3">
          {t(lang, "What's blocking margin", "Qué está bloqueando el margen")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SetupIssueList
            title={t(
              lang,
              "Missing recipes (high volume)",
              "Recetas faltantes (alto volumen)"
            )}
            empty={t(
              lang,
              "Every selling item has a recipe.",
              "Todos los platillos que se venden ya tienen receta."
            )}
            items={profitability.missingRecipeHighVolume.map((r) => ({
              key: r.menu_item_id,
              title: r.name,
              detail: t(
                lang,
                `${r.units_sold.toLocaleString("es-MX")} units sold`,
                `${r.units_sold.toLocaleString("es-MX")} unidades vendidas`
              ),
            }))}
          />
          <SetupIssueList
            title={t(
              lang,
              "Unit mismatches blocking costing",
              "Unidades que no coinciden y bloquean el costo"
            )}
            empty={t(
              lang,
              "No recipes blocked by unit mismatch.",
              "Ninguna receta está bloqueada por unidades."
            )}
            items={profitability.marginRows
              .filter((r) => r.cost.status === "missing_unit_conversion")
              .map((r) => ({
                key: r.menu_item_id,
                title: r.name,
                detail:
                  r.cost.issues[0]?.message ??
                  t(lang, "Unit mismatch", "Unidades que no coinciden"),
              }))}
          />
        </div>
      </section>
    </div>
  );
}

function SetupIssueList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; title: string; detail: string }[];
}) {
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-medium">{title}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 py-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 10).map((it) => (
            <li key={it.key} className="px-4 py-2.5">
              <div className="text-sm font-medium">{it.title}</div>
              <div className="text-xs text-muted-foreground">{it.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-5">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
    </div>
  );
}

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

export default async function RestaurantCockpitPage({
  searchParams,
}: {
  // Next.js 15+/16: searchParams is a Promise in a page Server Component.
  searchParams: Promise<{ location?: string; period?: string }>;
}) {
  const { location: requestedLocationId, period } = await searchParams;
  const { data, targets, profitability, executive, periodPreset } =
    await loadCockpitExecutivePage(requestedLocationId, period);

  if (data.mode === "live") {
    return (
      <LiveRestaurantView
        data={data}
        targets={targets}
        profitability={profitability}
        executive={executive}
        periodPreset={periodPreset}
      />
    );
  }
  return <SampleRestaurantView reason={data.reason} />;
}
