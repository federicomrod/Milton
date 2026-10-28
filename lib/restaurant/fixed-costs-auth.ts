// lib/restaurant/fixed-costs-auth.ts
//
// Shared guard of the fixed-costs API routes: signed in, a company resolved
// from the user (never from the client) and the actor. Each route then asks
// requireCapability(actor, "costs.fixed") itself.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { resolveActor, unauthorizedResponse } from "@/lib/auth/permissions";

export async function authorizeFixedCosts() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: unauthorizedResponse() };
  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "No company resolved for user" },
        { status: 404 }
      ),
    };
  const actor = await resolveActor(supabase, user.id, { companyId });
  return { ok: true as const, supabase, companyId, userId: user.id, actor };
}
