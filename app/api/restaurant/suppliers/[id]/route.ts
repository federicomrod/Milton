// app/api/restaurant/suppliers/[id]/route.ts
//
// PATCH /api/restaurant/suppliers/:id
//   Update any combination of: name, contact_name, email, phone,
//   notes, address, payment_terms, tax_id, status.
//
// DELETE /api/restaurant/suppliers/:id
//   Soft-delete: sets status = 'archived'. Never hard-deletes so that
//   linked ingredient_cost_entries retain their supplier reference.
//   Returns 409 if hard-delete is requested while cost entries exist.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PatchBody {
  name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  address?: unknown;
  payment_terms?: unknown;
  tax_id?: unknown;
  status?: unknown;
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

  const str = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim() !== "") {
    patch.name = body.name.trim();
  }
  // Nullable string fields — empty string clears the value.
  for (const field of [
    "contact_name",
    "email",
    "phone",
    "notes",
    "address",
    "payment_terms",
    "tax_id",
  ] as const) {
    if (field in body) patch[field] = str(body[field]);
  }
  if (
    typeof body.status === "string" &&
    ["active", "inactive", "archived"].includes(body.status)
  ) {
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — supply at least one field" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from("suppliers")
    .update(patch)
    .eq("company_id", auth.companyId)
    .eq("id", id)
    .select(
      "id, name, status, contact_name, email, phone, notes, address, payment_terms, tax_id, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "A supplier with that name already exists" },
        { status: 409 }
      );
    }
    console.error("[suppliers PATCH]", error?.message);
    return NextResponse.json(
      { error: "Update failed", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ supplier: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  // Soft-delete only — set status to archived.
  const { data, error } = await auth.supabase
    .from("suppliers")
    .update({ status: "archived" })
    .eq("company_id", auth.companyId)
    .eq("id", id)
    .select("id, status")
    .single();

  if (error || !data) {
    console.error("[suppliers DELETE]", error?.message);
    return NextResponse.json(
      { error: "Archive failed", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, status: "archived" });
}
