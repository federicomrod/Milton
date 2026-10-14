// app/(restaurant-cockpit)/layout.tsx
//
// Wraps every page in the (restaurant-cockpit) route group with the
// restaurant shell (left sidebar + main column). Only the cockpit page
// currently lives in this group; sub-routes (upload, menu, ingredients,
// invoices, agents) live under app/dashboard/restaurant/* and get the
// same shell via that path's own layout.

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export default async function RestaurantCockpitGroupLayout({
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
