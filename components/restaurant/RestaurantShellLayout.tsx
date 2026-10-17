// The shared left-sidebar shell as a layout. ONE component for every route
// that lives inside the restaurant app: /dashboard/restaurant/* and the
// account / settings pages reached from Configuración. (Server component.)

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export default async function RestaurantShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const chrome = await loadRestaurantShellChrome();
  return (
    <RestaurantShell
      locations={chrome.locations}
      lang={chrome.lang}
      isAdmin={chrome.isAdmin}
      lastSyncedAt={chrome.lastSyncedAt}
      userName={chrome.userName ?? null}
    >
      {children}
    </RestaurantShell>
  );
}
