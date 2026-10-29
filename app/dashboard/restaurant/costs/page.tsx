// app/dashboard/restaurant/costs/page.tsx
//
// Costos (R1-09b, A9/D6): four KPIs and three real tabs on one route —
// Costos fijos (default, first tab), Cambios de precio (?tab=precios), Compras (?tab=compras, the invoices UI) and
// Proveedores (?tab=proveedores, the suppliers UI). The old /invoices and
// /suppliers URLs redirect here.

import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import Link from "next/link";
import { loadMenuAreaModel } from "@/lib/restaurant/cockpit-page-data";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import {
  loadCostsKpiExtras,
  loadInvoicesTabData,
  loadLatestInvoices,
  loadSuppliersTabData,
} from "@/lib/restaurant/costs-page-data";
import {
  costsTabHref,
  invoiceUploadHref,
  parseCostsTab,
  pctChange,
  priceIncreaseCount,
  shellParamsOf,
} from "@/lib/restaurant/costs-tabs";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import {
  CostsAreaTabs,
  CostsKpiCard,
  PriceChangesTable,
} from "@/components/restaurant/costs/CostsArea";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { CostsFileWorkspace } from "@/components/restaurant/costs/CostsFileWorkspace";
import {
  CostsPageLayout,
  CostsMainColumn,
  CostsRightColumn,
  CostsContentWrapper,
} from "@/components/restaurant/costs/CostsPageLayout";
import { InvoicesPage } from "@/components/restaurant/InvoicesPage";
import { SuppliersPage } from "@/components/restaurant/SuppliersPage";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { FixedCostsTab } from "@/components/restaurant/costs/FixedCostsTab";
import {
  listFixedCostHistory,
  loadFixedCostsView,
  monthSalesByLocation,
  repeatFixedCosts,
} from "@/lib/restaurant/fixed-costs-server";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";
import { loadMonthMargin } from "@/lib/restaurant/rentabilidad-server";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { createClient } from "@/lib/supabase/server";
import { capabilityFlags, resolveActor } from "@/lib/auth/permissions";
import { COSTS_FILE_ANCHOR } from "@/lib/restaurant/costs-picker";
import { ingredientesHref } from "@/lib/restaurant/menu-links";
import { EmptyState } from "@/components/restaurant/shell/EmptyState";
import {
  CostsDesktopRightColumn,
  CostsMobileBannerHost,
  CostsMobileBelow,
  CostsTabletCardsRow,
} from "@/components/restaurant/costs/CostsDesktopRightColumn";

export const dynamic = "force-dynamic";

/** The server's can("prices.edit") answer for the signed-in person. */
async function canEditPricesForUser(): Promise<boolean> {
  try {
    const user = await getCachedAuthUser();
    if (!user?.id) return false;
    const companyId = await getCachedCompanyId(user.id);
    if (!companyId) return false;
    const supabase = await createClient();
    const actor = await resolveActor(supabase, user.id, { companyId });
    return capabilityFlags(actor)["prices.edit"];
  } catch {
    return false;
  }
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CostsAreaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tab = parseCostsTab(params.tab);
  const location =
    typeof params.location === "string" ? params.location : undefined;
  const shellParams = shellParamsOf(params);

  // Every read here is best-effort: a brand-new account (no restaurant, POS,
  // ingredients or costs) or a failed read must render the empty state, never
  // the white Next.js error screen. The stack is logged for the server logs.
  let lang: PreferredLanguage = "es";
  let companyId: string | null = null;
  try {
    // For remembering the setup detail open / closed per company (cached per request).
    const user = await getCachedAuthUser();
    companyId = user?.id ? await getCachedCompanyId(user.id) : null;
  } catch {
    companyId = null;
  }
  let profitability: Awaited<
    ReturnType<typeof loadMenuAreaModel>
  >["profitability"] = null;
  let extras: Awaited<ReturnType<typeof loadCostsKpiExtras>> = null;
  let latestInvoices: Awaited<ReturnType<typeof loadLatestInvoices>> = null;
  try {
    const [chrome, menu, kpiExtras, latest] = await timeCockpitStep(
      "costs-route",
      () =>
        Promise.all([
          loadRestaurantShellChrome(),
          loadMenuAreaModel(location),
          loadCostsKpiExtras(),
          loadLatestInvoices(),
        ]),
      { location: location ?? null, tab }
    );
    lang = chrome.lang;
    profitability = menu.profitability;
    extras = kpiExtras;
    latestInvoices = latest;
  } catch (err) {
    console.error(
      "[costs page] load failed:",
      err instanceof Error ? (err.stack ?? err.message) : err
    );
  }

  const kpis = profitability?.kpis ?? null;
  const currency = kpis?.currency ?? extras?.currency ?? "USD";
  const trends = Array.isArray(profitability?.ingredientPriceTrends)
    ? (profitability?.ingredientPriceTrends ?? [])
    : [];
  const increases = priceIncreaseCount(trends);
  const ingredientsCount =
    profitability?.setupCounts?.ingredients_count ?? null;
  const foodCost = kpis?.food_cost_pct ?? null;
  // «n% de las ventas con costo» only when there ARE sales; never a made-up 0%.
  const coveragePct =
    kpis &&
    Number.isFinite(kpis.cost_coverage_pct) &&
    (kpis.revenue_total ?? 0) > 0
      ? kpis.cost_coverage_pct
      : null;
  const purchases = extras?.purchases ?? { last30: null, previous30: null };
  const purchasesDelta = pctChange(purchases.last30, purchases.previous30);
  const supplierCount =
    extras?.supplierCount ??
    // total_supplier_spend null = purchase refs unreadable: the list is empty
    // on purpose, so the count is unknown («—»), not 0.
    (profitability && profitability.total_supplier_spend !== null
      ? profitability.topSupplierSpend?.length
      : null) ??
    null;
  const pendingSuppliers = extras?.suppliersWithPendingInvoices ?? null;
  // Nothing at all yet: say how to start (the setup section above is the upload).
  const nothingYet =
    (ingredientsCount ?? 0) === 0 &&
    trends.length === 0 &&
    (supplierCount ?? 0) === 0 &&
    !purchases.last30;

  return (
    <CostsPageLayout>
      <OperatingPageHeader
        title={t(lang, "Costs", "Costos")}
        lang={lang}
        showDateRange={false}
        titleAction={
          <Link
            href={invoiceUploadHref(shellParams)}
            className="inline-flex h-8 items-center rounded-lg border border-[#1B40C8] bg-white px-3 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
          >
            {t(lang, "Upload invoice", "Subir factura")}
          </Link>
        }
      />

      <CostsContentWrapper>
        <CostsMainColumn>
          {/* KPIs: 2x2 on mobile, 4 in a row on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CostsKpiCard
              label={t(lang, "Purchases · 30 days", "Compras · 30 días")}
              value={formatMoney(purchases.last30, currency)}
              delta={
                purchasesDelta === null
                  ? t(lang, "No prior month to compare", "Sin mes anterior")
                  : t(
                      lang,
                      `${purchasesDelta >= 0 ? "+" : ""}${purchasesDelta.toFixed(0)}% vs previous 30 days`,
                      `${purchasesDelta >= 0 ? "+" : ""}${purchasesDelta.toFixed(0)}% vs. 30 días anteriores`
                    )
              }
              deltaTone={
                purchasesDelta === null
                  ? "neutral"
                  : purchasesDelta > 0
                    ? "bad"
                    : "good"
              }
            />
            <CostsKpiCard
              label={t(lang, "Food cost", "Costo de comida")}
              value={
                foodCost === null || !Number.isFinite(foodCost)
                  ? t(lang, "No price", "Sin precio")
                  : `${foodCost.toFixed(1)}%`
              }
              delta={
                coveragePct !== null
                  ? t(
                      lang,
                      `${coveragePct.toFixed(0)}% of sales costed`,
                      `${coveragePct.toFixed(0)}% de las ventas con costo`
                    )
                  : t(lang, "No sales yet", "Aún sin ventas")
              }
              help={t(
                lang,
                "Recipe cost ÷ sales, only for dishes with a full cost.",
                "Costo de receta ÷ ventas, solo platos con costo completo."
              )}
            />
            <CostsKpiCard
              label={t(lang, "Prices that went up", "Precios que subieron")}
              value={profitability ? String(increases) : "—"}
              delta={
                ingredientsCount === null
                  ? "—"
                  : t(
                      lang,
                      `of ${ingredientsCount} ingredients`,
                      `de ${ingredientsCount} ingredientes`
                    )
              }
              deltaTone={increases > 0 ? "bad" : "neutral"}
            />
            <CostsKpiCard
              label={t(lang, "Suppliers", "Proveedores")}
              value={supplierCount === null ? "—" : String(supplierCount)}
              delta={
                pendingSuppliers === null
                  ? "—"
                  : pendingSuppliers === 0
                    ? t(lang, "No pending invoices", "Sin facturas pendientes")
                    : t(
                        lang,
                        `${pendingSuppliers} with pending invoices`,
                        `${pendingSuppliers} con facturas pendientes`
                      )
              }
              deltaTone={pendingSuppliers ? "bad" : "neutral"}
              href={
                pendingSuppliers
                  ? costsTabHref("compras", shellParams)
                  : undefined
              }
            />
          </div>

          {nothingYet ? (
            <EmptyState
              testId="costs-empty"
              text="Aún no tienes costos. Sube un archivo de costos o una factura para empezar."
              actions={[
                {
                  href: costsTabHref("precios", {}, COSTS_FILE_ANCHOR),
                  label: "Subir archivo de costos",
                  primary: true,
                  opensCostsPicker: true,
                },
                {
                  href: invoiceUploadHref(shellParams),
                  label: "Subir factura",
                },
              ]}
            />
          ) : null}

          <CostsMobileBannerHost locationId={location ?? null} />

          <CostsAreaTabs active={tab} lang={lang} shellParams={shellParams} />

          {tab === "costos-fijos" ? null : (
            <CostsFileWorkspace
              locationId={location ?? null}
              companyId={companyId}
            />
          )}

          {tab === "precios" ? (
            profitability ? (
              <PriceChangesTable trends={trends} lang={lang} />
            ) : (
              <NotAvailableYet
                lang={lang}
                reason={t(
                  lang,
                  "Ingredient prices required",
                  "Hacen falta precios de ingredientes"
                )}
                href={ingredientesHref()}
                linkLabel={t(lang, "Add prices →", "Agregar precios →")}
              />
            )
          ) : tab === "compras" ? (
            <ComprasTab lang={lang} />
          ) : tab === "costos-fijos" ? (
            <CostosFijosTab
              lang={lang}
              location={location}
              month={
                typeof params.month === "string" ? params.month : undefined
              }
              shellParams={shellParams}
            />
          ) : (
            <ProveedoresTab lang={lang} />
          )}

          <CostsTabletCardsRow
            latestInvoices={latestInvoices}
            locationId={location ?? null}
            shellParams={shellParams}
          />

          <CostsMobileBelow
            latestInvoices={latestInvoices}
            locationId={location ?? null}
            shellParams={shellParams}
          />
        </CostsMainColumn>

        {/* Desktop right column: sticky compact cards */}
        <CostsRightColumn>
          <CostsDesktopRightColumn
            latestInvoices={latestInvoices}
            locationId={location ?? null}
            shellParams={shellParams}
          />
        </CostsRightColumn>
      </CostsContentWrapper>
    </CostsPageLayout>
  );
}

function SignInNote({ lang }: { lang: PreferredLanguage }) {
  return (
    <p className="text-sm text-[#6b7385]">
      {t(
        lang,
        "Sign in and pick a company.",
        "Inicia sesión y elige una empresa."
      )}
    </p>
  );
}

async function ComprasTab({ lang }: { lang: PreferredLanguage }) {
  // The permission read does not depend on the tab data: run both together.
  const [data, canEditPrices] = await Promise.all([
    loadInvoicesTabData(),
    canEditPricesForUser(),
  ]);
  if (!data) return <SignInNote lang={lang} />;
  return (
    <InvoicesPage
      initialInvoices={data.invoices}
      suppliers={data.suppliers}
      ingredients={data.ingredients}
      companyCurrency={data.companyCurrency}
      canEditPrices={canEditPrices}
    />
  );
}

async function ProveedoresTab({ lang }: { lang: PreferredLanguage }) {
  const [suppliers, canEditPrices] = await Promise.all([
    loadSuppliersTabData(),
    canEditPricesForUser(),
  ]);
  if (!suppliers) return <SignInNote lang={lang} />;
  return <SuppliersPage suppliers={suppliers} canEditPrices={canEditPrices} />;
}

async function CostosFijosTab({
  lang,
  location,
  month: monthParam,
  shellParams,
}: {
  lang: PreferredLanguage;
  location: string | undefined;
  month: string | undefined;
  shellParams: SearchParams;
}) {
  const user = await getCachedAuthUser();
  const companyId = user?.id ? await getCachedCompanyId(user.id) : null;
  if (!user?.id || !companyId) return <SignInNote lang={lang} />;
  const supabase = await createClient();
  const actor = await resolveActor(supabase, user.id, { companyId });
  if (!capabilityFlags(actor)["costs.fixed"])
    return (
      <p className="text-sm text-[#6b7385]">
        Tu rol no puede ver ni cambiar los costos fijos.
      </p>
    );

  const currentMonth = monthStartOf(new Date()) as string;
  const requested = monthParam ? monthStartOf(monthParam) : null;
  const month =
    requested && requested <= currentMonth ? requested : currentMonth;
  const ctx = { supabase, companyId, userId: user.id };
  try {
    const context = await resolveRestaurantContext(
      supabase,
      companyId,
      location
    );
    // Idempotent: copies «repetir cada mes» lines only where the month is empty.
    await repeatFixedCosts(ctx, month).catch((err) =>
      console.error("[costs page] fixed-costs repeat failed:", err)
    );
    const locationId = context.selected?.locationId ?? null;
    const splitSales = locationId
      ? null
      : await monthSalesByLocation(supabase, companyId, month).catch(
          () => new Map<string, number>()
        );
    const marginRead = await loadMonthMargin({
      supabase,
      companyId,
      locationId,
      restaurantIds: context.locations.map((l) => l.id),
      month,
    });
    const [view, history] = await Promise.all([
      loadFixedCostsView(ctx, {
        month,
        locationId,
        brandId: context.selected?.brandId ?? null,
        restaurantIds: context.locations.map((l) => l.id),
        marginRead,
      }),
      listFixedCostHistory(supabase, companyId, { locationId, month }),
    ]);
    return (
      <FixedCostsTab
        key={`${month}|${locationId ?? "group"}`}
        view={view}
        history={history}
        locationName={
          context.locations.find((l) => l.id === locationId)?.name ?? null
        }
        shellParams={shellParams}
        currentMonth={currentMonth}
        splitTargets={
          splitSales
            ? context.locations.map((l) => ({
                location_id: l.id,
                name: l.name,
                sales: splitSales.get(l.id) ?? null,
              }))
            : []
        }
      />
    );
  } catch (err) {
    console.error("[costs page] fixed-costs load failed:", err);
    return (
      <p className="text-sm text-[#6b7385]">
        No se pudieron leer los costos fijos. Recarga la página.
      </p>
    );
  }
}
