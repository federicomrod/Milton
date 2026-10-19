import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyRole } from "@/lib/auth/permissions";

export interface CompanyMembershipRoleLoad {
  role: string | null;
}

/** Kept for callers that load the role first; it is the shared helper's read. */
export async function loadCompanyMembershipRole(
  _supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<CompanyMembershipRoleLoad> {
  return { role: await loadCompanyRole(companyId, userId) };
}

export async function loadCompanyName(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  return name || null;
}
