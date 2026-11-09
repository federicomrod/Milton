// app/api/mobile/v1/auth/login/route.ts
//
// POST { email, password }: signs a manager/owner in with the SAME Supabase
// account they use on the web and hands the session to the app, which keeps it
// in expo-secure-store. The app never holds a Supabase URL or key: this route
// talks to Supabase. No sign-up, no SMS.
//
// SECURITY: the email and password are never logged, stored or echoed; a wrong
// password and an unknown email answer the same way.

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
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return mobileJson({ error: d.managerLoginInvalid }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 256) {
    return mobileJson({ error: d.managerLoginInvalid }, 400);
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("not configured");
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) {
      // Credentials the server refused are a 401; anything else is ours.
      const status = (error as { status?: number } | null)?.status;
      return status === 400 || status === 401 || !error
        ? mobileJson({ error: d.managerLoginInvalid }, 401)
        : mobileJson({ error: d.managerLoginFailed }, 503);
    }
    return mobileJson(sessionBody(data.session, data.user));
  } catch (err) {
    console.error(
      "[mobile-login] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.managerLoginFailed }, 503);
  }
}
