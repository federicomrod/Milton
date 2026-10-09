// app/auth/callback/route.ts
// Handles email confirmation and OAuth callbacks from Supabase

import { createClient } from "@/lib/supabase/server";
import { getPostLoginRedirect } from "@/lib/restaurant/post-login";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;

  console.log("[auth/callback] Processing callback, code present:", !!code);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.session) {
      console.log("[auth/callback] Session created successfully");

      const destination = await getPostLoginRedirect(supabase);
      console.log("[auth/callback] Routing to", destination);
      return NextResponse.redirect(`${origin}${destination}`);
    }

    console.error("[auth/callback] Error exchanging code:", error);
  }

  // If there's an error or no code, redirect to login with error
  // (in case they land here without proper params)
  console.log("[auth/callback] No code or error, redirecting to login");
  return NextResponse.redirect(
    `${origin}/auth/login?error=Could not authenticate user`
  );
}
