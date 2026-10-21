// The shared left-sidebar shell as a layout. ONE component for every route
// that lives inside the restaurant app: /dashboard/restaurant/* and the
// account / settings pages reached from Configuración. (Server component.)

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { capabilityFlags, resolveActor } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export default async function RestaurantShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const chrome = await loadRestaurantShellChrome();
  const capabilities = await loadCapabilityFlags();
  return (
    <RestaurantShell
      locations={chrome.locations}
      lang={chrome.lang}
      isAdmin={chrome.isAdmin}
      lastSyncedAt={chrome.lastSyncedAt}
      userName={chrome.userName ?? null}
      capabilities={capabilities}
    >
      {children}
    </RestaurantShell>
  );
}

/** The server's can() answers for the signed-in person, for the client controls. */
async function loadCapabilityFlags() {
  try {
    const user = await getCachedAuthUser();
    if (!user?.id) return undefined;
    const companyId = await getCachedCompanyId(user.id);
    if (!companyId) return undefined;
    const actor = await resolveActor(await createClient(), user.id, {
      companyId,
    });
    return capabilityFlags(actor);
  } catch {
    return undefined;
  }
}
