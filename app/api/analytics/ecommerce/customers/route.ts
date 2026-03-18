// GET /api/analytics/ecommerce/customers?from_date=...&to_date=...
// Returns new customers, acquisition channels, repeat metrics.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEcomModelData } from "@/lib/kpi-calculations/ecomDataLoader";
import {
  ecomOrderAcc,
  ecomCustomerAcc,
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
        newCustomersByPeriod: [],
        acquisitionChannelBreakdown: [],
        totalNewCustomers: 0,
        repeatCustomerCount: 0,
        totalCustomersWithOrders: 0,
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

    const newCustomersByPeriodMap = new Map<string, number>();
    const acquisitionChannelMap = new Map<string, number>();
    let totalNewCustomers = 0;

    for (const c of data.customers) {
      const firstDate = ecomCustomerAcc.firstOrderDate(c);
      if (!firstDate || firstDate < fromObj || firstDate > toObj) continue;
      totalNewCustomers++;
      const period = toPeriod(firstDate);
      newCustomersByPeriodMap.set(
        period,
        (newCustomersByPeriodMap.get(period) ?? 0) + 1
      );
      const channel = ecomCustomerAcc.acquisitionChannel(c);
      acquisitionChannelMap.set(
        channel,
        (acquisitionChannelMap.get(channel) ?? 0) + 1
      );
    }

    const newCustomersByPeriod = Array.from(newCustomersByPeriodMap.entries())
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const acquisitionChannelBreakdown = Array.from(
      acquisitionChannelMap.entries()
    )
      .map(([channel, count]) => ({
        channel,
        count,
        percentage:
          totalNewCustomers > 0
            ? parseFloat(((count / totalNewCustomers) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const customerOrderCounts = new Map<string, number>();
    for (const o of data.orders) {
      const date = ecomOrderAcc.orderDate(o);
      if (!date || date < fromObj || date > toObj) continue;
      const cid = ecomOrderAcc.customerId(o);
      if (!cid) continue;
      customerOrderCounts.set(cid, (customerOrderCounts.get(cid) ?? 0) + 1);
    }

    const totalCustomersWithOrders = customerOrderCounts.size;
    const repeatCustomerCount = Array.from(customerOrderCounts.values()).filter(
      (n) => n > 1
    ).length;

    return jsonNoStore({
      newCustomersByPeriod,
      acquisitionChannelBreakdown,
      totalNewCustomers,
      repeatCustomerCount,
      totalCustomersWithOrders,
    });
  } catch (err) {
    console.error("[ecommerce/customers] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch customer data",
        newCustomersByPeriod: [],
        acquisitionChannelBreakdown: [],
        totalNewCustomers: 0,
        repeatCustomerCount: 0,
        totalCustomersWithOrders: 0,
      },
      { status: 500 }
    );
  }
}
