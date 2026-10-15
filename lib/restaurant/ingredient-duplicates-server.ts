// R1-15k: what the Ingredientes screen needs to show the duplicate queue and
// the merge history (051). Read-only. Before 051 everything is empty and
// `available` is false: the suggestions still show, deciding on them says
// what is missing.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pairKey,
  setKeyOf,
  type StoredSuggestion,
} from "@/lib/restaurant/ingredient-duplicates";

export interface MergeRecord {
  id: string;
  survivorId: string;
  survivorName: string;
  loserNames: string[];
  createdAt: string;
  undone: boolean;
}

export interface DuplicateState {
  available: boolean;
  stored: StoredSuggestion[];
  /** "id,id" pairs a person said are not the same. */
  notDuplicates: string[];
  merges: MergeRecord[];
}

export const NO_DUPLICATE_STATE: DuplicateState = {
  available: false,
  stored: [],
  notDuplicates: [],
  merges: [],
};

export async function loadDuplicateState(
  supabase: SupabaseClient,
  companyId: string
): Promise<DuplicateState> {
  try {
    const [sug, nd, merges] = await Promise.all([
      supabase
        .from("ingredient_duplicate_suggestions")
        .select(
          "id, ingredient_ids, set_key, source, score, status, skipped_at"
        )
        .eq("company_id", companyId)
        .limit(5000),
      supabase
        .from("ingredient_not_duplicates")
        .select("ingredient_a, ingredient_b")
        .eq("company_id", companyId)
        .limit(20000),
      supabase
        .from("ingredient_merges")
        .select(
          "id, survivor_id, survivor_name, loser_names, created_at, undone_at"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    if (sug.error || nd.error || merges.error) return NO_DUPLICATE_STATE;
    return {
      available: true,
      stored: ((sug.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        ids: (r.ingredient_ids as string[]) ?? [],
        key:
          typeof r.set_key === "string"
            ? r.set_key
            : setKeyOf((r.ingredient_ids as string[]) ?? []),
        source: r.source === "ai" ? "ai" : "name",
        score:
          typeof r.score === "number"
            ? r.score
            : r.score
              ? Number(r.score)
              : null,
        status: r.status as StoredSuggestion["status"],
        skippedAt: typeof r.skipped_at === "string" ? r.skipped_at : null,
      })),
      notDuplicates: (
        (nd.data ?? []) as Array<{ ingredient_a: string; ingredient_b: string }>
      ).map((r) => pairKey(r.ingredient_a, r.ingredient_b)),
      merges: ((merges.data ?? []) as Array<Record<string, unknown>>).map(
        (r) => ({
          id: String(r.id),
          survivorId: String(r.survivor_id),
          survivorName: String(r.survivor_name ?? ""),
          loserNames: (r.loser_names as string[]) ?? [],
          createdAt: String(r.created_at),
          undone: r.undone_at != null,
        })
      ),
    };
  } catch {
    return NO_DUPLICATE_STATE;
  }
}
