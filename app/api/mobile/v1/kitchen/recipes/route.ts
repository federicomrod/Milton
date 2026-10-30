// app/api/mobile/v1/kitchen/recipes/route.ts
//
// GET: the cook's location's approved recipes (name, category, yield,
// ingredients, steps), ?cursor= for more and ?q= to search by name. Read only:
// nothing here writes a recipe. Allow-list serializer; no price or cost field
// can reach the cook.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import {
  cleanRecipeSearch,
  decodeRecipesCursor,
  encodeRecipesCursor,
  loadKitchenRecipes,
} from "@/lib/restaurant/kitchen/kitchen-recipes";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff } = auth;

  const params = new URL(request.url).searchParams;
  const offset = decodeRecipesCursor(params.get("cursor"));
  if (offset === null) {
    return kitchenJson({ error: d.kitchen.api.cursorInvalid }, 400);
  }
  try {
    const result = await loadKitchenRecipes(
      admin,
      { companyId: staff.companyId, locationId: staff.locationId },
      { offset, search: cleanRecipeSearch(params.get("q")) }
    );
    if (!result.ok) {
      return kitchenJson({ error: d.kitchen.api.recipesLoadFailed }, 500);
    }
    return kitchenJson({
      recipes: result.recipes,
      nextCursor:
        result.nextOffset === null
          ? null
          : encodeRecipesCursor(result.nextOffset),
    });
  } catch (err) {
    console.error(
      "[mobile-kitchen-recipes] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.recipesLoadFailed }, 500);
  }
}
