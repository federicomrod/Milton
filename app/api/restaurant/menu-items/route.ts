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
//     // when present, the new menu item is also bound to this raw POS name
//     raw_pos_item_name?: string,
//   }

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("menu_items")
    .select(
      "id, name, category, selling_price, currency, status, is_live, sub_category, pos_display_name, created_at, updated_at"
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
  raw_pos_item_name?: unknown;
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

  // Insert the menu item. We don't set status here — let the table default
  // win (active/inactive vocabulary from the legacy schema is preserved).
  const insertPayload: Record<string, unknown> = {
    company_id: auth.companyId,
    name,
    category,
    selling_price: sellingPrice,
    currency,
  };

  const { data: menuItem, error: insertErr } = await auth.supabase
    .from("menu_items")
    .insert(insertPayload)
    .select("id, name, category, selling_price, currency, status, is_live")
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
  // the new row and re-bind it manually.
  let mappingError: string | null = null;
  if (rawPosItemName) {
    const { error: mapErr } = await auth.supabase
      .from("pos_item_mappings")
      .upsert(
        {
          company_id: auth.companyId,
          raw_pos_item_name: rawPosItemName,
          menu_item_id: menuItem.id,
          match_type: "manual",
        },
        { onConflict: "company_id,raw_pos_item_name" }
      );
    if (mapErr) {
      console.error("[menu-items POST mapping]", mapErr.message);
      mappingError = mapErr.message;
    }
  }

  return NextResponse.json({ menu_item: menuItem, mappingError });
}
