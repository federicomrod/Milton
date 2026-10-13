// Server entry for AI recipe suggestions. Ranking and coverage stay
// on the server. Company comes from auth, never from the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { createDefaultWorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { runRecipeSuggestions } from "@/lib/restaurant/cost-workbook/recipe-suggestion";
import {
  expandCandidateBlocks,
  findRecipeSource,
} from "@/lib/restaurant/cost-workbook/stored-blocks";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  refreshEvidence,
  withCachedCatalog,
} from "@/lib/restaurant/recipe-costing/editor-service";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { GroupedRecipe } from "@/lib/restaurant/cost-workbook/types";

export const NO_STORED_BLOCKS_ERROR =
  "Todavía no tengo tu archivo de costos. Súbelo en «Subir Excel de costos» y Milton prepara tus platos.";

export interface RunRecipeSuggestionsParams {
  companyId: string;
  buffer?: Buffer;
  filename?: string;
  currency: string;
  limit?: number;
  odooProductId?: number;
  locationId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lang?: PreferredLanguage;
  createdBy?: string | null;
  ai?: WorkbookAi;
  /** Use the latest live Costos upload's stored blocks (no xlsx). */
  fromLatestUpload?: boolean;
  /** Skip this many products (by sales) — for running in small chunks. */
  offset?: number;
}

export async function loadStoredCandidateBlocks(
  supabase: SupabaseClient,
  companyId: string
): Promise<
  | { ok: true; blocks: GroupedRecipe[]; filename: string; batch_id: string }
  | { ok: false; error: string }
> {
  const repo = createSupabaseCostWorkbookRepo(supabase);
  const source = findRecipeSource(await repo.listBatchHistory(companyId));
  if (!source) return { ok: false, error: NO_STORED_BLOCKS_ERROR };
  const blocks = expandCandidateBlocks(source.blocks);
  if (blocks.length === 0) return { ok: false, error: NO_STORED_BLOCKS_ERROR };
  return {
    ok: true,
    blocks,
    filename: source.batch.filename,
    batch_id: source.batch.id,
  };
}

/** Only products whose treatment takes a recipe from the file: dishes,
 *  costed modifiers, and products nobody has classified yet. Combos go by
 *  their parts; reventa is one line picked by a person; excluded and
 *  no-cost products need nothing. Order stays by sales. */
export function wantsSuggestion(product: RankedPosProduct): boolean {
  if (product.is_combo) return false;
  return (
    product.treatment === "por_clasificar" ||
    product.treatment === "plato_preparado" ||
    product.treatment === "modificador_con_costo"
  );
}

export async function runRecipeSuggestionsForCompany(
  supabase: SupabaseClient,
  params: RunRecipeSuggestionsParams
) {
  const list = await loadPosProductList(supabase, {
    companyId: params.companyId,
    startDate: params.startDate,
    endDate: params.endDate,
    locationId: params.locationId,
  });
  if (!list.ok) return list;

  let blocks: GroupedRecipe[];
  let filename = params.filename || "recetas.xlsx";
  if (params.buffer) {
    blocks = collectWorkbookCandidateBlocks({
      buffer: params.buffer,
      lang: params.lang ?? "es",
    }).all;
  } else if (params.fromLatestUpload) {
    const stored = await loadStoredCandidateBlocks(supabase, params.companyId);
    if (!stored.ok) return stored;
    blocks = stored.blocks;
    filename = stored.filename;
  } else {
    return { ok: false as const, error: NO_STORED_BLOCKS_ERROR };
  }

  const repo = createSupabaseCostWorkbookRepo(supabase);
  const result = await runRecipeSuggestions({
    companyId: params.companyId,
    products: list.list.products.filter(wantsSuggestion),
    candidateBlocks: blocks,
    repo,
    ai: params.ai ?? createDefaultWorkbookAi(),
    currency: params.currency,
    filename,
    locationId: params.locationId ?? null,
    limit: params.limit,
    offset: params.offset,
    odooProductId: params.odooProductId,
    lang: params.lang ?? "es",
    createdBy: params.createdBy ?? null,
  });

  // Cost the new drafts from the catalog right away, so the first thing a
  // person sees is the catalog price, never the Excel's own number.
  const editorStore = withCachedCatalog(createSupabaseEditorStore(supabase));
  for (const item of result.items) {
    if (item.result !== "sugerido") continue;
    try {
      await refreshEvidence({
        store: editorStore,
        companyId: params.companyId,
        odooProductId: item.odoo_product_id,
        locationId: params.locationId ?? null,
        userId: params.createdBy ?? null,
      });
    } catch (err) {
      console.error("[recipe-suggestions refresh]", err);
    }
  }

  return {
    ok: true as const,
    net_sales: list.list.net_sales,
    coverage_pct: list.list.coverage_pct,
    product_count: list.list.products.filter(wantsSuggestion).length,
    source: params.buffer ? ("file" as const) : ("latest_upload" as const),
    ...result,
  };
}
