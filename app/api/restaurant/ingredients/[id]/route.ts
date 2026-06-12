// app/api/restaurant/ingredients/[id]/route.ts
//
// PATCH /api/restaurant/ingredients/:id
//   Update name / category / default_unit on an existing ingredient.
//
// Why this exists: the create form defaults default_unit to "kg" and the
// user only realises a unit-based ingredient (e.g. burger buns) needs a
// different unit AFTER creating it. Without a PATCH endpoint they have
// to drop into Supabase to fix it.
//
// Note: changing default_unit does NOT re-normalise existing cost
// entries. The dashboard surfaces this honestly — old cost rows continue
// to render with their original normalized_unit and the costing engine
// will flag a `missing_unit_conversion` if a recipe asks for the new
// unit and there's no convertible cost entry. The user can delete the
// outdated entry via the cost-entries DELETE endpoint.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PatchBody {
  name?: unknown;
  category?: unknown;
  default_unit?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim() !== "") {
    patch.name = body.name.trim();
  }
  if (typeof body.category === "string") {
    patch.category = body.category.trim() || null;
  }
  if (
    typeof body.default_unit === "string" &&
    body.default_unit.trim() !== ""
  ) {
    patch.default_unit = body.default_unit.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — supply at least one field" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from("ingredients")
    .update(patch)
    .eq("company_id", auth.companyId)
    .eq("id", id)
    .select("id, name, category, default_unit, current_unit_cost, currency")
    .single();

  if (error || !data) {
    // 23505 = unique violation on (company_id, name).
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Another ingredient with that name already exists" },
        { status: 409 }
      );
    }
    console.error("[ingredients PATCH]", error?.message);
    return NextResponse.json(
      { error: "Update failed", details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ingredient: data });
}
