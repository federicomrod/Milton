// GET /api/analytics/ecommerce/kpis?from_date=...&to_date=...
// Returns E-Commerce KPIs (CAC, CAC Payback, CMAM, Marketing Efficiency, Product Profitability, Growth Quality).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateContributionMarginAfterMarketing,
  calculateCustomerAcquisitionCost,
  calculateCacPaybackPeriod,
  calculateMarketingEfficiency,
  calculateProductProfitability,
  calculateGrowthQualityScore,
} from "@/lib/kpi-calculations";

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

    const [
      cmam,
      cac,
      cacPayback,
      marketingEfficiency,
      productProfitability,
      growthQuality,
    ] = await Promise.all([
      calculateContributionMarginAfterMarketing(
        supabase,
        user.id,
        fromDate,
        toDate
      ),
      calculateCustomerAcquisitionCost(supabase, user.id, fromDate, toDate),
      calculateCacPaybackPeriod(supabase, user.id, fromDate, toDate),
      calculateMarketingEfficiency(supabase, user.id, fromDate, toDate),
      calculateProductProfitability(supabase, user.id, fromDate, toDate),
      calculateGrowthQualityScore(supabase, user.id, fromDate, toDate),
    ]);

    const kpis = {
      cmam: cmam.currentValue,
      cac: cac.currentValue,
      cacPayback: cacPayback.currentValue,
      marketingEfficiency: marketingEfficiency.currentValue,
      productProfitability: productProfitability.currentValue,
      growthQualityScore: growthQuality.currentValue,
    };

    const historical = {
      cmam: cmam.historicalData ?? [],
      cac: cac.historicalData ?? [],
      cacPayback: cacPayback.historicalData ?? [],
      marketingEfficiency: marketingEfficiency.historicalData ?? [],
      productProfitability: productProfitability.historicalData ?? [],
      growthQualityScore: growthQuality.historicalData ?? [],
    };

    return jsonNoStore({ kpis, historical });
  } catch (err) {
    console.error("[ecommerce/kpis] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch E-Commerce KPIs",
        kpis: {},
        historical: {},
      },
      { status: 500 }
    );
  }
}
