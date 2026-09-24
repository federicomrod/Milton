// app/auth/callback/route.ts
// Handles email confirmation and OAuth callbacks from Supabase

import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
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

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Admins always go to the management dashboard.
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (profile?.role === "admin") {
          console.log(
            "[auth/callback] Admin user, going to management dashboard"
          );
          return NextResponse.redirect(`${origin}/management/dashboard`);
        }

        // Restaurant pivot: every non-admin user lands in the restaurant
        // cockpit — unless they haven't finished the new restaurant
        // onboarding wizard yet, in which case send them there first.
        // Looked up via company_memberships (resolveCompanyIdForUser), NOT
        // companies.created_by — see proxy.ts's own comment on why that
        // column doesn't reliably identify restaurant-pivot companies.
        try {
          const companyId = await resolveCompanyIdForUser(supabase, user.id);
          if (companyId) {
            const { data: company } = await supabase
              .from("companies")
              .select("onboarding_status")
              .eq("id", companyId)
              .maybeSingle();
            if (company?.onboarding_status !== "completed") {
              console.log(
                "[auth/callback] Onboarding not complete, routing to onboarding wizard"
              );
              return NextResponse.redirect(`${origin}/onboarding/restaurant`);
            }
          }
        } catch (err) {
          // Never block login over an onboarding-status check failure.
          console.error("[auth/callback] Onboarding status check failed:", err);
        }
      }

      console.log("[auth/callback] Routing to restaurant cockpit");
      return NextResponse.redirect(`${origin}/dashboard/restaurant`);
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
