// app/api/restaurant/kitchen/recipe-drafts/route.ts
//
// GET /api/restaurant/kitchen/recipe-drafts
//
// Lists recipe drafts (draft and awaiting_portions only; confirmed and
// rejected are excluded). Filterable by location. SELECT policy allows
// any company member to read; only service role creates drafts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("location_id") || "";

  const supabase = await createClient();
  let query = supabase
    .from("kitchen_recipe_drafts")
    .select(
      `
      id,
      dish_name,
      portions,
      status,
      confidence,
      per_portion_cost,
      currency,
      created_at,
      kitchen_staff!inner(display_name),
      restaurant_locations!inner(name)
    `
    )
    .eq("company_id", auth.companyId)
    .in("status", ["draft", "awaiting_portions"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (locationId) {
    query = query.eq("location_id", locationId);
  }

  const { data: drafts, error } = await query;

  if (error) {
    console.error("[recipe-drafts] list failed:", error.message);
    return NextResponse.json(
      { error: "Could not load drafts." },
      { status: 500 }
    );
  }

  const draftIds = drafts?.map((d) => d.id) ?? [];
  const { data: lines } = await supabase
    .from("kitchen_recipe_draft_lines")
    .select("*")
    .in("draft_id", draftIds)
    .order("line_number", { ascending: true });

  const linesMap = new Map<string, typeof lines>();
  for (const line of lines ?? []) {
    if (!linesMap.has(line.draft_id)) {
      linesMap.set(line.draft_id, []);
    }
    linesMap.get(line.draft_id)!.push(line);
  }

  const enriched = (drafts ?? []).map((d) => ({
    id: d.id,
    dish_name: d.dish_name,
    portions: d.portions,
    status: d.status,
    confidence: d.confidence,
    per_portion_cost: d.per_portion_cost,
    currency: d.currency,
    created_at: d.created_at,
    staff_name: (d.kitchen_staff as unknown as { display_name: string })
      .display_name,
    location_name: (d.restaurant_locations as unknown as { name: string }).name,
    lines: linesMap.get(d.id) ?? [],
  }));

  return NextResponse.json({ drafts: enriched });
}
