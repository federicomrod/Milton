// GET /api/analytics/b2b-saas/pipeline?from_date=...&to_date=...
// Returns CRM pipeline data (deals + metrics) for B2B SaaS, same pattern as fitness-studio/restaurant analytics.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getReportData } from "@/lib/report-data-service";
import { calculatePipelineMetrics } from "@/lib/pipeline-data-generators";
import type { Deal } from "@/lib/types/pipeline";

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

    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 1))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];

    const reportPeriod = { start: fromDate, end: toDate };
    const reportData = await getReportData(supabase, user.id, reportPeriod);

    const deals: Deal[] = (reportData.crmDeals || []) as Deal[];
    const metrics = calculatePipelineMetrics(deals);
    const totalRevenue = reportData.kpis?.revenue ?? 0;

    return jsonNoStore({ deals, metrics, totalRevenue });
  } catch (err: unknown) {
    console.error("[b2b-saas/pipeline] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
