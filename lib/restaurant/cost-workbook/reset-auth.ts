import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompanyMembershipRoleLoad {
  role: string | null;
}

export async function loadCompanyMembershipRole(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<CompanyMembershipRoleLoad> {
  const { data, error } = await supabase
    .from("company_memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return {
    role: typeof data?.role === "string" ? data.role : null,
  };
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
