// app/dashboard/restaurant/layout.tsx
//
// Wraps EVERY /dashboard/restaurant page — the Cockpit (this folder's page.tsx),
// Menú, Ventas, Costos, Cocina… — with the restaurant shell. ONE layout, so the
// sidebar and the shell stay mounted when switching between them.
//
// Note: this layout nests INSIDE app/dashboard/layout.tsx, which still
// runs its own client effects (data status, chat panel). Those don't
// conflict with the sidebar: the chat panel is `position: fixed` and the
// data-status redirect already exempts /dashboard/restaurant/*.

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";

export default async function RestaurantSubRoutesLayout({
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
