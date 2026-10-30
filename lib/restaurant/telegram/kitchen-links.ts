// lib/restaurant/telegram/kitchen-links.ts
//
// A Telegram account can be a cook at several restaurants: one active
// kitchen_staff row per (telegram_user_id, location_id) is one "link".
// Kitchen staff are NOT Milton users, so nothing here looks at
// company_memberships. Service role (admin client); errors throw to the
// caller like findActiveKitchenStaff always did, except validateLink,
// which answers null when it cannot confirm the link.
//
// A link only counts while its row is active AND its location still
// belongs to the row's company and is not archived.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveRestaurantCockpitLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export interface KitchenLink {
  staffId: string;
  companyId: string;
  companyName: string;
  locationId: string;
  locationName: string;
  telegramUserId: number;
  /** The company's language: what the cook's replies are written in. */
  language?: PreferredLanguage;
}

interface StaffRow {
  id: string;
  company_id: string;
  location_id: string;
  telegram_user_id: number;
}

async function resolveLinks(
  rows: StaffRow[],
  telegramUserId: number
): Promise<KitchenLink[]> {
  if (rows.length === 0) return [];
  const admin = createAdminClient();
  const locationIds = [...new Set(rows.map((r) => r.location_id))];
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const [locRes, coRes] = await Promise.all([
    admin
      .from("restaurant_locations")
      .select("id, company_id, name, status, archived_at")
      .in("id", locationIds),
    admin
      .from("companies")
      .select("id, name, preferred_language")
      .in("id", companyIds),
  ]);
  if (locRes.error || coRes.error) throw new Error("link lookup failed");

  const locations = new Map(
    (locRes.data ?? []).map((l) => [l.id as string, l])
  );
  const companies = new Map(
    (coRes.data ?? []).map((c) => [c.id as string, (c.name as string) ?? ""])
  );
  const languages = new Map(
    (coRes.data ?? []).map((c) => [
      c.id as string,
      resolveRestaurantCockpitLanguage(
        (c as { preferred_language?: unknown }).preferred_language
      ),
    ])
  );

  const links: KitchenLink[] = [];
  for (const row of rows) {
    const loc = locations.get(row.location_id);
    if (!loc || loc.company_id !== row.company_id) continue;
    if (loc.archived_at) continue;
    if (loc.status != null && loc.status !== "active") continue;
    links.push({
      staffId: row.id,
      companyId: row.company_id,
      companyName: companies.get(row.company_id) ?? "",
      locationId: row.location_id,
      locationName: (loc.name as string) ?? "",
      telegramUserId,
      language: languages.get(row.company_id),
    });
  }
  return links;
}

/** The account's usable links, sorted by company then local name. */
export async function listActiveLinks(
  telegramUserId: number
): Promise<KitchenLink[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchen_staff")
    .select("id, company_id, location_id, telegram_user_id")
    .eq("telegram_user_id", telegramUserId)
    .eq("is_active", true);
  if (error) throw new Error("staff lookup failed");
  const links = await resolveLinks((data ?? []) as StaffRow[], telegramUserId);
  return links.sort(
    (a, b) =>
      a.companyName.localeCompare(b.companyName, "es") ||
      a.locationName.localeCompare(b.locationName, "es")
  );
}

/**
 * Re-reads one link from the DB. null when the row is inactive, removed,
 * belongs to another Telegram account, or its location is gone / archived.
 */
export async function validateLink(
  telegramUserId: number,
  staffId: string
): Promise<KitchenLink | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("kitchen_staff")
      .select("id, company_id, location_id, telegram_user_id")
      .eq("id", staffId)
      .eq("telegram_user_id", telegramUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return null;
    const links = await resolveLinks([data as StaffRow], telegramUserId);
    return links[0] ?? null;
  } catch {
    return null;
  }
}
