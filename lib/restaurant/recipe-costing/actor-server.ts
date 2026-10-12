import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { loadCompanyMembershipRole } from "@/lib/restaurant/cost-workbook/reset-auth";
import type { RecipeActor } from "./approval";

export async function loadRecipeActor(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<RecipeActor> {
  const [roleLoad, isMiltonStaff] = await Promise.all([
    loadCompanyMembershipRole(supabase, companyId, userId),
    isUserAdminServer(userId),
  ]);
  return {
    user_id: userId,
    role: roleLoad.role,
    is_milton_staff: isMiltonStaff,
  };
}
