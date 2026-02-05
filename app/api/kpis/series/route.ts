// GET /api/kpis/series?kpiIds=uuid1,uuid2
// Returns time-series data for KPIs that can be computed from model_data
// (e.g. Active Members from members table).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  computeActiveMembersSeries,
  isActiveMembersKpi,
  type MemberRecord,
  type KpiSeriesPoint,
} from "@/lib/kpi-series";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest) {
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
      return jsonNoStore({ series: {} });
    }

    const kpiIdsParam = req.nextUrl.searchParams.get("kpiIds") ?? "";
    const kpiIds = kpiIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (kpiIds.length === 0) {
      return jsonNoStore({ series: {} });
    }

    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("id, name, formula")
      .in("id", kpiIds);

    if (kpisError || !kpis?.length) {
      return jsonNoStore({ series: {} });
    }

    const series: Record<string, { data: KpiSeriesPoint[] }> = {};

    // Handle Active Members KPIs (existing logic)
    const activeMembersKpis = kpis.filter((k) =>
      isActiveMembersKpi(k.name, k.formula ?? null)
    );
    if (activeMembersKpis.length > 0) {
      let members: MemberRecord[] = [];
      const tablesToTry = ["members", "customers"];

      for (const tableName of tablesToTry) {
        // Get table ID for this table name
        const { data: tableDef } = await supabase
          .from("data_tables")
          .select("id")
          .eq("name", tableName)
          .single();

        if (!tableDef) continue;

        const { data: rows, error } = await supabase
          .from("model_data")
          .select("data")
          .eq("company_id", company.id)
          .eq("model_table_id", tableDef.id);

        if (!error && rows?.length) {
          for (const row of rows) {
            const d = row.data as unknown;
            if (d && typeof d === "object" && !Array.isArray(d)) {
              members.push(d as MemberRecord);
            } else if (Array.isArray(d)) {
              members.push(...(d as MemberRecord[]));
            }
          }
          break;
        }
      }

      const activeSeries = computeActiveMembersSeries(members);
      for (const k of activeMembersKpis) {
        series[k.id] = { data: activeSeries };
      }
    }

    // Handle all other KPIs (not Active Members) by calling the calculation API
    // Get selected KPIs from business_models to know which ones the user actually wants
    const { data: businessModel, error: modelError } = await supabase
      .from("business_models")
      .select("selected_kpi_ids")
      .eq("company_id", company.id)
      .single();

    const selectedKpiIds = (businessModel?.selected_kpi_ids as string[]) || [];

    // Calculate any selected KPI that isn't already handled by the Active Members logic above
    const alreadyHandledKpiIds = activeMembersKpis.map((k) => k.id);
    const kpisNeedingCalculation = kpis.filter(
      (k) =>
        selectedKpiIds.includes(k.id) && !alreadyHandledKpiIds.includes(k.id)
    );
    if (kpisNeedingCalculation.length > 0) {
      try {
        // Call the KPI calculation API
        const calculateRes = await fetch(
          `${req.nextUrl.origin}/api/kpis/calculate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Forward the user's session
              Cookie: req.headers.get("cookie") || "",
            },
            body: JSON.stringify({
              from_date: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
                .toISOString()
                .split("T")[0], // 2 years ago
              to_date: new Date().toISOString().split("T")[0], // today
            }),
          }
        );

        if (calculateRes.ok) {
          const calculateData = await calculateRes.json();
          const calculatedKpis = calculateData.calculatedKpis || [];

          // Map the calculated data to the series format
          for (const calculatedKpi of calculatedKpis) {
            if (
              calculatedKpi.historicalData &&
              Array.isArray(calculatedKpi.historicalData)
            ) {
              series[calculatedKpi.id] = {
                data: calculatedKpi.historicalData.map((point: any) => ({
                  period: point.period,
                  value: point.value,
                })),
              };
            }
          }
        }
      } catch (error) {
        // Handle error silently
      }
    }

    return jsonNoStore({ series });
  } catch (err) {
    return jsonNoStore({ series: {} });
  }
}
