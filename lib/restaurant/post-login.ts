// lib/restaurant/post-login.ts
//
// Where a user lands after password login, magic/confirm links, and
// invite acceptance. Shared by the login form and app/auth/callback so
// those paths cannot drift (GitHub #77).
//
// Order: Milton admin → invited-user rule → self-serve wizard if the
// company has not finished onboarding → restaurant dashboard.
// Safe for browser and server (takes a Supabase client, imports no
// server-only modules).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDataConnectionStatus, hasDataConnection } from "./data-connection";
import { resolveCompanyIdForUser } from "./supabase-sales";

export const RESTAURANT_DASHBOARD_PATH = "/dashboard/restaurant";
export const CONNECT_DATA_PATH = "/dashboard/restaurant/connect-data";
export const ONBOARDING_WIZARD_PATH = "/onboarding/restaurant";
export const MANAGEMENT_DASHBOARD_PATH = "/management/dashboard";

/** Pure. */
export function landingForConnection(connected: boolean): string {
  return connected ? RESTAURANT_DASHBOARD_PATH : CONNECT_DATA_PATH;
}

/**
 * Returns the landing path for an invited user, or null when the user was
 * not invited (callers then keep their normal routing). The invited check
 * goes through current_user_was_invited() because invitees have no read
 * access to workspace_invites. Pass assumeInvited when the caller has just
 * accepted the invite (e.g. with an admin client, where auth.uid() is
 * unset).
 */
export async function resolveInvitedUserLanding(
  supabase: SupabaseClient,
  companyId: string,
  options: { assumeInvited?: boolean } = {}
): Promise<string | null> {
  if (!options.assumeInvited) {
    const { data, error } = await supabase.rpc("current_user_was_invited");
    if (error || data !== true) return null;
  }
  try {
    const status = await getDataConnectionStatus(supabase, companyId);
    return landingForConnection(hasDataConnection(status));
  } catch {
    // Never block a login over a status lookup failure.
    return RESTAURANT_DASHBOARD_PATH;
  }
}

/** Pure. Self-serve users who have not finished the wizard stay in it. */
export function landingForOnboardingStatus(
  onboardingStatus: string | null | undefined
): string {
  return onboardingStatus === "completed"
    ? RESTAURANT_DASHBOARD_PATH
    : ONBOARDING_WIZARD_PATH;
}

/**
 * Post-login landing for password login and auth-callback links.
 * Milton admins and invited users keep their existing rules; a brand-new
 * self-serve company still goes to the wizard until onboarding_status is
 * 'completed'. Lookup failures never block login (dashboard fallback).
 */
export async function getPostLoginRedirect(
  supabase: SupabaseClient
): Promise<string> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return RESTAURANT_DASHBOARD_PATH;

    const { data: isAdmin, error } = await supabase.rpc("is_milton_admin");
    if (error) {
      console.error("[post-login] is_milton_admin RPC error:", error.message);
    }
    if (isAdmin === true) return MANAGEMENT_DASHBOARD_PATH;

    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (companyId) {
      const invitedLanding = await resolveInvitedUserLanding(
        supabase,
        companyId
      );
      if (invitedLanding) return invitedLanding;

      const { data: company } = await supabase
        .from("companies")
        .select("onboarding_status")
        .eq("id", companyId)
        .maybeSingle();
      return landingForOnboardingStatus(company?.onboarding_status);
    }

    return RESTAURANT_DASHBOARD_PATH;
  } catch {
    return RESTAURANT_DASHBOARD_PATH;
  }
}
