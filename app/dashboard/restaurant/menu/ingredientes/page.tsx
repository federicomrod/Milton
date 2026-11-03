// app/dashboard/restaurant/menu/ingredientes/page.tsx
//
// Menú › Ingredientes (R1-09b, A6/D7): list + detail. The layout renders
// the header and tabs; this page only loads the tab's data. Prices come
// from ingredient_cost_entries (fetchIngredientLatestCosts); "Se usa en"
// comes from loadIngredientUsage (one list for the counters and the detail).

import { redirect } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { MENU_TAB_PATHS } from "@/lib/restaurant/recetas-redirect";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { createClient } from "@/lib/supabase/server";
import { capabilityFlags } from "@/lib/auth/permissions";
import type { Capability } from "@/lib/auth/capabilities";
import {
  getCachedActor,
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { fetchIngredientLatestCosts } from "@/lib/restaurant/menu-recipes-server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  loadDuplicateState,
  type DuplicateState,
} from "@/lib/restaurant/ingredient-duplicates-server";
import {
  loadYieldHistories,
  type HistoryLine,
} from "@/lib/restaurant/kitchen-buffer-server";
import { currentYield } from "@/lib/restaurant/ingredient-yield-view";
import {
  loadPrepDefs,
  loadPrepGraph,
} from "@/lib/restaurant/nested-yield-server";
import {
  redactMermaInputs,
  type PrepDef,
} from "@/lib/restaurant/merma-visibility";
import {
  coveredByMeasuredPrep,
  type PrepNode,
} from "@/lib/restaurant/nested-yield";
import { loadBusinessToday } from "@/lib/restaurant/kitchen-buffer-server";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";
import { loadResolvedBufferAt } from "@/lib/restaurant/yield-buffer";
import { loadIngredientUsage } from "@/lib/restaurant/ingredient-usage-server";
import { usageState } from "@/lib/restaurant/ingredient-usage";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import {
  canSeeIngredientes,
  parseIngredientesFilter,
} from "@/lib/restaurant/ingredientes-screen";
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
      /** The kitchen buffer in force today for the selected restaurant, in %. */
      bufferPct: number | null;
      /** Preparations' recipes for the share via a preparation; none for cooks. */
      prepDefs: Record<string, PrepDef>;
    }
  | { kind: "no-company" }
  // Kitchen roles do not see this screen at all: nothing below is read for them.
  | { kind: "denied" };

async function loadIngredientes(
  locationId: string | null,
  lang: PreferredLanguage
): Promise<LoadResult> {
  const user = await getCachedAuthUser();
  if (!user) return { kind: "no-company" };
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) return { kind: "no-company" };
  const capabilities = capabilityFlags(
    await getCachedActor(user.id, companyId)
  );
  if (!canSeeIngredientes(capabilities)) return { kind: "denied" };
  const supabase = await createClient();

  const [
    ingredients,
    suppliersRes,
    currency,
    economics,
    usage,
    duplicates,
    yieldHistories,
  ] = await Promise.all([
    fetchIngredientLatestCosts(supabase, companyId),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("name", { ascending: true }),
    resolveCompanyCurrency(supabase, companyId),
    loadDishEconomics(companyId, null, null, locationId),
    loadIngredientUsage(supabase, companyId, lang),
    loadDuplicateState(supabase, companyId),
    // Merma history (approved rows); a failed read shows no history, not an error.
    loadYieldHistories(supabase, companyId).catch(
      () => new Map<string, HistoryLine[]>()
    ),
  ]);
  // Display only: the buffer in force today and which preparations are measured.
  // #407's shared loader and rule: a preparation is covered when it, or any
  // preparation above it, has a measured batch output.
  const prepGraph = await loadPrepGraph(supabase, companyId).catch(
    () => new Map<string, PrepNode>()
  );
  const bufferPct = await (async () => {
    try {
      const { locations } = await listAllCompanyRestaurants(
        supabase,
        companyId
      );
      const where =
        locationId && locations.some((l) => l.id === locationId)
          ? locationId
          : (locations[0]?.id ?? null);
      if (!where) return null;
      const day = await loadBusinessToday(supabase, companyId, where);
      return (await loadResolvedBufferAt(supabase, companyId, where, day))
        .bufferPct;
    } catch {
      return null;
    }
  })();
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

  const today = new Date().toISOString().slice(0, 10);
  // Cooks (kitchen roles) get no price and no merma input in the payload.
  const canViewPrices = capabilities["prices.view"];
  const prepDefs = canViewPrices
    ? await loadPrepDefs(supabase, companyId, prepGraph).catch(
        () => ({}) as Record<string, PrepDef>
      )
    : ({} as Record<string, PrepDef>);
  const items: IngredienteItem[] = ingredients.map((ing) =>
    redactMermaInputs(buildItem(ing), canViewPrices)
  );
  function buildItem(ing: (typeof ingredients)[number]): IngredienteItem {
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
      usedIn:
        usedIn?.map((u) =>
          u.kind === "preparacion"
            ? {
                ...u,
                prepCovered: coveredByMeasuredPrep(
                  u.key.split(":")[1],
                  prepGraph
                ),
              }
            : u
        ) ?? null,
      // The yield in force today is the newest entry that already applies;
      // none = no yield set (never shown as 0).
      yieldPct: currentYield(yieldHistories.get(ing.id) ?? [], today),
      yieldHistory: yieldHistories.get(ing.id) ?? [],
    };
  }

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
    bufferPct: canViewPrices ? bufferPct : null,
    prepDefs,
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
  const { lang } = await loadRestaurantShellChrome();
  const result = await loadIngredientes(params.location ?? null, lang);
  if (result.kind === "denied") redirect(MENU_TAB_PATHS.resumen);
  if (result.kind === "no-company") {
    return (
      <p className="mt-3 text-[13px] text-[#8a92a3]">
        {getDictionary(lang).menu.screens.ingredientes.noCompany}
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
      bufferPct={result.bufferPct}
      prepDefs={result.prepDefs}
      initialSelectedId={params.ingrediente ?? null}
      initialFilter={parseIngredientesFilter(params.filtro)}
    />
  );
}
