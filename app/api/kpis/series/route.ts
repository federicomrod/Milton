// GET /api/kpis/series?kpiIds=uuid1,uuid2&from_date=2024-01-01&to_date=2024-12-31
// Returns time-series data for KPIs. All series come from the unified layer via /api/kpis/calculate (historicalData).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { KpiSeriesPoint } from "@/lib/kpi-series";

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

    const params = req.nextUrl.searchParams;
    const kpiIdsParam = params.get("kpiIds") ?? "";
    const kpiIds = kpiIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (kpiIds.length === 0) {
      return jsonNoStore({ series: {} });
    }

    // Date range — default to 12 months if not provided
    const toDate =
      params.get("to_date") ?? new Date().toISOString().split("T")[0];
    const fromDate =
      params.get("from_date") ??
      new Date(new Date().setFullYear(new Date().getFullYear() - 1))
        .toISOString()
        .split("T")[0];

    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("id, name, formula")
      .in("id", kpiIds)
      .eq("is_published", true);

    if (kpisError || !kpis?.length) {
      return jsonNoStore({ series: {} });
    }

    const series: Record<string, { data: KpiSeriesPoint[] }> = {};

    // All KPIs — use unified layer via calculate API (same formula as dashboard cards and analytics)
    try {
      const calculateRes = await fetch(
        `${req.nextUrl.origin}/api/kpis/calculate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: req.headers.get("cookie") || "",
          },
          body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
        }
      );

      if (calculateRes.ok) {
        const calculateData = await calculateRes.json();
        const calculatedKpis: any[] = calculateData.calculatedKpis || [];

        for (const calculatedKpi of calculatedKpis) {
          if (
            Array.isArray(calculatedKpi.historicalData) &&
            calculatedKpi.historicalData.length > 0
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
    } catch {
      // silently skip
    }

    return jsonNoStore({ series });
  } catch (err) {
    return jsonNoStore({ series: {} });
  }
}
