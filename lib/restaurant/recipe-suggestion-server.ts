// Server entry for AI recipe suggestions. Ranking and coverage stay
// on the server. Company comes from auth, never from the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { createDefaultWorkbookAi } from "@/lib/restaurant/cost-workbook/ai";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { runRecipeSuggestions } from "@/lib/restaurant/cost-workbook/recipe-suggestion";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface RunRecipeSuggestionsParams {
  companyId: string;
  buffer: Buffer;
  filename: string;
  currency: string;
  limit?: number;
  odooProductId?: number;
  locationId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lang?: PreferredLanguage;
  createdBy?: string | null;
  ai?: WorkbookAi;
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

  const blocks = collectWorkbookCandidateBlocks({
    buffer: params.buffer,
    lang: params.lang ?? "es",
  });
  const repo = createSupabaseCostWorkbookRepo(supabase);
  const result = await runRecipeSuggestions({
    companyId: params.companyId,
    products: list.list.products,
    candidateBlocks: blocks.all,
    repo,
    ai: params.ai ?? createDefaultWorkbookAi(),
    currency: params.currency,
    filename: params.filename,
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
    ...result,
  };
}
