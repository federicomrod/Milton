import { Suspense } from "react";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { t } from "@/lib/restaurant/language";
import { RecipesCostingWorkspace } from "@/components/restaurant/recipes-costing/RecipesCostingWorkspace";
import { MenuAreaTabs } from "@/components/restaurant/recipes-costing/MenuAreaTabs";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  loadRecipeCostingWorkspace,
  parseCostingView,
} from "@/lib/restaurant/recipe-costing/workspace-server";

export const dynamic = "force-dynamic";

export default async function RecetasCosteoPage({
  searchParams,
}: {
  searchParams: Promise<{
    location?: string;
    vista?: string;
    producto?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const { lang } = await loadRestaurantShellChrome();
  const auth = await authAndCompany();
  if (!auth.ok) {
    return (
      <div className="w-full px-6 pt-3 lg:px-10">
        <OperatingPageHeader title={t(lang, "Menu", "Menú")} lang={lang} />
        <Suspense fallback={null}>
          <MenuAreaTabs lang={lang} active="recetas" />
        </Suspense>
        <p className="mt-6 text-sm text-muted-foreground">
          Conecta tu cuenta a una empresa para armar recetas y costos.
        </p>
      </div>
    );
  }

  const selected =
    params.producto && Number.isInteger(Number(params.producto))
      ? Number(params.producto)
      : null;
  const loaded = await loadRecipeCostingWorkspace(auth.supabase, {
    companyId: auth.companyId,
    userId: auth.userId,
    view: parseCostingView(params.vista ?? null),
    locationId: params.location ?? null,
    startDate: params.from ?? null,
    endDate: params.to ?? null,
    selectedOdooProductId: selected,
  });

  return (
    <div className="w-full pt-3">
      <div className="px-6 lg:px-10">
        <OperatingPageHeader title={t(lang, "Menu", "Menú")} lang={lang} />
        <Suspense fallback={null}>
          <MenuAreaTabs lang={lang} active="recetas" />
        </Suspense>
      </div>
      {loaded.ok ? (
        <Suspense fallback={null}>
          <RecipesCostingWorkspace initial={loaded.workspace} />
        </Suspense>
      ) : (
        <p className="px-6 pt-6 text-sm text-red-700 lg:px-10">
          {loaded.error}
        </p>
      )}
    </div>
  );
}
