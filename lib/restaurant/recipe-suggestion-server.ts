// Server entry for AI recipe suggestions. Ranking and coverage stay
// on the server. Company comes from auth, never from the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { createDefaultWorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { runRecipeSuggestions } from "@/lib/restaurant/cost-workbook/recipe-suggestion";
import {
  candidateBlocksFromUnknown,
  expandCandidateBlocks,
} from "@/lib/restaurant/cost-workbook/stored-blocks";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { GroupedRecipe } from "@/lib/restaurant/cost-workbook/types";

export const NO_STORED_BLOCKS_ERROR =
  "No hay un archivo de Costos parseado. Vuelve a subirlo en Costos › Subir costos y después pulsa Generar sugerencias.";

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
}

export async function loadStoredCandidateBlocks(
  supabase: SupabaseClient,
  companyId: string
): Promise<
  | { ok: true; blocks: GroupedRecipe[]; filename: string; batch_id: string }
  | { ok: false; error: string }
> {
  const repo = createSupabaseCostWorkbookRepo(supabase);
  const history = await repo.listBatchHistory(companyId);
  const live = history.find((batch) => !batch.undone_at);
  if (!live) return { ok: false, error: NO_STORED_BLOCKS_ERROR };
  const stored = candidateBlocksFromUnknown(
    live.undo_snapshot.candidate_blocks
  );
  const blocks = expandCandidateBlocks(stored);
  if (blocks.length === 0) return { ok: false, error: NO_STORED_BLOCKS_ERROR };
  return {
    ok: true,
    blocks,
    filename: live.filename,
    batch_id: live.id,
  };
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
    products: list.list.products,
    candidateBlocks: blocks,
    repo,
    ai: params.ai ?? createDefaultWorkbookAi(),
    currency: params.currency,
    filename,
    locationId: params.locationId ?? null,
    limit: params.limit,
    odooProductId: params.odooProductId,
    lang: params.lang ?? "es",
    createdBy: params.createdBy ?? null,
  });

  return {
    ok: true as const,
    net_sales: list.list.net_sales,
    coverage_pct: list.list.coverage_pct,
    product_count: list.list.products.length,
    source: params.buffer ? ("file" as const) : ("latest_upload" as const),
    ...result,
  };
}
