// app/api/mobile/v1/me/route.ts
//
// GET: who the signed-in manager/owner is, their companies and what they may
// do (mobile P0b, #430). Supabase access token as bearer; the client carries
// that token, so RLS decides what rows come back.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authUserFromBearer } from "@/lib/restaurant/api-auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import {
  CAPABILITIES,
  can,
  normalizeRole,
  resolveActor,
  type Capability,
} from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authUserFromBearer(request);
  if (!auth.ok) return auth.response;
  const { supabase, userId, email } = auth;
  try {
    const { data: memberships, error } = await supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId);
    if (error) {
      return mobileJson({ error: d.kitchen.api.accountLoadFailed }, 500);
    }
    const rows = (memberships ?? []) as { company_id: string; role: string }[];
    const ids = rows.map((m) => m.company_id);
    const { data: companies } = ids.length
      ? await supabase.from("companies").select("id, name").in("id", ids)
      : { data: [] as { id: string; name: string }[] };
    const names = new Map(
      (companies ?? []).map((c) => [c.id as string, c.name as string])
    );

    const result = await Promise.all(
      rows.map(async (m) => {
        const actor = await resolveActor(supabase, userId, {
          companyId: m.company_id,
        });
        const capabilities = (Object.keys(CAPABILITIES) as Capability[]).filter(
          (c) => can(actor, c)
        );
        return {
          id: m.company_id,
          name: names.get(m.company_id) ?? "",
          role: normalizeRole(m.role),
          capabilities,
        };
      })
    );

    return mobileJson({ user: { id: userId, email }, companies: result });
  } catch (err) {
    console.error(
      "[mobile-me] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.accountLoadFailed }, 500);
  }
}
