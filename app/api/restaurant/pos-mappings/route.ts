// app/api/restaurant/pos-mappings/route.ts
//
// POST /api/restaurant/pos-mappings
// Body: { raw_pos_item_name: string, menu_item_id: string, match_type?: "manual" | "suggested" | "auto", location_id?: string }
//
// Upserts a single mapping. Location-aware (migration 015): when
// `location_id` is provided (and belongs to this company), the mapping is
// scoped to that location — the same raw name can map differently at a
// different location. Omitted -> a company-wide/legacy mapping, same
// behavior as before this change. A re-submit for the same
// (company, location, raw name) moves the existing mapping to a new menu
// item rather than creating a duplicate; see
// lib/restaurant/pos-item-mappings-server.ts for why this uses an
// explicit lookup-then-insert-or-update instead of .upsert().
//
// DELETE /api/restaurant/pos-mappings?raw_pos_item_name=...&location_id=...
// location_id omitted -> deletes the company-wide/legacy mapping only,
// never a location-specific one, so callers don't need to fear an
// omitted param wiping every location's mapping for that name.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  upsertPosItemMapping,
  deletePosItemMapping,
} from "@/lib/restaurant/pos-item-mappings-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PostBody {
  raw_pos_item_name?: unknown;
  menu_item_id?: unknown;
  match_type?: unknown;
  location_id?: unknown;
}

type MatchType = "manual" | "suggested" | "auto";
const ALLOWED_MATCH_TYPES: ReadonlySet<MatchType> = new Set([
  "manual",
  "suggested",
  "auto",
]);
function isMatchType(v: string): v is MatchType {
  return ALLOWED_MATCH_TYPES.has(v as MatchType);
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const rawName =
    typeof body.raw_pos_item_name === "string"
      ? body.raw_pos_item_name.trim()
      : "";
  const menuItemId =
    typeof body.menu_item_id === "string" ? body.menu_item_id.trim() : "";
  const matchType: MatchType =
    typeof body.match_type === "string" && isMatchType(body.match_type)
      ? body.match_type
      : "manual";
  const requestedLocationId =
    typeof body.location_id === "string" && body.location_id.trim()
      ? body.location_id.trim()
      : null;

  if (!rawName || !menuItemId) {
    return NextResponse.json(
      { error: "`raw_pos_item_name` and `menu_item_id` are required" },
      { status: 400 }
    );
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

  const { error } = await upsertPosItemMapping(auth.supabase, {
    companyId: auth.companyId,
    locationId,
    rawPosItemName: rawName,
    menuItemId,
    matchType,
  });
  if (error) {
    console.error("[pos-mappings POST]", error);
    return NextResponse.json(
      { error: "Upsert failed", details: error },
      { status: 500 }
    );
  }

  let readQuery = auth.supabase
    .from("pos_item_mappings")
    .select("id, raw_pos_item_name, menu_item_id, match_type, location_id")
    .eq("company_id", auth.companyId)
    .eq("raw_pos_item_name", rawName);
  readQuery = locationId
    ? readQuery.eq("location_id", locationId)
    : readQuery.is("location_id", null);
  const { data, error: readError } = await readQuery.maybeSingle();

  if (readError || !data) {
    console.error("[pos-mappings POST readback]", readError?.message);
    return NextResponse.json(
      {
        error: "Upsert succeeded but readback failed",
        details: readError?.message,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ mapping: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawName = url.searchParams.get("raw_pos_item_name");
  if (!rawName) {
    return NextResponse.json(
      { error: "`raw_pos_item_name` query param required" },
      { status: 400 }
    );
  }
  const requestedLocationId = url.searchParams.get("location_id");

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

  const { error } = await deletePosItemMapping(auth.supabase, {
    companyId: auth.companyId,
    locationId,
    rawPosItemName: rawName,
  });
  if (error) {
    console.error("[pos-mappings DELETE]", error);
    return NextResponse.json(
      { error: "Delete failed", details: error },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
