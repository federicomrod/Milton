// The shared left-sidebar shell as a layout. ONE component for every route
// that lives inside the restaurant app: /dashboard/restaurant/* and the
// account / settings pages reached from Configuración. (Server component.)

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { capabilityFlags } from "@/lib/auth/permissions";
import {
  getCachedAuthUser,
  getCachedActor,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export default async function RestaurantShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Independent reads, started together (both share the cached user, company
  // and membership lookups, so nothing is asked twice).
  const [chrome, capabilities] = await Promise.all([
    loadRestaurantShellChrome(),
    loadCapabilityFlags(),
  ]);
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
    return capabilityFlags(await getCachedActor(user.id, companyId));
  } catch {
    return undefined;
  }
}
