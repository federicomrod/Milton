// Server half of the Menú tabs that share the recipe workspace (Resumen,
// Platos, Preparaciones). Auth and company are cached per request; the
// tab passes its own view so only that tab's data is built.

import { Suspense } from "react";
import { getDictionary } from "@/lib/i18n";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace-server";
import { loadDishEstimates } from "@/lib/restaurant/menu-reading/estimate-store";
import { RecipesCostingWorkspace } from "@/components/restaurant/recipes-costing/RecipesCostingWorkspace";

export type MenuWorkspaceSearchParams = {
  location?: string;
  producto?: string;
  from?: string;
  to?: string;
};

export async function MenuWorkspacePage({
  view,
  params,
}: {
  view: "resumen" | "plato" | "preparaciones";
  params: MenuWorkspaceSearchParams;
}) {
  const auth = await authAndCompany();
  if (!auth.ok) {
    const d = getDictionary(await apiLanguage()).menu.screens;
    return (
      <p className="text-sm text-[#5b6476]">{d.workspace.connectCompany}</p>
    );
  }
  const selected =
    params.producto && Number.isInteger(Number(params.producto))
      ? Number(params.producto)
      : null;
  // «Estimado por Milton» (#212): read APART from the dish economics and never
  // passed into the costing code. A missing table (062) reads as "no estimates"
  // and the screens look exactly as before.
  const [loaded, estimateLoad] = await Promise.all([
    loadRecipeCostingWorkspace(auth.supabase, {
      companyId: auth.companyId,
      userId: auth.userId,
      view,
      locationId: params.location ?? null,
      startDate: params.from ?? null,
      endDate: params.to ?? null,
      selectedOdooProductId: selected,
    }),
    view === "preparaciones"
      ? Promise.resolve(null)
      : loadDishEstimates(auth.supabase, auth.companyId).catch(() => null),
  ]);
  if (!loaded.ok) {
    return <p className="text-sm text-red-700">{loaded.error}</p>;
  }
  const location = params.location ?? null;
  const estimates =
    estimateLoad && estimateLoad.ok
      ? estimateLoad.rows.filter(
          (row) => !location || !row.location_id || row.location_id === location
        )
      : [];
  return (
    <Suspense fallback={null}>
      <RecipesCostingWorkspace
        initial={loaded.workspace}
        view={view}
        estimates={estimates}
      />
    </Suspense>
  );
}
