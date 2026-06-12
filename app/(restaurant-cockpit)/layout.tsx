// app/(restaurant-cockpit)/layout.tsx
//
// Wraps every page in the (restaurant-cockpit) route group with the
// restaurant shell (left sidebar + main column). Only the cockpit page
// currently lives in this group; sub-routes (upload, menu, ingredients,
// invoices, agents) live under app/dashboard/restaurant/* and get the
// same shell via that path's own layout.

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";

export default function RestaurantCockpitGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RestaurantShell>{children}</RestaurantShell>;
}
