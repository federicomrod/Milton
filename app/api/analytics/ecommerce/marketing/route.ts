// GET /api/analytics/ecommerce/marketing?from_date=...&to_date=...
// Returns spend by channel and summary metrics.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEcomModelData } from "@/lib/kpi-calculations/ecomDataLoader";
import {
  ecomOrderAcc,
  ecomMarketingAcc,
  toPeriod,
} from "@/lib/kpi-calculations/ecomFieldAccessors";

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
      return jsonNoStore({
        spendByChannel: [],
        totalSpend: 0,
        totalRevenue: 0,
        marketingEfficiency: 0,
      });
    }

    const fromDateParam = req.nextUrl.searchParams.get("from_date");
    const toDateParam = req.nextUrl.searchParams.get("to_date");

    let fromDate: Date;
    let toDate: Date;

    if (fromDateParam && toDateParam) {
      fromDate = new Date(fromDateParam + "T00:00:00");
      toDate = new Date(toDateParam + "T23:59:59");
    } else {
      toDate = new Date();
      fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - 1);
    }

    const fromObj = new Date(fromDate);
    fromObj.setHours(0, 0, 0, 0);
    const toObj = new Date(toDate);
    toObj.setHours(23, 59, 59, 999);

    const data = await getEcomModelData(supabase, company.id);

    let totalRevenue = 0;
    for (const o of data.orders) {
      const date = ecomOrderAcc.orderDate(o);
      if (!date || date < fromObj || date > toObj) continue;
      totalRevenue += ecomOrderAcc.totalRevenue(o);
    }

    const spendByChannel = new Map<string, number>();
    let totalSpend = 0;

    for (const m of data.marketingSpend) {
      const date = ecomMarketingAcc.date(m);
      if (!date || date < fromObj || date > toObj) continue;
      const spend = ecomMarketingAcc.spend(m);
      const channel = ecomMarketingAcc.channel(m);
      totalSpend += spend;
      spendByChannel.set(channel, (spendByChannel.get(channel) ?? 0) + spend);
    }

    const channelBreakdown = Array.from(spendByChannel.entries())
      .map(([channel, spend]) => ({
        channel,
        spend: parseFloat(spend.toFixed(2)),
        percentage:
          totalSpend > 0
            ? parseFloat(((spend / totalSpend) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    const marketingEfficiency =
      totalSpend > 0 ? parseFloat((totalRevenue / totalSpend).toFixed(2)) : 0;

    return jsonNoStore({
      spendByChannel: channelBreakdown,
      totalSpend: parseFloat(totalSpend.toFixed(2)),
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      marketingEfficiency,
    });
  } catch (err) {
    console.error("[ecommerce/marketing] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch marketing data",
        spendByChannel: [],
        totalSpend: 0,
        totalRevenue: 0,
        marketingEfficiency: 0,
      },
      { status: 500 }
    );
  }
}
