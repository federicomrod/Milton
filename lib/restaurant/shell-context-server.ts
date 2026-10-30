// lib/restaurant/shell-context-server.ts
//
// Chrome extras for RestaurantShell: preferred language, Milton-admin
// flag, and the POS last-sync timestamp. Best-effort — a missing
// last_sync column or an unauthenticated visitor must never break a page.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  resolveRestaurantCockpitLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import { lastSyncTimestamp } from "@/lib/restaurant/last-synced";
import { listRestaurantLocationsForCurrentUser } from "@/lib/restaurant/restaurant-context-server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
  getCachedIsMiltonAdmin,
} from "@/lib/restaurant/auth-user";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";

export interface RestaurantShellChrome {
  locations: RestaurantLocationOption[];
  lang: PreferredLanguage;
  isAdmin: boolean;
  lastSyncedAt: string | null;
  /** First name (or email name) for "Fede · Cerrar sesión". */
  userName?: string | null;
}

function displayNameOf(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const meta = user.user_metadata ?? {};
  const full =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  const first = full.trim().split(/\s+/)[0];
  if (first) return first;
  const local = user.email?.split("@")[0]?.trim();
  return local || null;
}

export const loadRestaurantShellChrome = cache(
  loadRestaurantShellChromeUncached
);

async function loadRestaurantShellChromeUncached(): Promise<RestaurantShellChrome> {
  const empty: RestaurantShellChrome = {
    locations: [],
    lang: RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
    isAdmin: false,
    lastSyncedAt: null,
  };

  try {
    return await timeCockpitStep("chrome", async () => {
      const supabase = await createClient();
      const user = await getCachedAuthUser();

      if (!user?.id) {
        const locations = await listRestaurantLocationsForCurrentUser(supabase);
        return { ...empty, locations };
      }

      const companyId = await getCachedCompanyId(user.id);
      const [isAdmin, lang, lastSyncedAt, locations] = await Promise.all([
        getCachedIsMiltonAdmin(user.id),
        companyId
          ? loadPreferredLanguage(supabase, companyId)
          : Promise.resolve(RESTAURANT_COCKPIT_DEFAULT_LANGUAGE),
        companyId
          ? loadLastSyncedAt(supabase, companyId)
          : Promise.resolve(null),
        listRestaurantLocationsForCurrentUser(supabase),
      ]);

      if (!companyId) {
        return { ...empty, locations, isAdmin };
      }

      return {
        locations,
        lang,
        isAdmin,
        lastSyncedAt,
        userName: displayNameOf(user),
      };
    });
  } catch (err) {
    console.error("[loadRestaurantShellChrome] failed:", err);
    return empty;
  }
}

async function loadPreferredLanguage(
  supabase: SupabaseClient,
  companyId: string
): Promise<PreferredLanguage> {
  try {
    const { data } = await supabase
      .from("companies")
      .select("preferred_language")
      .eq("id", companyId)
      .maybeSingle();
    return resolveRestaurantCockpitLanguage(data?.preferred_language);
  } catch (err) {
    console.error("[loadRestaurantShellChrome] preferred_language:", err);
    return RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  }
}

async function loadLastSyncedAt(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const run = (select: string) =>
    supabase
      .from("restaurant_pos_connections")
      .select(select)
      .eq("company_id", companyId)
      .eq("is_active", true);

  let result = await run("last_sync");
  if (result.error && errorMentionsColumn(result.error, "last_sync")) {
    return null;
  }
  if (result.error) {
    console.error(
      "[loadRestaurantShellChrome] last_sync:",
      result.error.message
    );
    return null;
  }

  let newest: string | null = null;
  let newestMs = -1;
  for (const row of result.data ?? []) {
    const ts = lastSyncTimestamp(
      (row as { last_sync?: unknown }).last_sync ?? null
    );
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (ms > newestMs) {
      newestMs = ms;
      newest = ts;
    }
  }
  return newest;
}
