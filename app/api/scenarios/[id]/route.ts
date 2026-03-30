import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlanningScenarioRow } from "@/lib/types/scenario";

export const dynamic = "force-dynamic";

async function getCompanyId(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return { error: "unauthorized" as const, companyId: null };
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();
  if (companyError || !company)
    return { error: "company_not_found" as const, companyId: null };
  return { companyId: company.id, error: null };
}

/** GET /api/scenarios/[id] – fetch one scenario */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { companyId, error: authError } = await getCompanyId(supabase);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "unauthorized" ? 401 : 404 }
      );
    }

    const { data: row, error } = await supabase
      .from("planning_scenarios")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId!)
      .single();

    if (error || !row) {
      return NextResponse.json(
        { error: error?.message ?? "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      scenario: row as PlanningScenarioRow,
    });
  } catch (err) {
    console.error("[api/scenarios/[id]] GET unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** PATCH /api/scenarios/[id] – update scenario */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { companyId, error: authError } = await getCompanyId(supabase);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "unauthorized" ? 401 : 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim())
      updates.name = body.name.trim();
    if (
      body.status === "Draft" ||
      body.status === "Projected" ||
      body.status === "Ready"
    )
      updates.status = body.status;
    if (Array.isArray(body.tags))
      updates.tags = body.tags.filter((t: unknown) => typeof t === "string");
    if (body.driver_overrides !== undefined)
      updates.driver_overrides = Array.isArray(body.driver_overrides)
        ? body.driver_overrides
        : [];
    if (body.projected_results !== undefined)
      updates.projected_results =
        body.projected_results === null ||
        (typeof body.projected_results === "object" &&
          body.projected_results !== null)
          ? body.projected_results
          : null;

    if (Object.keys(updates).length === 0) {
      const { data: row } = await supabase
        .from("planning_scenarios")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId!)
        .single();
      return NextResponse.json({
        scenario: row as PlanningScenarioRow,
      });
    }

    const { data: row, error } = await supabase
      .from("planning_scenarios")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId!)
      .select()
      .single();

    if (error) {
      console.error("[api/scenarios/[id]] PATCH error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      scenario: row as PlanningScenarioRow,
    });
  } catch (err) {
    console.error("[api/scenarios/[id]] PATCH unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** DELETE /api/scenarios/[id] */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { companyId, error: authError } = await getCompanyId(supabase);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "unauthorized" ? 401 : 404 }
      );
    }

    const { error } = await supabase
      .from("planning_scenarios")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId!);

    if (error) {
      console.error("[api/scenarios/[id]] DELETE error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/scenarios/[id]] DELETE unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
