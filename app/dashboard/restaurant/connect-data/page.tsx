// app/dashboard/restaurant/connect-data/page.tsx
//
// Minimal "Connect your data" screen (R1 item 2, Decision 2) — where an
// invited user lands when their workspace has no data connection yet.
// Auth-gated by proxy.ts and rendered inside RestaurantShell via the
// /dashboard/restaurant layout. It only links to the existing upload tab
// and records honest requests; it builds no Odoo connect UI and calls no
// Odoo APIs (that is item 3).

import { createClient } from "@/lib/supabase/server";
import { ConnectDataOptions } from "@/components/restaurant/connect-data/ConnectDataOptions";
import { optionKeyForPrimaryPos } from "@/lib/restaurant/connect-data-copy";

export const dynamic = "force-dynamic";

export default async function ConnectDataPage() {
  let highlighted: ReturnType<typeof optionKeyForPrimaryPos> = null;
  try {
    const supabase = await createClient();
    // RLS scopes this to the caller's own company; first location wins.
    const { data } = await supabase
      .from("restaurant_locations")
      .select("primary_pos")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    highlighted = optionKeyForPrimaryPos(
      (data as { primary_pos?: string | null } | null)?.primary_pos
    );
  } catch {
    highlighted = null;
  }
  return <ConnectDataOptions highlightedKey={highlighted} />;
}
