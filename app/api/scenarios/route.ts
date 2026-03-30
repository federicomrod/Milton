import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlanningScenarioRow } from "@/lib/types/scenario";
import { mapRowToScenario } from "@/lib/types/scenario";

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

/** GET /api/scenarios – list scenarios for the company */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { companyId, error: authError } = await getCompanyId(supabase);
    if (authError) {
      return NextResponse.json(
        { error: authError, scenarios: [] },
        { status: authError === "unauthorized" ? 401 : 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const tag = searchParams.get("tag");
    const search = searchParams.get("search")?.trim();

    let query = supabase
      .from("planning_scenarios")
      .select("id, name, status, tags, created_at, updated_at")
      .eq("company_id", companyId!)
      .order("updated_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (tag) query = query.contains("tags", [tag]);
    if (search) query = query.ilike("name", `%${search.replace(/%/g, "\\%")}%`);

    const { data: rows, error } = await query;

    if (error) {
      console.error("[api/scenarios] GET error:", error.message);
      return NextResponse.json(
        { error: error.message, scenarios: [] },
        { status: 500 }
      );
    }

    const scenarios = (rows ?? []).map((r) =>
      mapRowToScenario(r as PlanningScenarioRow)
    );
    return NextResponse.json({ scenarios });
  } catch (err) {
    console.error("[api/scenarios] GET unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", scenarios: [] },
      { status: 500 }
    );
  }
}

/** POST /api/scenarios – create a scenario */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { companyId, error: authError } = await getCompanyId(supabase);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "unauthorized" ? 401 : 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : "New Scenario";
    const status =
      body.status === "Draft" ||
      body.status === "Projected" ||
      body.status === "Ready"
        ? body.status
        : "Draft";
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t: unknown) => typeof t === "string")
      : ["active"];
    const driver_overrides = Array.isArray(body.driver_overrides)
      ? body.driver_overrides
      : [];

    const { data: row, error } = await supabase
      .from("planning_scenarios")
      .insert({
        company_id: companyId!,
        name,
        status,
        tags,
        driver_overrides,
      })
      .select()
      .single();

    if (error) {
      console.error("[api/scenarios] POST error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      scenario: row as PlanningScenarioRow,
    });
  } catch (err) {
    console.error("[api/scenarios] POST unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
