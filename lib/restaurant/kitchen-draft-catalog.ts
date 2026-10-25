// lib/restaurant/kitchen-draft-catalog.ts
//
// The company catalog a recipe draft is matched against: active ingredients,
// their cost entries (all pages), the names the company already taught Milton
// (aliases) and the write currency. Shared by the Telegram webhook and the
// «Sube tus recetas» pipeline so both match exactly the same way.
//
// Read-only. Company-scoped by the companyId the caller passes (never taken
// from a file). Never logs names, prices or file contents.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import {
  isActiveIngredient,
  loadCompanyIngredients,
} from "@/lib/restaurant/ingredient-active";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import {
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";
import type { CostingIngredient } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

export interface DraftMatchingCatalog {
  ingredients: CostingIngredient[];
  costMap: Map<string, IngredientCostEntry[]>;
  aliasKeyToId: Map<string, string>;
  currency: string;
}

export async function loadDraftMatchingCatalog(
  admin: SupabaseClient,
  companyId: string
): Promise<DraftMatchingCatalog> {
  // Every ingredient and every cost entry, in pages: a plain select stops at
  // 1,000 rows and would silently leave ingredients without a price. Only
  // ACTIVE ingredients: a merged-away (archived) one is never matched; its
  // old name reaches the survivor through the alias.
  const ingredients: CostingIngredient[] = (
    await loadCompanyIngredients(admin, companyId)
  )
    .filter(isActiveIngredient)
    .map((row) => ({
      id: row.id,
      name: row.name,
      default_unit: row.default_unit ?? "unit",
    }));
  const ingredientIds = ingredients.map((i) => i.id);

  let costEntries: IngredientCostEntry[] = [];
  if (ingredientIds.length > 0) {
    const costEntriesRes = await fetchAllRows<IngredientCostEntry>(() =>
      admin
        .from("ingredient_cost_entries")
        .select(
          "id, company_id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit_cost, normalized_unit, currency, created_at"
        )
        .eq("company_id", companyId)
    );
    costEntries = costEntriesRes.error ? [] : costEntriesRes.rows;
  }

  // Names this company already taught Milton (ingredient_aliases).
  const aliasKeyToId = new Map<string, string>();
  try {
    const aliasRepo = createSupabaseCostWorkbookRepo(admin);
    for (const row of await aliasRepo.listIngredientAliases(companyId)) {
      aliasKeyToId.set(row.alias_key, row.ingredient_id);
    }
  } catch {
    // no alias table yet: exact and synonym matching still work
  }

  const costMap = new Map<string, IngredientCostEntry[]>();
  for (const entry of costEntries) {
    if (!costMap.has(entry.ingredient_id)) {
      costMap.set(entry.ingredient_id, []);
    }
    costMap.get(entry.ingredient_id)!.push(entry);
  }

  const currency = resolveWriteCurrency(
    costEntries[0]?.currency,
    await resolveCompanyCurrency(admin, companyId)
  );

  return { ingredients, costMap, aliasKeyToId, currency };
}
