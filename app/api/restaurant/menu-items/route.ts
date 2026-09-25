// app/api/restaurant/menu-items/route.ts
//
// GET  /api/restaurant/menu-items  → { menu_items: MenuItemRow[] }
// POST /api/restaurant/menu-items  → create a menu item, optionally also
//                                   write a pos_item_mappings row tying a
//                                   raw POS name to the new menu item.
//
// The POST body shape supports the "Create menu item from unmatched POS"
// flow in /dashboard/restaurant/menu:
//   {
//     name: string,
//     category?: string | null,
//     selling_price?: number | null,
//     currency?: string,
//     // optional (Multi-Restaurant v1): scope the new item to one brand.
//     // Omitted/invalid -> brand_id NULL, same as today (legacy/company-wide).
//     brand_id?: string,
//     // when present, the new menu item is also bound to this raw POS name
//     raw_pos_item_name?: string,
//     // optional (Multi-Restaurant v1): scope the mapping to one location.
//     // Omitted -> company-wide/legacy mapping, same as today.
//     location_id?: string,
//   }

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { upsertPosItemMapping } from "@/lib/restaurant/pos-item-mappings-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("menu_items")
    .select(
      "id, name, category, selling_price, currency, status, is_live, sub_category, pos_display_name, brand_id, created_at, updated_at"
    )
    .eq("company_id", auth.companyId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[menu-items GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ menu_items: data ?? [] });
}

interface CreateBody {
  name?: unknown;
  category?: unknown;
  selling_price?: unknown;
  currency?: unknown;
  brand_id?: unknown;
  raw_pos_item_name?: unknown;
  location_id?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "`name` is required" }, { status: 400 });
  }
  const category =
    typeof body.category === "string" && body.category.trim() !== ""
      ? body.category.trim()
      : null;
  const sellingPrice =
    typeof body.selling_price === "number" &&
    Number.isFinite(body.selling_price)
      ? body.selling_price
      : null;
  const currency =
    typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
      ? body.currency
      : "MXN";
  const rawPosItemName =
    typeof body.raw_pos_item_name === "string"
      ? body.raw_pos_item_name.trim()
      : "";
  const requestedBrandId =
    typeof body.brand_id === "string" && body.brand_id.trim()
      ? body.brand_id.trim()
      : null;
  const requestedLocationId =
    typeof body.location_id === "string" && body.location_id.trim()
      ? body.location_id.trim()
      : null;

  // Never trust brand_id/location_id blindly — confirm each belongs to
  // this company before using it, same anti-tenancy-bypass rule as
  // company_id itself.
  let brandId: string | null = null;
  if (requestedBrandId) {
    const { data: brand } = await auth.supabase
      .from("restaurant_brands")
      .select("id")
      .eq("id", requestedBrandId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (!brand) {
      return NextResponse.json(
        { error: "brand_id does not belong to this company" },
        { status: 400 }
      );
    }
    brandId = brand.id;
  }
  let locationId: string | null = null;
  if (requestedLocationId) {
    const { data: location } = await auth.supabase
      .from("restaurant_locations")
      .select("id")
      .eq("id", requestedLocationId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (!location) {
      return NextResponse.json(
        { error: "location_id does not belong to this company" },
        { status: 400 }
      );
    }
    locationId = location.id;
  }

  // Insert the menu item. We don't set status here — let the table default
  // win (active/inactive vocabulary from the legacy schema is preserved).
  // brand_id is nullable (migration 004) — omitted/invalid stays NULL,
  // i.e. legacy/company-wide, identical to today's behavior.
  const insertPayload: Record<string, unknown> = {
    company_id: auth.companyId,
    name,
    category,
    selling_price: sellingPrice,
    currency,
    brand_id: brandId,
  };

  const { data: menuItem, error: insertErr } = await auth.supabase
    .from("menu_items")
    .insert(insertPayload)
    .select(
      "id, name, category, selling_price, currency, status, is_live, brand_id"
    )
    .single();

  if (insertErr || !menuItem) {
    console.error("[menu-items POST]", insertErr?.message);
    return NextResponse.json(
      {
        error: "Create failed",
        details: insertErr?.message ?? "no row returned",
      },
      { status: 500 }
    );
  }

  // Optional mapping. Done as a second statement so a mapping failure
  // doesn't roll back the menu item creation — the user can still see
  // the new row and re-bind it manually. location_id NULL (the default
  // when not provided) preserves today's company-wide mapping behavior.
  let mappingError: string | null = null;
  if (rawPosItemName) {
    const { error } = await upsertPosItemMapping(auth.supabase, {
      companyId: auth.companyId,
      locationId,
      rawPosItemName,
      menuItemId: menuItem.id,
      matchType: "manual",
    });
    if (error) {
      console.error("[menu-items POST mapping]", error);
      mappingError = error;
    }
  }

  return NextResponse.json({ menu_item: menuItem, mappingError });
}
