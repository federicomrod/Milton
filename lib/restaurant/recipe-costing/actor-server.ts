import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActor } from "@/lib/auth/permissions";
import type { RecipeActor } from "./approval";

/**
 * The recipe actor for ONE company: the role is the membership in exactly
 * that company (admin read, trimmed + lowercased); Milton staff via the
 * shared helper. Every permission question then goes through lib/auth.
 */
export async function loadRecipeActor(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<RecipeActor> {
  const actor = await resolveActor(supabase, userId, { companyId });
  return {
    user_id: userId,
    role: actor.role,
    is_milton_staff: actor.isMiltonStaff,
  };
}
