// app/api/restaurant/pos-mappings/route.ts
//
// POST /api/restaurant/pos-mappings
// Body: { raw_pos_item_name: string, menu_item_id: string, match_type?: "manual" | "suggested" | "auto" }
//
// Upserts a single mapping; the unique (company_id, raw_pos_item_name)
// constraint means a re-submit moves an existing mapping to a new menu
// item rather than creating a duplicate.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PostBody {
  raw_pos_item_name?: unknown;
  menu_item_id?: unknown;
  match_type?: unknown;
}

const ALLOWED_MATCH_TYPES = new Set(["manual", "suggested", "auto"]);

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
  const matchType =
    typeof body.match_type === "string" &&
    ALLOWED_MATCH_TYPES.has(body.match_type)
      ? body.match_type
      : "manual";

  if (!rawName || !menuItemId) {
    return NextResponse.json(
      { error: "`raw_pos_item_name` and `menu_item_id` are required" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from("pos_item_mappings")
    .upsert(
      {
        company_id: auth.companyId,
        raw_pos_item_name: rawName,
        menu_item_id: menuItemId,
        match_type: matchType,
      },
      { onConflict: "company_id,raw_pos_item_name" }
    )
    .select("id, raw_pos_item_name, menu_item_id, match_type")
    .single();

  if (error || !data) {
    console.error("[pos-mappings POST]", error?.message);
    return NextResponse.json(
      { error: "Upsert failed", details: error?.message },
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

  const { error } = await auth.supabase
    .from("pos_item_mappings")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("raw_pos_item_name", rawName);

  if (error) {
    console.error("[pos-mappings DELETE]", error.message);
    return NextResponse.json(
      { error: "Delete failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
