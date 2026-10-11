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
import {
  TrendingDown,
  AlertTriangle,
  ShieldAlert,
  Info,
} from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type TargetMap,
} from "@/lib/restaurant/supabase-targets";
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
import {
  type ProfitabilityData,
} from "@/lib/restaurant/profitability-server";
import { PAGINATED_READ_SAFETY_CAP } from "@/lib/restaurant/paginated-read";
import { loadCockpitPageModel } from "@/lib/restaurant/cockpit-page-data";
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
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  DataHealthBanner,
  DataHealthIndicator,
} from "@/components/restaurant/shell/DataHealthIndicator";
import { BriefingCard } from "@/components/restaurant/BriefingCard";
import { RestaurantSetupChecklist } from "@/components/restaurant/RestaurantSetupChecklist";
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

function cockpitSampleCopy(reason?: SampleReason): string {
  const sampleCopyByReason: Record<SampleReason, string> = {
    unauthenticated:
      "Using sample pilot data — sign in to see your own data. Upload POS sales to see live revenue and item performance.",
    no_company:
      "Using sample pilot data — no company is linked to your account yet. Upload POS sales after a company is provisioned.",
    no_sales:
      "Using sample pilot data. Upload POS sales to see live revenue and item performance.",
    supabase_error:
      "Using sample pilot data — could not reach Supabase. Try refreshing the page.",
    env_missing:
      "Using sample pilot data — Supabase is not configured in this environment.",
  };
  return reason
    ? sampleCopyByReason[reason]
    : sampleCopyByReason.no_sales;
}

function CockpitDataHealth({
  lang,
  mode,
  reason,
  data,
  profitability,
}: {
  lang: PreferredLanguage;
  mode: "live" | "sample";
  reason?: SampleReason;
  data?: Extract<RestaurantDashboardData, { mode: "live" }>;
  profitability?: ProfitabilityData | null;
}) {
  // System-language banners stay available here (not in the header).
  // "Using uploaded POS data from Supabase. Recipe costing is pending until menu items, recipes, and supplier costs are linked."
  const liveCopy =
    "Using uploaded POS data from Supabase. Recipe costing is pending until menu items, recipes, and supplier costs are linked.";
  let tone: "ok" | "warn" | "error" = mode === "live" ? "ok" : "warn";
  if (data?.readError || profitability?.readError) tone = "error";
  else if (profitability && profitability.kpis.cost_coverage_pct === 0) {
    tone = "warn";
  }

  return (
    <DataHealthIndicator lang={lang} tone={tone}>
      {mode === "sample" ? (
        <DataHealthBanner tone="warn">{cockpitSampleCopy(reason)}</DataHealthBanner>
      ) : data?.readError || profitability?.readError ? (
        <DataHealthBanner tone="error">
          Could not load all sales rows. Totals are unavailable — they are
          not a smaller number from a partial read. Try refreshing the page.
        </DataHealthBanner>
      ) : profitability && profitability.kpis.cost_coverage_pct === 0 ? (
        <DataHealthBanner tone="warn">
          Sales data is loaded ({data?.rowCount.toLocaleString("es-MX")} row
          {data?.rowCount === 1 ? "" : "s"}). Costing is pending until
          ingredient costs and recipes are linked.
        </DataHealthBanner>
      ) : (
        <DataHealthBanner tone="ok">
          {data?.rowCount.toLocaleString("es-MX")} POS sale row
          {data?.rowCount === 1 ? "" : "s"} loaded from Supabase. Items with
          missing recipes or unit mismatches are flagged rather than
          estimated.
        </DataHealthBanner>
      )}
      {mode === "live" ? (
        <p className="text-xs text-muted-foreground">{liveCopy}</p>
      ) : null}
      <p className="text-xs">
        <Link
          href="/dashboard/restaurant/upload"
          className="font-medium text-primary hover:underline"
        >
          Import POS Sales
        </Link>
      </p>
    </DataHealthIndicator>
  );
}

// ---------------------------------------------------------------------------
// Live (real-data) view
// ---------------------------------------------------------------------------

function LiveRestaurantView({
  data,
  targets,
  profitability,
}: {
  data: Extract<RestaurantDashboardData, { mode: "live" }>;
  /** Daily KPI targets for the same company; empty when nothing is set. */
  targets: TargetMap;
  /** Profitability aggregate; null when the load failed (we still render
   *  the POS explorer so the page degrades cleanly). */
  profitability: ProfitabilityData | null;
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
          label: "Overview",
          content: (
            <OverviewTab
              profitability={profitability}
              rowCount={data.rowCount}
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
          label: "Suppliers & Costs",
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
          label: "Setup / Data Quality",
          badge: setupOutstanding > 0 ? String(setupOutstanding) : undefined,
          content: <SetupTab profitability={profitability} />,
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
        <OperatingPageHeader title={t(lang, "Cockpit", "Cockpit")} lang={lang} />
        <CockpitDataHealth
          lang={lang}
          mode="live"
          data={data}
          profitability={profitability}
        />

        <CockpitKpiStrip
          cockpit={data.cockpit}
          lang={lang}
          foodCostPct={profitability?.kpis.food_cost_pct ?? null}
          marginPct={profitability?.kpis.estimated_gross_margin_pct ?? null}
          hasRecipeCosts={(profitability?.kpis.cost_coverage_pct ?? 0) > 0}
        />

        {(data.truncated || profitability?.truncated) && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 p-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Totals may be incomplete. This view stopped after{" "}
              {PAGINATED_READ_SAFETY_CAP.toLocaleString("en-US")} rows (safety
              cap). Shown KPIs are partial.
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
}: {
  profitability: ProfitabilityData;
  rowCount: number;
}) {
  return (
    <div className="space-y-8">
      <RestaurantSetupChecklist
        setupCounts={profitability.setupCounts}
        dataQuality={profitability.dataQuality}
      />
      <BriefingCard />
      <ProfitabilityKpisSection data={profitability} />

      {/* Two-column overview panel: top items + supplier price alerts */}
      <section>
        <h2 className="text-base font-semibold mb-3">Today&apos;s attention</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ItemsNeedingAttention data={profitability} />
          <SupplierPriceAlerts data={profitability} />
        </div>
      </section>

      {/* Margin risk (compact: 2 most actionable cards on Overview) */}
      <MarginRiskSection data={profitability} compact />

      {/* Placeholders for future signals — clearly labelled. */}
      <section>
        <h2 className="text-base font-semibold mb-3">Coming soon</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Placeholder
            title="Waste &amp; expiry risk"
            body="Will appear once inventory and expiry data are wired in."
          />
          <Placeholder
            title="Invoice OCR"
            body={`Invoice ingestion will plug supplier invoices directly into your ${rowCount.toLocaleString("es-MX")} POS rows + cost data. Currently in design.`}
          />
        </div>
      </section>
    </div>
  );
}

function SetupTab({ profitability }: { profitability: ProfitabilityData }) {
  return (
    <div className="space-y-6">
      <DataQualityChecklistSection data={profitability} />
      {/* Pull two of the most actionable lists into this tab so the user
          can see what's actually blocking margin computation. */}
      <section>
        <h2 className="text-base font-semibold mb-3">
          What&apos;s blocking margin
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SetupIssueList
            title="Missing recipes (high volume)"
            empty="Every selling item has a recipe."
            items={profitability.missingRecipeHighVolume.map((r) => ({
              key: r.menu_item_id,
              title: r.name,
              detail: `${r.units_sold.toLocaleString("es-MX")} units sold`,
            }))}
          />
          <SetupIssueList
            title="Unit mismatches blocking costing"
            empty="No recipes blocked by unit mismatch."
            items={profitability.marginRows
              .filter((r) => r.cost.status === "missing_unit_conversion")
              .map((r) => ({
                key: r.menu_item_id,
                title: r.name,
                detail: r.cost.issues[0]?.message ?? "Unit mismatch",
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
        <OperatingPageHeader title="Cockpit" />
        <CockpitDataHealth lang="en" mode="sample" reason={reason} />

        {/* KPIs */}
        <section>
          <h2 className="text-base font-semibold mb-3">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              label="Total Revenue"
              value={fmts.int.format(overview.total_revenue)}
              sub={overview.currency}
            />
            <KpiCard
              label="Total Orders"
              value={overview.total_orders.toLocaleString(fmts.numLocale)}
              sub="unique checks"
            />
            <KpiCard
              label="Units Sold"
              value={overview.total_units_sold.toLocaleString(fmts.numLocale)}
              sub="dishes"
            />
            <KpiCard
              label="Avg Ticket"
              value={fmts.int.format(overview.avg_ticket)}
              sub="per order"
            />
            <KpiCard
              label="Food Cost"
              value={fmtPct(overview.food_cost_pct)}
              sub={fmts.int.format(overview.food_cost_amount)}
            />
            <KpiCard
              label="Gross Margin"
              value={fmtPct(overview.gross_margin_pct)}
              sub={fmts.int.format(overview.gross_margin_amount)}
            />
          </div>
          {criticalCount > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                {criticalCount} critical alert{criticalCount > 1 ? "s" : ""}{" "}
                require your attention — see recommendations below.
              </span>
            </div>
          )}
        </section>

        {/* Dish profitability — kept ONLY in sample mode. */}
        <section>
          <h2 className="text-base font-semibold mb-3">Dish Profitability</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left">
                      <th className="p-3 font-medium">Item</th>
                      <th className="p-3 font-medium text-right">Price</th>
                      <th className="p-3 font-medium text-right">Est. Cost</th>
                      <th className="p-3 font-medium text-right">
                        Gross Profit
                      </th>
                      <th className="p-3 font-medium text-right">Margin %</th>
                      <th className="p-3 font-medium text-right">
                        Food Cost %
                      </th>
                      <th className="p-3 font-medium">Status</th>
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
                                ? "No recipe"
                                : "Missing cost"}
                            </span>
                          ) : item.gross_margin_pct < 60 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                              Low margin
                            </span>
                          ) : (
                            <span className="text-xs text-green-600 dark:text-green-400">
                              OK
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
          <h2 className="text-base font-semibold mb-3">Top Margin Dishes</h2>
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
                    FC {fmtPct(item.food_cost_pct)} · Cost{" "}
                    {item.calculated_cost !== null
                      ? fmts.dec2.format(item.calculated_cost)
                      : "—"}{" "}
                    · Price {fmts.dec2.format(item.selling_price)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Margin risk */}
        {(lowItems.length > 0 || unknownItems.length > 0) && (
          <section>
            <h2 className="text-base font-semibold mb-3">Margin Risk</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lowItems.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-900">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      Low Margin Items (&lt;60%)
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
                      Unknown Cost Items
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
            Recommendations{" "}
            <span className="text-muted-foreground font-normal text-sm">
              ({openRecs.length} open)
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
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: requestedLocationId } = await searchParams;
  const { data, targets, profitability } =
    await loadCockpitPageModel(requestedLocationId);

  if (data.mode === "live") {
    return (
      <LiveRestaurantView
        data={data}
        targets={targets}
        profitability={profitability}
      />
    );
  }
  return <SampleRestaurantView reason={data.reason} />;
}
