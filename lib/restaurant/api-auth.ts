// lib/restaurant/api-auth.ts
//
// Shared auth + company-resolution helper for restaurant API routes.
// Keeps the route handlers tiny and the company-lookup story consistent
// (same four-step fallback chain as the POS upload route).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";

export type AuthAndCompanyResult =
  | { ok: true; supabase: SupabaseClient; companyId: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Resolve the authenticated user + their company.
 *
 * Never accepts a `company_id` from the client — that would be a trivial
 * tenancy bypass. RLS still backs every subsequent query as a second
 * layer of defense.
 */
export async function authAndCompany(): Promise<AuthAndCompanyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No company resolved for user", user_id: user.id },
        { status: 404 }
      ),
    };
  }
  return { ok: true, supabase, companyId, userId: user.id };
}
