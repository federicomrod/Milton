// GET /api/kpis/series?kpiIds=uuid1,uuid2&from_date=2024-01-01&to_date=2024-12-31
// Returns time-series data for KPIs that can be computed from model_data.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  computeActiveMembersSeries,
  isActiveMembersKpi,
  type MemberRecord,
  type KpiSeriesPoint,
} from "@/lib/kpi-series";
import { getModelDataRows } from "@/lib/kpi-calculations/getModelDataRows";
import { calculateRevenueGrowthRate } from "@/lib/kpi-calculations/calculateRevenueGrowthRate";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Converts a date range into "YYYY-MM" period strings. */
function getPeriodsInRange(fromDate: string, toDate: string): string[] {
  // Parse year/month from the ISO string directly to avoid UTC→local day-shift bugs
  const [fromYear, fromMonth] = fromDate.split("-").map(Number);
  const [toYear, toMonth] = toDate.split("-").map(Number);

  const periods: string[] = [];
  for (
    let d = new Date(fromYear, fromMonth - 1, 1);
    d <= new Date(toYear, toMonth - 1, 1);
    d.setMonth(d.getMonth() + 1)
  ) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    periods.push(`${y}-${m}`);
  }
  return periods;
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

    // Active Members — computed directly from member records
    const activeMembersKpis = kpis.filter((k) =>
      isActiveMembersKpi(k.name, k.formula ?? null)
    );
    if (activeMembersKpis.length > 0) {
      const members = await getModelDataRows(
        supabase,
        company.id,
        "members",
        "customers"
      );
      const periods = getPeriodsInRange(fromDate, toDate);
      const activeSeries = computeActiveMembersSeries(
        members as MemberRecord[],
        {
          periods,
        }
      );
      for (const k of activeMembersKpis) {
        series[k.id] = { data: activeSeries };
      }
    }

    // Average Class Size — use classes-utilization API (same source as the card)
    const averageClassSizeKpis = kpis.filter((k) =>
      k.name?.toLowerCase().includes("average class size")
    );
    if (averageClassSizeKpis.length > 0) {
      try {
        const origin = req.nextUrl.origin;
        const classesRes = await fetch(
          `${origin}/api/analytics/fitness-studio/classes-utilization?from_date=${fromDate}&to_date=${toDate}`,
          {
            headers: { Cookie: req.headers.get("cookie") || "" },
          }
        );
        if (classesRes.ok) {
          const classesJson = await classesRes.json();
          const byPeriod = classesJson.averageClassSizeByPeriod;
          if (Array.isArray(byPeriod) && byPeriod.length > 0) {
            const data: KpiSeriesPoint[] = byPeriod.map(
              (p: { period: string; value: number }) => ({
                period: p.period,
                value: p.value,
              })
            );
            for (const k of averageClassSizeKpis) {
              series[k.id] = { data };
            }
          }
        }
      } catch {
        // silently skip
      }
    }

    // Revenue Growth Rate — compute directly (avoids server-to-server auth issues)
    const revenueGrowthRateKpis = kpis.filter(
      (k) =>
        k.name?.toLowerCase().includes("revenue growth rate") ||
        k.name?.toLowerCase().includes("revenue growth")
    );
    if (revenueGrowthRateKpis.length > 0 && user) {
      try {
        const result = await calculateRevenueGrowthRate(
          supabase,
          user.id,
          fromDate,
          toDate
        );
        if (
          Array.isArray(result.historicalData) &&
          result.historicalData.length > 0
        ) {
          const data: KpiSeriesPoint[] = result.historicalData.map((p) => ({
            period: p.period,
            value: p.value,
          }));
          for (const k of revenueGrowthRateKpis) {
            series[k.id] = { data };
          }
        }
      } catch {
        // silently skip
      }
    }

    // All other KPIs — delegate to the calculate API
    const alreadyHandledIds = new Set([
      ...activeMembersKpis.map((k) => k.id),
      ...averageClassSizeKpis.map((k) => k.id),
      ...revenueGrowthRateKpis.map((k) => k.id),
    ]);
    const kpisNeedingCalculation = kpis.filter(
      (k) => !alreadyHandledIds.has(k.id)
    );

    if (kpisNeedingCalculation.length > 0) {
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
            // Skip KPIs already handled by dedicated logic above (e.g. Active Members)
            if (alreadyHandledIds.has(calculatedKpi.id)) continue;

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
    }

    return jsonNoStore({ series });
  } catch (err) {
    return jsonNoStore({ series: {} });
  }
}
