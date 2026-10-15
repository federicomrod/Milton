// Server half of the Menú tabs that share the recipe workspace (Resumen,
// Platos, Preparaciones). Auth and company are cached per request; the
// tab passes its own view so only that tab's data is built.

import { Suspense } from "react";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace-server";
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
    return (
      <p className="text-sm text-[#5b6476]">
        Conecta tu cuenta a una empresa para armar recetas y costos.
      </p>
    );
  }
  const selected =
    params.producto && Number.isInteger(Number(params.producto))
      ? Number(params.producto)
      : null;
  const loaded = await loadRecipeCostingWorkspace(auth.supabase, {
    companyId: auth.companyId,
    userId: auth.userId,
    view,
    locationId: params.location ?? null,
    startDate: params.from ?? null,
    endDate: params.to ?? null,
    selectedOdooProductId: selected,
  });
  if (!loaded.ok) {
    return <p className="text-sm text-red-700">{loaded.error}</p>;
  }
  return (
    <Suspense fallback={null}>
      <RecipesCostingWorkspace initial={loaded.workspace} view={view} />
    </Suspense>
  );
}
