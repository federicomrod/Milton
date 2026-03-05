// POST /api/kpis/calculate
// Executes KPI formulas and returns calculated values for the current user's selected KPIs
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateNoShowRate,
  calculateActiveMembers,
  calculateRevenuePerMember,
  calculateUtilizationRate,
  calculateAverageClassSize,
  calculateClassAttendanceRate,
  calculateNewMonthlyMembers,
  calculateChurnedMonthlyMembers,
  calculateMonthlyChurnRate,
  calculateAverageMemberTenure,
  calculateCancellationRate,
  calculateTotalClassesHeld,
  calculateAverageClassOccupancy,
  calculateRevenuePerClass,
  calculateBurnRate,
  calculateNetIncome,
  calculateNetCashFlow,
  calculateRunway,
  calculateRevenueGrowthRate,
} from "@/lib/kpi-calculations";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Get company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    // Get selected KPI IDs from business_models
    const { data: businessModel, error: modelError } = await supabase
      .from("business_models")
      .select("selected_kpi_ids")
      .eq("company_id", company.id)
      .single();

    // Handle new format: Array<{id: string, displayTypes: string[]}>
    const rawSelected = (businessModel?.selected_kpi_ids as any[]) || [];
    let selectedKpiIds: string[] = [];

    if (
      rawSelected.length > 0 &&
      typeof rawSelected[0] === "object" &&
      rawSelected[0]?.id
    ) {
      const selections = rawSelected as Array<{
        id: string;
        displayTypes: string[];
      }>;
      selectedKpiIds = selections.map((item) => item.id);
    }

    console.log(`[KPI Calculate] Selected KPI IDs:`, selectedKpiIds);

    // Get KPI definitions for selected KPIs (only published ones)
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", selectedKpiIds)
      .eq("is_published", true);

    console.log(`[KPI Calculate] Found ${kpis?.length || 0} KPI definitions`);

    if (kpisError) {
      return NextResponse.json({ calculatedKpis: [] });
    }

    // Get date range from request body
    const body = await request.json().catch(() => ({}));
    const fromDate =
      body.from_date ||
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    const toDate = body.to_date || new Date().toISOString().split("T")[0];

    // Calculate each selected KPI
    console.log(
      `[KPI Calculate] Processing ${kpis?.length || 0} KPIs:`,
      kpis?.map((k) => `${k.id}: ${k.name}`)
    );
    const calculatedKpis = await Promise.all(
      (kpis || []).map(async (kpi) => {
        try {
          console.log(
            `[KPI Calculate] Processing KPI: ${kpi.id} - ${kpi.name}`
          );
          let result = null;

          // Match KPIs by name instead of hardcoded IDs
          const kpiName = kpi.name?.toLowerCase().trim();
          console.log(
            `[KPI Calculate] Matching KPI "${kpi.name}" (ID: ${kpi.id}) with name: "${kpiName}"`
          );

          if (kpiName?.includes("no show") || kpiName?.includes("no-show")) {
            console.log(
              `[KPI Calculate] Matched No Show Rate for: ${kpi.name}`
            );
            result = await calculateNoShowRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("active members") ||
            kpiName?.includes("active member")
          ) {
            result = await calculateActiveMembers(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("revenue per member") ||
            kpiName?.includes("arpm")
          ) {
            result = await calculateRevenuePerMember(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("utilization") ||
            kpiName?.includes("capacity")
          ) {
            result = await calculateUtilizationRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("average class size") ||
            kpiName?.includes("average attendees")
          ) {
            result = await calculateAverageClassSize(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("class attendance") ||
            kpiName?.includes("attendance rate")
          ) {
            result = await calculateClassAttendanceRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("new members") ||
            kpiName?.includes("new monthly")
          ) {
            result = await calculateNewMonthlyMembers(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("churned members") ||
            kpiName?.includes("churned monthly")
          ) {
            result = await calculateChurnedMonthlyMembers(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("churn rate") ||
            kpiName?.includes("monthly churn")
          ) {
            result = await calculateMonthlyChurnRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("member tenure") ||
            kpiName?.includes("average tenure")
          ) {
            result = await calculateAverageMemberTenure(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("cancellation") ||
            kpiName?.includes("cancel")
          ) {
            result = await calculateCancellationRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("total classes") ||
            kpiName?.includes("classes held")
          ) {
            result = await calculateTotalClassesHeld(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("class occupancy") ||
            kpiName?.includes("occupancy")
          ) {
            result = await calculateAverageClassOccupancy(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (kpiName?.includes("revenue per class")) {
            result = await calculateRevenuePerClass(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("burn rate") ||
            kpiName?.includes("burn")
          ) {
            console.log(`[KPI Calculate] Matched Burn Rate for: ${kpi.name}`);
            result = await calculateBurnRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("net income") ||
            kpiName?.includes("profit")
          ) {
            console.log(`[KPI Calculate] Matched Net Income for: ${kpi.name}`);
            result = await calculateNetIncome(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (
            kpiName?.includes("net cash flow") ||
            kpiName?.includes("cash flow")
          ) {
            console.log(
              `[KPI Calculate] Matched Net Cash Flow for: ${kpi.name}`
            );
            result = await calculateNetCashFlow(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else if (kpiName?.includes("runway")) {
            console.log(`[KPI Calculate] Matched Runway for: ${kpi.name}`);
            result = await calculateRunway(supabase, user.id, fromDate, toDate);
          } else if (
            kpiName?.includes("revenue growth rate") ||
            kpiName?.includes("revenue growth")
          ) {
            result = await calculateRevenueGrowthRate(
              supabase,
              user.id,
              fromDate,
              toDate
            );
          } else {
            console.log(
              `[KPI Calculate] No calculation function found for KPI: ${kpi.name} (${kpi.id})`
            );
            result = { currentValue: 0, historicalData: [] };
          }

          return {
            ...kpi,
            currentValue: result.currentValue,
            historicalData: result.historicalData || [],
          };
        } catch (calcError) {
          return {
            ...kpi,
            currentValue: null,
            historicalData: [],
            error:
              calcError instanceof Error
                ? calcError.message
                : "Calculation error",
          };
        }
      })
    );

    return NextResponse.json({ calculatedKpis });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", calculatedKpis: [] },
      { status: 500 }
    );
  }
}
