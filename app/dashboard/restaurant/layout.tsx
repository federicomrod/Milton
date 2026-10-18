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

import RestaurantShellLayout from "@/components/restaurant/RestaurantShellLayout";

export default function RestaurantSubRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RestaurantShellLayout>{children}</RestaurantShellLayout>;
}
