// app/dashboard/restaurant/menu/page.tsx
//
// Menú › Resumen (R1-09b): "Configura tu menú", 4 KPIs and the dish table,
// all from the shared dish-economics loader. A company with no Odoo
// product (CSV uploads only) keeps the legacy table until it is migrated
// (docs/master-data-audit.md, CSV bridge).

import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { loadMenuAreaModel } from "@/lib/restaurant/cockpit-page-data";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { EmptyState } from "@/components/restaurant/shell/EmptyState";
import { COSTS_HREF } from "@/lib/restaurant/navigation";
import { CONNECT_DATA_PATH } from "@/lib/restaurant/post-login";
import { MenuProfitabilityTab } from "@/components/restaurant/cockpit/MenuProfitabilityTab";
import {
  MenuWorkspacePage,
  type MenuWorkspaceSearchParams,
} from "@/components/restaurant/menu/MenuWorkspacePage";

export const dynamic = "force-dynamic";

export default async function MenuResumenPage({
  searchParams,
}: {
  searchParams: Promise<MenuWorkspaceSearchParams>;
}) {
  const params = await searchParams;
  const auth = await authAndCompany();
  if (auth.ok) {
    // A failed read must not take the page down: fall through to the
    // workspace, which shows its own message.
    let economics: Awaited<ReturnType<typeof loadDishEconomics>> | null = null;
    try {
      economics = await loadDishEconomics(
        auth.companyId,
        params.from ?? null,
        params.to ?? null,
        params.location ?? null
      );
    } catch (err) {
      console.error(
        "[menu page] dish economics failed:",
        err instanceof Error ? (err.stack ?? err.message) : err
      );
    }
    if (economics?.ok && !economics.result.uses_pos_products) {
      const [{ lang }, { profitability }] = await Promise.all([
        loadRestaurantShellChrome(),
        loadMenuAreaModel(params.location),
      ]);
      // A brand-new account (no POS products, no sales): say how to start
      // instead of a screen of $0.
      const nothingYet =
        !profitability ||
        (profitability.kpis.revenue_total <= 0 &&
          profitability.marginRows.length === 0 &&
          (profitability.setupCounts?.pos_sales_count ?? 0) === 0);
      if (nothingYet) {
        return (
          <EmptyState
            testId="menu-empty"
            text="Aún no tienes platos. Conecta tu POS o sube un archivo de costos y Milton arma tu menú."
            actions={[
              {
                href: CONNECT_DATA_PATH,
                label: "Conecta tu POS",
                primary: true,
              },
              {
                href: `${COSTS_HREF}#costos-ultimo-archivo`,
                label: "Sube tus costos",
              },
            ]}
          />
        );
      }
      return <MenuProfitabilityTab profitability={profitability} lang={lang} />;
    }
  }
  return <MenuWorkspacePage view="resumen" params={params} />;
}
