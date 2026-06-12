// app/api/restaurant/prepared-components/[id]/route.ts
//
// PATCH  /api/restaurant/prepared-components/:id   → update fields
//                                                    (typically status)
// DELETE /api/restaurant/prepared-components/:id   → hard delete
//
// We prefer "archive" over "delete" for the dashboard's primary action
// because archived components stay reachable from any existing recipes
// that reference them (FK is ON DELETE RESTRICT). Hard delete is exposed
// for the rare case of cleaning up a typo / accidental duplicate that
// was never referenced anywhere.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "active", "archived"]);

interface PatchBody {
  status?: unknown;
  name?: unknown;
  category?: unknown;
  output_unit?: unknown;
  notes?: unknown;
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
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of draft/active/archived` },
        { status: 400 }
      );
    }
    patch.status = body.status;
  }
  if (typeof body.name === "string" && body.name.trim() !== "") {
    patch.name = body.name.trim();
  }
  if (typeof body.category === "string") {
    patch.category = body.category.trim() || null;
  }
  if (typeof body.output_unit === "string" && body.output_unit.trim() !== "") {
    patch.output_unit = body.output_unit.trim();
  }
  if (typeof body.notes === "string") {
    patch.notes = body.notes.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — supply at least one field" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from("prepared_components")
    .update(patch)
    .eq("company_id", auth.companyId)
    .eq("id", id)
    .select("id, name, category, output_unit, status, notes")
    .single();

  if (error || !data) {
    const pgCode = (error as { code?: string } | null)?.code;
    // 23505: renaming into an existing-name conflict.
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Another component with that name already exists" },
        { status: 409 }
      );
    }
    console.error("[components PATCH]", error?.message);
    return NextResponse.json(
      { error: "Update failed", details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ component: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { error } = await auth.supabase
    .from("prepared_components")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("id", id);

  if (error) {
    // 23503: foreign_key_violation — the component is referenced by a
    // recipe somewhere. Tell the user to archive instead.
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23503") {
      return NextResponse.json(
        {
          error:
            "This component is referenced by an existing recipe. Archive it instead of deleting.",
          details: error.message,
        },
        { status: 409 }
      );
    }
    console.error("[components DELETE]", error.message);
    return NextResponse.json(
      { error: "Delete failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
