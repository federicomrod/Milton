// app/api/restaurant/prepared-components/route.ts
//
// GET  /api/restaurant/prepared-components  → { components: [...] }
// POST /api/restaurant/prepared-components  → create one component
//
// Component recipes (the inputs needed to MAKE a component) are managed
// separately by /api/restaurant/recipes — this endpoint only manages
// the component header row.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "active", "archived"]);

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("prepared_components")
    .select(
      "id, name, category, output_unit, status, notes, created_at, updated_at"
    )
    .eq("company_id", auth.companyId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[components GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ components: data ?? [] });
}

interface CreateBody {
  name?: unknown;
  category?: unknown;
  output_unit?: unknown;
  status?: unknown;
  notes?: unknown;
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
  const outputUnit =
    typeof body.output_unit === "string" && body.output_unit.trim() !== ""
      ? body.output_unit.trim()
      : "kg";
  const category =
    typeof body.category === "string" && body.category.trim() !== ""
      ? body.category.trim()
      : null;
  const status =
    typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)
      ? (body.status as "draft" | "active" | "archived")
      : "draft";
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null;

  // Pre-flight duplicate check. We still rely on the DB unique constraint
  // as the source of truth (and treat 23505 below), but a polite "already
  // exists" beats a generic 500 when the user types a name that's only
  // off by trailing whitespace or a case difference.
  const { data: existing } = await auth.supabase
    .from("prepared_components")
    .select("id, name, status")
    .eq("company_id", auth.companyId)
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      {
        error: "Component already exists",
        details: `A component named “${existing[0].name}” already exists (status: ${existing[0].status}). Archive or rename it first.`,
        existing_id: existing[0].id,
        existing_status: existing[0].status,
      },
      { status: 409 }
    );
  }

  const { data, error } = await auth.supabase
    .from("prepared_components")
    .insert({
      company_id: auth.companyId,
      name,
      category,
      output_unit: outputUnit,
      status,
      notes,
    })
    .select("id, name, category, output_unit, status, notes")
    .single();

  if (error || !data) {
    // 23505 = unique_violation. The DB-level constraint won the race; we
    // still return a clean 409 so the UI doesn't show a scary 500.
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return NextResponse.json(
        {
          error: "Component already exists",
          details: error?.message ?? "Unique constraint violated",
        },
        { status: 409 }
      );
    }
    console.error("[components POST]", error?.message);
    return NextResponse.json(
      { error: "Create failed", details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ component: data });
}
