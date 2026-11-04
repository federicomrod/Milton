// app/api/mobile/v1/kitchen/team/route.ts
//
// GET (manager's Supabase session): the kitchen team of the company, for
// Perfil. Owner, admin and manager only (kitchen.team). Names, whether a PIN is
// set and the phones; never a PIN, a hash, a token or money.

import { NextRequest } from "next/server";
import { getDictionary } from "@/lib/i18n";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import { listKitchenTeam } from "@/lib/restaurant/kitchen/team-admin";
import { ensureKitchenCode } from "@/lib/restaurant/kitchen/pin-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authAndCompanyFromBearer(request);
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;
  try {
    const actor = await resolveActor(supabase, userId, { companyId });
    const denied = requireCapability(actor, "kitchen.team");
    if (denied) {
      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }
    const admin = createAdminClient();
    const [team, kitchenCode] = await Promise.all([
      listKitchenTeam(admin, companyId),
      ensureKitchenCode(admin, companyId),
    ]);
    if (!team) return mobileJson({ error: d.kitchen.api.teamLoadFailed }, 500);
    return mobileJson({ kitchenCode, team });
  } catch (err) {
    console.error(
      "[mobile-kitchen-team] list failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.teamLoadFailed }, 500);
  }
}
