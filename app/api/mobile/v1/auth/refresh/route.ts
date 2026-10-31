// app/api/mobile/v1/auth/refresh/route.ts
//
// POST { refreshToken }: exchanges the refresh token for a new session so the
// manager stays signed in. Nothing is logged.

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDictionary } from "@/lib/i18n";
import {
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import { sessionBody } from "@/lib/restaurant/mobile-manager/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request)).kitchen.api;
  let refreshToken = "";
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed.refreshToken === "string") {
      refreshToken = parsed.refreshToken;
    }
  } catch {
    // falls through to the 401 below
  }
  if (!refreshToken || refreshToken.length > 2048) {
    return mobileJson({ error: d.signInAgain }, 401);
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("not configured");
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) {
      return mobileJson({ error: d.signInAgain }, 401);
    }
    return mobileJson(sessionBody(data.session, data.user));
  } catch (err) {
    console.error(
      "[mobile-refresh] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.managerLoginFailed }, 503);
  }
}
