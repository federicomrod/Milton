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
    const economics = await loadDishEconomics(
      auth.companyId,
      params.from ?? null,
      params.to ?? null,
      params.location ?? null
    );
    if (economics.ok && !economics.result.uses_pos_products) {
      const [{ lang }, { profitability }] = await Promise.all([
        loadRestaurantShellChrome(),
        loadMenuAreaModel(params.location),
      ]);
      return profitability ? (
        <MenuProfitabilityTab profitability={profitability} lang={lang} />
      ) : null;
    }
  }
  return <MenuWorkspacePage view="resumen" params={params} />;
}
