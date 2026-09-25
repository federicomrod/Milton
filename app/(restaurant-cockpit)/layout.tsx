// app/(restaurant-cockpit)/layout.tsx
//
// Wraps every page in the (restaurant-cockpit) route group with the
// restaurant shell (left sidebar + main column). Only the cockpit page
// currently lives in this group; sub-routes (upload, menu, ingredients,
// invoices, agents) live under app/dashboard/restaurant/* and get the
// same shell via that path's own layout.

import { RestaurantShell } from "@/components/restaurant/RestaurantShell";
import { createClient } from "@/lib/supabase/server";
import { listRestaurantLocationsForCurrentUser } from "@/lib/restaurant/restaurant-context-server";

export default async function RestaurantCockpitGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Best-effort: an env/auth failure here should never break the page —
  // the switcher just renders with an empty (single-restaurant) list.
  let locations: { id: string; name: string }[] = [];
  try {
    const supabase = await createClient();
    locations = await listRestaurantLocationsForCurrentUser(supabase);
  } catch (err) {
    console.error("[RestaurantCockpitGroupLayout] locations load failed:", err);
  }
  return <RestaurantShell locations={locations}>{children}</RestaurantShell>;
}
