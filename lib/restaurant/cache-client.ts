// lib/restaurant/cache-client.ts
//
// A Supabase client for code that runs INSIDE a cross-request cache scope
// (unstable_cache), where cookies cannot be read. It is built from the caller's
// access token — read OUTSIDE the cache — so it is the same user, and RLS still
// applies (`auth.uid()` comes from the JWT). No service role. If there is no
// session, the caller skips the cache and reads as before.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

type CookieStore = Parameters<typeof createClient>[0];

const NO_COOKIES = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
} as unknown as CookieStore;

/** The caller's access token, or null (then: no caching). */
export async function accessTokenOf(
  supabase: SupabaseClient
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** An RLS-bound client for a cache scope, from the caller's access token. */
export function cacheClientFor(accessToken: string) {
  return createClient(NO_COOKIES, accessToken);
}
