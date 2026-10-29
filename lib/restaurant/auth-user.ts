// lib/restaurant/auth-user.ts
//
// One Auth getUser() per request. proxy.ts already called it; the
// cockpit loaders were calling it again (and again inside chrome).

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { resolveActor } from "@/lib/auth/permissions";

export const getCachedAuthUser = cache(async () => {
  return timeCockpitStep("auth", async () => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  });
});

export const getCachedCompanyId = cache(async (userId: string) => {
  const supabase = await createClient();
  return resolveCompanyIdForUser(supabase, userId);
});

/** One is_milton_admin() call per request (the layout and the page both ask). */
export const getCachedIsMiltonAdmin = cache(async (userId: string) =>
  isUserAdminServer(userId)
);

/**
 * The person's role in their company, once per request: the layout, the page
 * and its tabs all share this one membership lookup. Keyed by (user, company),
 * so it can never answer for a different company.
 */
export const getCachedActor = cache(
  async (userId: string, companyId: string) => {
    const [supabase, isMiltonStaff] = await Promise.all([
      createClient(),
      getCachedIsMiltonAdmin(userId),
    ]);
    return resolveActor(supabase, userId, { companyId, isMiltonStaff });
  }
);
