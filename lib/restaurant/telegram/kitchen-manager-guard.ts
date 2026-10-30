// Who may change kitchen recipe drafts and what they use (ingredients, names,
// prices): the capability kitchen.drafts (owner, admin, manager, Milton
// staff). Returns null when allowed, otherwise the Spanish 403.
// When a draft id is involved the draft is loaded with the admin client and
// must belong to the resolved company (404 otherwise): the role is always
// checked against the DRAFT's company, never a different one.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  requireCapability,
  resolveActor,
} from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export const KITCHEN_FORBIDDEN_MESSAGE = "No tienes permiso para cambiar esto.";

export function forbidden(): NextResponse {
  return forbiddenResponse(KITCHEN_FORBIDDEN_MESSAGE);
}

export async function kitchenManagerGuard(
  companyId: string,
  userId: string,
  opts?: { draftId?: string | null }
): Promise<NextResponse | null> {
  if (opts?.draftId) {
    const { data: draft } = await createAdminClient()
      .from("kitchen_recipe_drafts")
      .select("id, company_id")
      .eq("id", opts.draftId)
      .maybeSingle();
    if (!draft || draft.company_id !== companyId) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[permissions] kitchen.drafts denied: company_mismatch");
      }
      return NextResponse.json(
        { error: (await apiDictionary()).kitchen.api.draftNotFoundThat },
        { status: 404 }
      );
    }
  }
  const actor = await resolveActor(null, userId, { companyId });
  return requireCapability(actor, "kitchen.drafts", {
    message: KITCHEN_FORBIDDEN_MESSAGE,
  });
}
