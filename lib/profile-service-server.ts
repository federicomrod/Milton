import { createClient } from "@/lib/supabase/server";

import type { UserRole } from "@/lib/types/data";

export interface UserProfile {
  user_id: string;
  id?: string;
  role: UserRole;
  timezone?: string;
  currency?: string;
  date_format?: string;
  number_format?: string;
  theme?: string;
  billing_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  created_by: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Check if a user has admin role (server-side version)
 * Used in API routes and server components.
 * Calls the is_milton_admin() RPC which checks the milton_admins table
 * (migration 020).
 */
export async function isUserAdminServer(userId?: string): Promise<boolean> {
  const supabase = await createClient();
  const userIdToCheck = userId || (await supabase.auth.getUser()).data.user?.id;

  if (!userIdToCheck) {
    return false;
  }

  const { data, error } = await supabase.rpc("is_milton_admin");

  if (error) {
    console.error("Error checking admin status:", error.message);
    return false;
  }

  return data === true;
}

/**
 * Get the role of a user (server-side version).
 * For Milton admins, checks the is_milton_admin() RPC.
 * For restaurant-level roles (owner, manager, member), check
 * company_memberships.role via resolveCompanyIdForUser.
 */
export async function getUserRoleServer(userId?: string): Promise<UserRole> {
  const supabase = await createClient();
  const userIdToCheck = userId || (await supabase.auth.getUser()).data.user?.id;

  if (!userIdToCheck) {
    return "user";
  }

  const { data, error } = await supabase.rpc("is_milton_admin");

  if (error) {
    console.error("Error fetching user role:", error.message);
    return "user";
  }

  return data === true ? "admin" : "user";
}

/**
 * Get user profile (server-side version)
 */
export async function getUserProfileServer(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (getUserProfileServer):", userError);
  if (!user) {
    console.warn("No authenticated user found in getUserProfileServer()");
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) {
    console.error("Error fetching user profile:", error.message);
    return null;
  }

  return data as UserProfile;
}
