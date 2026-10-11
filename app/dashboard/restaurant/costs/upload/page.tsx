// Server wrapper so the upload form knows which restaurant is selected.
// The switcher lives in the restaurant shell; we refuse "Todos los
// restaurantes" when the company has more than one location.

import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  canManageCompanyCostReset,
  resolveUploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook";
import {
  loadCompanyMembershipRole,
  loadCompanyName,
} from "@/lib/restaurant/cost-workbook/reset-auth";
import { CostUploadPageClient } from "./upload-page-client";

export default async function CostUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const params = await searchParams;
  const chrome = await loadRestaurantShellChrome();
  const scope = resolveUploadRestaurantScope({
    locations: chrome.locations,
    requestedLocationId: params.location ?? null,
  });

  let companyName: string | null = null;
  let canManageReset = false;
  try {
    const supabase = await createClient();
    const user = await getCachedAuthUser();
    const companyId = user?.id ? await getCachedCompanyId(user.id) : null;
    if (user?.id && companyId) {
      const [name, membership] = await Promise.all([
        loadCompanyName(supabase, companyId),
        loadCompanyMembershipRole(supabase, companyId, user.id),
      ]);
      companyName = name;
      canManageReset = canManageCompanyCostReset(membership);
    }
  } catch (err) {
    console.error("[costs/upload] reset gate", err);
  }

  return (
    <CostUploadPageClient
      lang={chrome.lang}
      locations={chrome.locations}
      scope={scope}
      companyName={companyName}
      canManageReset={canManageReset}
    />
  );
}
