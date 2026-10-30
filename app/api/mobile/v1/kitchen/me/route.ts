// app/api/mobile/v1/kitchen/me/route.ts
//
// GET: the cook's name, restaurant(s) and company name. Device token as
// bearer. Serialized through the allow-list: no money, ever.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import { serializeKitchenMe } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff, companyId, locationIds } = auth;
  try {
    const [company, locations] = await Promise.all([
      admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
      admin
        .from("restaurant_locations")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", locationIds),
    ]);
    if (company.error || locations.error) {
      return kitchenJson({ error: d.kitchen.api.accountLoadFailed }, 500);
    }
    return kitchenJson(
      serializeKitchenMe({
        staff: { id: staff.id, display_name: staff.displayName },
        company: (company.data as Record<string, unknown> | null) ?? null,
        locations: (locations.data ?? []) as Record<string, unknown>[],
      })
    );
  } catch (err) {
    console.error(
      "[mobile-kitchen-me] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.accountLoadFailed }, 500);
  }
}
