// lib/restaurant/api-lang.ts
//
// The signed-in company's language for API routes, so error and status
// messages in JSON responses come back in the language the person chose.
// One lookup per request (React cache); never throws — falls back to
// Spanish like the cockpit does.

import { cache } from "react";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  resolveRestaurantCockpitLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requestLanguage } from "@/lib/restaurant/request-lang";

export const apiLanguage = cache(async (): Promise<PreferredLanguage> => {
  try {
    const auth = await authAndCompany();
    // No company yet (signed out): cookie, then Accept-Language.
    if (!auth.ok) return await requestLanguage();
    const { data } = await auth.supabase
      .from("companies")
      .select("preferred_language")
      .eq("id", auth.companyId)
      .maybeSingle();
    return resolveRestaurantCockpitLanguage(data?.preferred_language);
  } catch {
    return RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  }
});

/** `const d = await apiDictionary(); d.errors.saveFailed` */
export async function apiDictionary(): Promise<Dictionary> {
  return getDictionary(await apiLanguage());
}
