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

    const activeMembersKpis = kpis.filter((k) =>
      isActiveMembersKpi(k.name, k.formula ?? null)
    );
    if (activeMembersKpis.length > 0) {
      let members: MemberRecord[] = [];
      const tablesToTry = ["members", "customers"];
      for (const table of tablesToTry) {
        const { data: rows, error } = await supabase
          .from("model_data")
          .select("data")
          .eq("company_id", company.id)
          .ilike("model_table_name", table);
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

    return jsonNoStore({ series });
  } catch (err) {
    console.error("[api/kpis/series] Unexpected error:", err);
    return jsonNoStore({ series: {} });
  }
}
