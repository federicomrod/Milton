// Confirm how many portions a dish's recipe yields. Only the yield in the
// dish's cached evidence changes (what the checklist reads); recipe lines
// are edited through the ingredient editor, never here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { actorCanSubmitForApproval, type RecipeActor } from "./approval";
import { loadPosProductLink } from "./link-actions-server";
import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export async function confirmDishYield(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  odooProductId: number;
  locationId?: string | null;
  yieldValue: number;
  /** Language of the error messages (default Spanish). */
  lang?: PreferredLanguage;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const api = getDictionary(input.lang ?? "es").menu.editor;
  if (!actorCanSubmitForApproval(input.actor)) {
    return { ok: false, error: api.api.roleCannotEdit, status: 403 };
  }
  if (!(input.yieldValue > 0) || !Number.isFinite(input.yieldValue)) {
    return {
      ok: false,
      error: api.api.yieldPositive,
      status: 400,
    };
  }
  const link = await loadPosProductLink(
    input.supabase,
    input.companyId,
    input.odooProductId,
    input.locationId
  );
  if (!link?.id) {
    return {
      ok: false,
      error: api.service.noLink,
      status: 404,
    };
  }
  const prev =
    link.evidence.yield && typeof link.evidence.yield === "object"
      ? (link.evidence.yield as Record<string, unknown>)
      : {};
  const evidence = {
    ...link.evidence,
    yield: { ...prev, value: input.yieldValue, source: "confirmed" },
  };
  const { error } = await input.supabase
    .from("pos_product_links")
    .update({ evidence, updated_at: new Date().toISOString() })
    .eq("company_id", input.companyId)
    .eq("id", link.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
