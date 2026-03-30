import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getReportData } from "@/lib/report-data-service";

export const dynamic = "force-dynamic";

/** GET /api/report-data – baseline KPIs (revenue, expenses, netIncome, cashRunway, etc.) for Scenario Planner and reports */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start") ?? undefined;
    const end = searchParams.get("end") ?? undefined;
    const reportPeriod = start && end ? { start, end } : undefined;

    const reportData = await getReportData(supabase, user.id, reportPeriod);

    return NextResponse.json({
      kpis: reportData.kpis,
      period: reportPeriod ?? null,
    });
  } catch (err) {
    console.error("[api/report-data]", err);
    return NextResponse.json(
      { error: "Failed to load report data" },
      { status: 500 }
    );
  }
}
