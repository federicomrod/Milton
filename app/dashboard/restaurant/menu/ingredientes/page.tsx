// app/dashboard/restaurant/menu/ingredientes/page.tsx
//
// Menú › Ingredientes (R1-09b, A6/D7): list + detail. The layout renders
// the header and tabs; this page only loads the tab's data. Prices come
// from ingredient_cost_entries (fetchIngredientLatestCosts); "Se usa en"
// comes from the shared dish economics load.

import { createClient } from "@/lib/supabase/server";
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
import { dishesUsingIngredient } from "@/lib/restaurant/costing/dish-economics";
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
  if (!economics.ok) {
    console.error("[menu/ingredientes] dish economics:", economics.error);
  }

  const items: IngredienteItem[] = ingredients.map((ing) => {
    const uses = economics.ok
      ? dishesUsingIngredient(economics.result, ing.id).map(
          ({ dish, line }) => ({
            odoo_product_id: dish.odoo_product_id,
            dish_name: dish.name,
            qty: line.qty,
            unit: line.unit,
            amount: line.amount,
            units_sold: dish.units_sold,
            net_sales: dish.net_sales,
          })
        )
      : [];
    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      default_unit: ing.default_unit,
      price: ing.latest ? ing.latest.normalized_unit_cost : null,
      price_unit: ing.latest?.normalized_unit ?? null,
      price_date: ing.latest?.cost_date ?? null,
      price_entry_id: ing.latest?.id ?? null,
      recipeCount: usage.dishCount.get(ing.id) ?? 0,
      lineCount: usage.lineCount.get(ing.id) ?? 0,
      previous_price: ing.latest?.previous_unit_cost ?? null,
      source: ing.latest?.source ?? null,
      supplier_id: ing.latest?.supplier_id ?? null,
      supplier_name: ing.latest?.supplier_name ?? null,
      // Usage unknown (recipes unreadable): everything counts as in use, nothing is hidden.
      ...(usage.ok
        ? usageState(ing.id, usage, usage.archivedIds)
        : { inUse: true, archived: false }),
      sold_net_sales: uses
        .filter((u) => u.units_sold > 0)
        .reduce((sum, u) => sum + u.net_sales, 0),
      uses: uses.sort((a, b) => b.net_sales - a.net_sales),
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
      initialSelectedId={params.ingrediente ?? null}
      initialFilter={parseIngredientesFilter(params.filtro)}
    />
  );
}
