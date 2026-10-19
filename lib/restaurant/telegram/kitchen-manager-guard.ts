// Who may change kitchen recipe drafts and what they use (ingredients, names,
// prices): the company's owner, admin or manager, and Milton staff. Returns null when allowed, otherwise the Spanish 403.
// When a draft id is involved the draft is loaded with the admin client and
// must belong to the resolved company (404 otherwise): the role is always
// checked against the DRAFT's company, never a different one.

import { NextResponse } from "next/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageKitchenDrafts,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";

export const KITCHEN_FORBIDDEN_MESSAGE = "No tienes permiso para cambiar esto.";

/** Dev-only hint of which check failed; never logs ids or secrets. */
function logDenied(reason: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[kitchen-guard] denied: ${reason}`);
  }
}

export function forbidden(): NextResponse {
  return NextResponse.json(
    { error: KITCHEN_FORBIDDEN_MESSAGE },
    { status: 403 }
  );
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
      logDenied("company_mismatch");
      return NextResponse.json(
        { error: "No encontré ese borrador." },
        { status: 404 }
      );
    }
  }
  const [isMiltonAdmin, membershipRole] = await Promise.all([
    isUserAdminServer(userId),
    loadMembershipRole(companyId, userId),
  ]);
  if (canManageKitchenDrafts({ isMiltonAdmin, membershipRole })) return null;
  logDenied(membershipRole ? `role:${membershipRole}` : "no_membership");
  return forbidden();
}
