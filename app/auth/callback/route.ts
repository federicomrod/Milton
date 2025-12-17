// app/auth/callback/route.ts
// Handles email confirmation and OAuth callbacks from Supabase

import { createClient } from "@/lib/supabase/server";
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

      // Check if onboarding is complete to determine redirect
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Check onboarding status
        const { data: company } = await supabase
          .from("companies")
          .select("onboarding_completed")
          .eq("user_id", user.id)
          .single();

        if (company?.onboarding_completed) {
          console.log(
            "[auth/callback] Onboarding complete, going to dashboard"
          );
          return NextResponse.redirect(`${origin}/dashboard`);
        }
      }

      // New user: redirect to onboarding
      console.log("[auth/callback] New user, going to onboarding");
      return NextResponse.redirect(`${origin}/onboarding`);
    }

    console.error("[auth/callback] Error exchanging code:", error);
  }

  // If there's an error or no code, redirect to confirm-email with error
  // (in case they land here without proper params)
  console.log("[auth/callback] No code or error, redirecting to login");
  return NextResponse.redirect(
    `${origin}/auth/login?error=Could not authenticate user`
  );
}
