import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RECIPE_VERSIONS_READ_ERROR_ES,
  syncApprovedMenuRecipeVersion,
} from "@/lib/restaurant/sync-recipe-version";

function listErrorClient(message: string): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return Promise.resolve({
            data: null,
            error: { message },
          });
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("syncApprovedMenuRecipeVersion", () => {
  it("throws a Spanish error when recipe_versions cannot be read", async () => {
    await expect(
      syncApprovedMenuRecipeVersion({
        supabase: listErrorClient("relation recipe_versions does not exist"),
        companyId: "co-1",
        recipeId: "rec-1",
        menuItemId: "menu-1",
        inputs: [],
      })
    ).rejects.toThrow(RECIPE_VERSIONS_READ_ERROR_ES);
  });
});
