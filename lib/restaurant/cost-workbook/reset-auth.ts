import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";

export interface CompanyMembershipRoleLoad {
  role: string | null;
  roleColumnMissing: boolean;
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

  if (error && errorMentionsColumn(error, "role")) {
    return { role: null, roleColumnMissing: true };
  }
  if (error) {
    throw new Error(error.message);
  }
  return {
    role: typeof data?.role === "string" ? data.role : null,
    roleColumnMissing: false,
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
