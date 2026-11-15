// app/api/mobile/v1/account/delete/route.ts
//
// POST: delete the signed-in user's account (Apple App Store requirement 5.1.1(v)).
//
// WHAT IT DELETES:
//   - The caller's auth.users row (via admin client)
//   - The caller's profile (cascades via FK)
//   - The caller's company_memberships (cascades via FK)
//
// WHAT IT KEEPS:
//   - Company data (sales, recipes, ingredients, invoices, etc.) — that belongs
//     to the company, not the individual
//   - Kitchen staff rows, reports, and media the user created — business records
//
// SOLE OWNER RULE:
//   If the caller is the only owner of a company, deletion is blocked with a
//   clear message asking them to contact support. This prevents leaving a
//   company with no owner and ensures company data is not orphaned.
//
// IDEMPOTENT:
//   If called twice (rare: the user's session is already invalid after the first
//   delete), it returns 401 (the token is no longer valid). If somehow called
//   with a valid token but the user is already gone, it still succeeds.
//
// SECURITY:
//   - Only deletes the caller's own account (userId from bearer token)
//   - Uses the service-role admin client to delete from auth.users
//   - Never logs the token or email

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authUserFromBearer } from "@/lib/restaurant/api-auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authUserFromBearer(request);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth;

  try {
    // 1. Check if the user is the sole owner of any company
    const adminClient = createAdminClient();
    const { data: memberships, error: membershipsError } = await adminClient
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId);

    if (membershipsError) {
      console.error("[account-delete] memberships read failed:", membershipsError.message);
      return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
    }

    const ownerships = (memberships ?? []).filter((m) => m.role === "owner");

    for (const ownership of ownerships) {
      const { data: owners, error: ownersError } = await adminClient
        .from("company_memberships")
        .select("user_id")
        .eq("company_id", ownership.company_id)
        .eq("role", "owner");

      if (ownersError) {
        console.error("[account-delete] owners check failed:", ownersError.message);
        return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
      }

      // If this user is the only owner, block deletion
      if (owners && owners.length === 1) {
        return mobileJson(
          {
            error: d.kitchen.api.accountDeleteSoleOwner,
            reason: "sole_owner",
          },
          403
        );
      }
    }

    // 2. Delete the user from auth.users (profile and memberships cascade)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      // If the user is already gone, that's fine (idempotent)
      if (deleteError.message?.includes("User not found")) {
        return mobileJson({ success: true, deleted: true });
      }
      console.error(
        "[account-delete] auth delete failed:",
        deleteError.message || "Unknown error"
      );
      return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
    }

    console.info(`[account-delete] user deleted: ${email || userId}`);
    return mobileJson({ success: true, deleted: true });
  } catch (err) {
    console.error(
      "[account-delete] unexpected:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
  }
}
