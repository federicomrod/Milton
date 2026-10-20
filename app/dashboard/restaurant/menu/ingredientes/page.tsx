// app/dashboard/restaurant/menu/ingredientes/page.tsx
//
// Menú › Ingredientes (R1-09b, A6/D7): list + detail. The layout renders
// the header and tabs; this page only loads the tab's data. Prices come
// from ingredient_cost_entries (fetchIngredientLatestCosts); "Se usa en"
// comes from loadIngredientUsage (one list for the counters and the detail).

import { createClient } from "@/lib/supabase/server";
import { capabilityFlags, resolveActor } from "@/lib/auth/permissions";
import type { Capability } from "@/lib/auth/capabilities";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { fetchIngredientLatestCosts } from "@/lib/restaurant/menu-recipes-server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  loadDuplicateState,
  type DuplicateState,
} from "@/lib/restaurant/ingredient-duplicates-server";
import { loadIngredientUsage } from "@/lib/restaurant/ingredient-usage-server";
import { usageState } from "@/lib/restaurant/ingredient-usage";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import { parseIngredientesFilter } from "@/lib/restaurant/ingredientes-screen";
import {
  IngredientesScreen,
  type IngredienteItem,
  type SupplierOption,
} from "@/components/restaurant/menu/IngredientesScreen";

export const dynamic = "force-dynamic";

type LoadResult =
  | {
      kind: "data";
      items: IngredienteItem[];
      suppliers: SupplierOption[];
      currency: string;
      itemGroups: ItemGroupsLoad | null;
      archiveAvailable: boolean;
      duplicates: DuplicateState;
      capabilities: Record<Capability, boolean>;
    }
  | { kind: "no-company" };

async function loadIngredientes(
  locationId: string | null
): Promise<LoadResult> {
  const user = await getCachedAuthUser();
  if (!user) return { kind: "no-company" };
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) return { kind: "no-company" };
  const supabase = await createClient();

  const [ingredients, suppliersRes, currency, economics, usage, duplicates] =
    await Promise.all([
      fetchIngredientLatestCosts(supabase, companyId),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("name", { ascending: true }),
      resolveCompanyCurrency(supabase, companyId),
      loadDishEconomics(companyId, null, null, locationId),
      loadIngredientUsage(supabase, companyId),
      loadDuplicateState(supabase, companyId),
    ]);
  const capabilities = capabilityFlags(
    await resolveActor(supabase, user.id, { companyId })
  );
  if (!economics.ok) {
    console.error("[menu/ingredientes] dish economics:", economics.error);
  }

  // Net sales of the sold dishes that use each ingredient: only ranks the
  // list; "Se usa en" comes from the uses list.
  const soldNetSales = new Map<string, number>();
  if (economics.ok) {
    for (const dish of economics.result.dishes) {
      if (!(dish.units_sold > 0)) continue;
      const ids = new Set(
        dish.lines.flatMap((l) => (l.ingredient_id ? [l.ingredient_id] : []))
      );
      for (const id of ids)
        soldNetSales.set(id, (soldNetSales.get(id) ?? 0) + dish.net_sales);
    }
  }

  const items: IngredienteItem[] = ingredients.map((ing) => {
    const usedIn = usage.ok ? (usage.usesByIngredient.get(ing.id) ?? []) : null;
    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      default_unit: ing.default_unit,
      price: ing.latest ? ing.latest.normalized_unit_cost : null,
      price_unit: ing.latest?.normalized_unit ?? null,
      price_date: ing.latest?.cost_date ?? null,
      price_entry_id: ing.latest?.id ?? null,
      recipeCount: usedIn?.length ?? 0,
      lineCount: usedIn?.length ?? 0,
      previous_price: ing.latest?.previous_unit_cost ?? null,
      source: ing.latest?.source ?? null,
      supplier_id: ing.latest?.supplier_id ?? null,
      supplier_name: ing.latest?.supplier_name ?? null,
      // Usage unknown (recipes unreadable): everything counts as in use, nothing is hidden.
      ...(usage.ok
        ? usageState(ing.id, usage, usage.archivedIds)
        : { inUse: true, archived: false }),
      sold_net_sales: soldNetSales.get(ing.id) ?? 0,
      usedIn,
    };
  });

  const suppliers: SupplierOption[] = (
    (suppliersRes.data ?? []) as { id: string; name: string }[]
  ).map((s) => ({ id: s.id, name: s.name }));

  return {
    kind: "data",
    items,
    suppliers,
    currency: currency || "USD",
    archiveAvailable: usage.archiveAvailable,
    duplicates,
    capabilities,
    itemGroups: economics.ok ? (economics.result.item_groups ?? null) : null,
  };
}

export default async function IngredientesRoute({
  searchParams,
}: {
  searchParams: Promise<{
    ingrediente?: string;
    filtro?: string;
    location?: string;
  }>;
}) {
  const params = await searchParams;
  const result = await loadIngredientes(params.location ?? null);
  if (result.kind === "no-company") {
    return (
      <p className="mt-3 text-[13px] text-[#8a92a3]">
        Conecta tu cuenta a una empresa para ver tus ingredientes.
      </p>
    );
  }
  return (
    <IngredientesScreen
      items={result.items}
      suppliers={result.suppliers}
      currency={result.currency}
      itemGroups={result.itemGroups}
      archiveAvailable={result.archiveAvailable}
      duplicates={result.duplicates}
      capabilities={result.capabilities}
      initialSelectedId={params.ingrediente ?? null}
      initialFilter={parseIngredientesFilter(params.filtro)}
    />
  );
}
