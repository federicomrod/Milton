// app/dashboard/restaurant/layout.tsx
//
// Wraps every /dashboard/restaurant/* sub-route (upload, menu, ingredients,
// invoices, agents) with the restaurant shell. The cockpit itself lives
// at /dashboard/restaurant via the (restaurant-cockpit) route group and
// uses that group's layout — so this file is for SUB-routes only.
//
// Note: this layout nests INSIDE app/dashboard/layout.tsx, which still
// runs its own client effects (data status, chat panel). Those don't
// conflict with the sidebar: the chat panel is `position: fixed` and the
// data-status redirect already exempts /dashboard/restaurant/*.

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";

export default function RestaurantSubRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RestaurantShell>{children}</RestaurantShell>;
}
