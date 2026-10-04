// lib/restaurant/post-login.ts
//
// Landing rule for INVITED users (R1 item 2): straight to the dashboard
// when the workspace already has a data connection, otherwise to the
// minimal "Connect your data" screen. Used right after invite acceptance,
// in app/auth/callback/route.ts and in the login form's redirect, so an
// invitee never bounces into the self-serve /onboarding/restaurant wizard.
// Safe for browser and server (takes a Supabase client, imports no
// server-only modules).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDataConnectionStatus, hasDataConnection } from "./data-connection";

export const RESTAURANT_DASHBOARD_PATH = "/dashboard/restaurant";
export const CONNECT_DATA_PATH = "/dashboard/restaurant/connect-data";

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
