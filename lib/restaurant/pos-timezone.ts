// lib/restaurant/pos-timezone.ts
//
// IANA timezone for POS hour/weekday math. Same lookup Ask Milton and
// the cockpit heatmap use.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";

export async function resolvePosTimezone(
  supabase: SupabaseClient,
  companyId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("restaurant_pos_connections")
      .select("timezone")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const fromConn = normalizeTimezone(data?.timezone);
    if (fromConn) return fromConn;
  } catch (err) {
    console.error("[pos-timezone] connection lookup:", err);
  }
  try {
    const { data } = await supabase
      .from("companies")
      .select("briefing_email_timezone")
      .eq("id", companyId)
      .maybeSingle();
    const fromCompany = normalizeTimezone(data?.briefing_email_timezone);
    if (fromCompany) return fromCompany;
  } catch (err) {
    console.error("[pos-timezone] company lookup:", err);
  }
  return "UTC";
}
