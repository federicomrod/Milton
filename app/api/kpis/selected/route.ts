// GET /api/kpis/selected
// Returns selected KPIs for the current user's company.
// Source of truth: business_models.selected_kpi_ids. Resolves IDs to full KPI rows from the kpis table.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonNoStore(data: { selectedKpis: unknown[] }) {
  const res = NextResponse.json(data);
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { error: "company_not_found", selectedKpis: [] },
        { status: 404 }
      );
    }

    const { data: businessModel, error: modelError } = await supabase
      .from("business_models")
      .select("selected_kpi_ids")
      .eq("company_id", company.id)
      .single();

    if (modelError) {
      console.error(
        "[api/kpis/selected] Error fetching business model:",
        modelError.message ?? modelError
      );
      return jsonNoStore({ selectedKpis: [] });
    }

    const rawIds = (businessModel?.selected_kpi_ids ?? []) as string[];
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return jsonNoStore({ selectedKpis: [] });
    }

    // Only pass valid UUIDs to the query; ignore legacy slugs (e.g. "mrr", "arr")
    // that may have been written by MetricSelector before it was fixed.
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const kpiIds = rawIds.filter(
      (id) => typeof id === "string" && uuidLike.test(id)
    );
    if (kpiIds.length === 0) {
      return jsonNoStore({ selectedKpis: [] });
    }

    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", kpiIds)
      .eq("is_published", true);

    if (kpisError) {
      console.error(
        "[api/kpis/selected] Error fetching KPIs:",
        kpisError.message ?? kpisError.code ?? kpisError
      );
      return jsonNoStore({ selectedKpis: [] });
    }

    return jsonNoStore({ selectedKpis: kpis ?? [] });
  } catch (err) {
    console.error("[api/kpis/selected] Unexpected error:", err);
    return jsonNoStore({ selectedKpis: [] });
  }
}
