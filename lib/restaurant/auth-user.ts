// lib/restaurant/auth-user.ts
//
// One Auth getUser() per request. proxy.ts already called it; the
// cockpit loaders were calling it again (and again inside chrome).

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";

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
