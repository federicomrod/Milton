// lib/restaurant/shell-context-server.ts
//
// Chrome extras for RestaurantShell: preferred language, Milton-admin
// flag, and the POS last-sync timestamp. Best-effort — a missing
// last_sync column or an unauthenticated visitor must never break a page.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { cache } from "react";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  resolveRestaurantCockpitLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import { lastSyncTimestamp } from "@/lib/restaurant/last-synced";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { listRestaurantLocationsForCurrentUser } from "@/lib/restaurant/restaurant-context-server";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";

export interface RestaurantShellChrome {
  locations: RestaurantLocationOption[];
  lang: PreferredLanguage;
  isAdmin: boolean;
  lastSyncedAt: string | null;
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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const locations = await listRestaurantLocationsForCurrentUser(supabase);
    if (!user?.id) {
      return { ...empty, locations };
    }

    const [isAdmin, companyId] = await Promise.all([
      isUserAdminServer(user.id),
      resolveCompanyIdForUser(supabase, user.id),
    ]);

    if (!companyId) {
      return { ...empty, locations, isAdmin };
    }

    const [lang, lastSyncedAt] = await Promise.all([
      loadPreferredLanguage(supabase, companyId),
      loadLastSyncedAt(supabase, companyId),
    ]);

    return { locations, lang, isAdmin, lastSyncedAt };
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
