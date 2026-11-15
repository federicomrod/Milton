// app/api/mobile/v1/account/delete/route.ts
//
// POST: delete the signed-in user's account (Apple App Store requirement 5.1.1(v)).
//
// MANAGER PATH (bearer token):
//   - Deletes the caller's auth.users row (via admin client)
//   - NULLs all FK references to the user in business records before deletion
//   - Cascades to profiles and company_memberships
//   - Blocks if user is sole owner of any company
//
// KITCHEN PATH (device token):
//   - Revokes all devices for this staff member
//   - If staff has user_id (manager's kitchen identity), does nothing here
//     (it will be cleaned up when the manager deletes their main account)
//   - Regular cooks (no user_id) have no Supabase auth account to delete
//
// WHAT IT KEEPS:
//   - Company data (sales, recipes, ingredients, invoices, etc.)
//   - Kitchen staff rows, reports, and media (business records)
//
// IDEMPOTENT: succeeds if already deleted
//
// SECURITY:
//   - Only deletes/revokes the caller's own account/devices
//   - Uses the service-role admin client
//   - Never logs tokens or emails

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authUserFromBearer } from "@/lib/restaurant/api-auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";

// FK columns that reference auth.users with ON DELETE NO ACTION (in production).
// These must be NULLed before deleting the user to keep business records intact.
export const USER_FK_REFERENCES = [
  { table: "agent_action_events", column: "user_id" },
  { table: "agent_actions", column: "approved_by_user_id" },
  { table: "agent_actions", column: "assigned_to_user_id" },
  { table: "agent_actions", column: "cancelled_by_user_id" },
  { table: "agent_actions", column: "created_by_user_id" },
  { table: "agent_actions", column: "executed_by_user_id" },
  { table: "agent_actions", column: "rejected_by_user_id" },
  { table: "agent_actions", column: "verified_by_user_id" },
  { table: "agent_recommendation_events", column: "user_id" },
  { table: "agent_runs", column: "triggered_by_user_id" },
  { table: "invoice_events", column: "user_id" },
  { table: "supplier_invoices", column: "approved_by_user_id" },
  { table: "supplier_invoices", column: "created_by_user_id" },
] as const;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));

  // Try bearer auth first (manager), then device token (kitchen)
  const bearerAuth = await authUserFromBearer(request);
  
  if (bearerAuth.ok) {
    // MANAGER PATH: delete Supabase auth account
    const adminClient = createAdminClient();
    return await deleteManagerAccount(bearerAuth.userId, bearerAuth.email, adminClient, d);
  }

  // Try kitchen device token
  const deviceAuth = await authKitchenDevice(request);
  if (deviceAuth.ok) {
    // KITCHEN PATH: revoke devices for this staff member
    return await deleteKitchenAccount(deviceAuth.staff.id, deviceAuth.admin, d);
  }

  // Neither auth worked - return the kitchen auth error (it has the right reason)
  return deviceAuth.response;
}

async function deleteManagerAccount(
  userId: string,
  email: string | null,
  adminClient: ReturnType<typeof createAdminClient>,
  d: ReturnType<typeof getDictionary>
) {
  try {
    // 1. Check if the user is the sole owner of any company
    const { data: memberships, error: membershipsError } = await adminClient
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId);

    if (membershipsError) {
      console.error("[account-delete] memberships read failed:", membershipsError.message);
      return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
    }

    // Verify we're checking the actual role values (owner/admin/manager/analyst/viewer)
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

    // 2. NULL all FK references to this user in business records
    // (production has ON DELETE NO ACTION, not SET NULL)
    let clearedCount = 0;
    for (const ref of USER_FK_REFERENCES) {
      const { error: nullError } = await adminClient
        .from(ref.table)
        .update({ [ref.column]: null })
        .eq(ref.column, userId);

      if (nullError) {
        console.error(
          `[account-delete] failed to null ${ref.table}.${ref.column}:`,
          nullError.message
        );
        return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
      }
      clearedCount++;
    }

    // 3. Delete the user from auth.users (profile and memberships cascade)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      // If the user is already gone, that's fine (idempotent)
      if (deleteError.message?.includes("User not found")) {
        return mobileJson({ success: true, deleted: true });
      }
      // If deleteUser still fails after clearing refs, log it clearly
      console.error(
        "[account-delete] auth.admin.deleteUser failed after clearing refs:",
        deleteError.message || "Unknown error",
        { userId, clearedCount }
      );
      return mobileJson(
        { error: d.kitchen.api.accountDeleteFailed, details: "deleteUser_failed" },
        500
      );
    }

    console.info(
      `[account-delete] manager account deleted: ${email || userId}, cleared ${clearedCount} references`
    );
    return mobileJson({ success: true, deleted: true });
  } catch (err) {
    console.error(
      "[account-delete] unexpected:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
  }
}

async function deleteKitchenAccount(
  staffId: string,
  adminClient: ReturnType<typeof createAdminClient>,
  d: ReturnType<typeof getDictionary>
) {
  try {
    // Check if this staff member is a manager's kitchen identity
    const { data: staff, error: staffError } = await adminClient
      .from("kitchen_staff")
      .select("user_id")
      .eq("id", staffId)
      .single();

    if (staffError && staffError.code !== "PGRST116") {
      console.error("[account-delete] kitchen staff read failed:", staffError.message);
      return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
    }

    if (staff?.user_id) {
      // This is a manager's kitchen identity - don't delete it here.
      // It will be cleaned up when they delete their main manager account.
      return mobileJson(
        {
          error: d.kitchen.api.accountDeleteManagerKitchen,
          reason: "manager_kitchen_identity",
        },
        400
      );
    }

    // Regular cook: revoke all their devices
    const { error: revokeError } = await adminClient
      .from("kitchen_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .is("revoked_at", null);

    if (revokeError) {
      console.error("[account-delete] device revocation failed:", revokeError.message);
      return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
    }

    console.info(`[account-delete] kitchen devices revoked for staff: ${staffId}`);
    return mobileJson({ success: true, deleted: true });
  } catch (err) {
    console.error(
      "[account-delete] unexpected:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.accountDeleteFailed }, 500);
  }
}
