// GET /api/analytics/restaurant/kpis?from_date=...&to_date=...
// Returns KPI values for restaurant (unified data layer – same pattern as fitness-studio/kpis).
// Used by the dashboard KPI grid and fetchDashboardKpis().
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { calculateTotalRevenue } from "@/lib/kpi-calculations/calculateTotalRevenue";
import { calculateCovers } from "@/lib/kpi-calculations/calculateCovers";
import { calculateAverageTicketSize } from "@/lib/kpi-calculations/calculateAverageTicketSize";
import { calculatePrimeCostPercent } from "@/lib/kpi-calculations/calculatePrimeCostPercent";
import { calculateNetCashFlow } from "@/lib/kpi-calculations/calculateNetCashFlow";
import { calculateMenuItemMargin } from "@/lib/kpi-calculations/calculateMenuItemMargin";
import { calculateOrderCount } from "@/lib/kpi-calculations/calculateOrderCount";
import {
  aovFromCapturedOrders,
  CAPTURED_ORDER_STATUSES,
} from "@/lib/kpi-calculations/aovFromCapturedOrders";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Return debug info for AOV: why it might be 0 */
async function getAovDebug(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<{
  ordersTableName: string | null;
  ordersCount: number;
  ordersInRange: number;
  capturedCount: number;
  capturedSum: number;
  aov: number;
  sampleOrderKeys: string[];
}> {
  let allModelData: { model_table_id: string; data: unknown }[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const result = await supabase
      .from("model_data")
      .select("model_table_id, data")
      .eq("company_id", companyId)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });
    if (result.error) break;
    if (result.data?.length) {
      allModelData = [...allModelData, ...result.data];
      from += pageSize;
      hasMore = result.data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  const tableIds = [...new Set(allModelData.map((r) => r.model_table_id))];
  const idToNameMap: Record<string, string> = {};
  const tableFieldsMap: Record<string, { fields: Array<{ name: string }> }> =
    {};
  if (tableIds.length > 0) {
    const { data: tables } = await supabase
      .from("data_tables")
      .select("id, name, fields")
      .in("id", tableIds);
    tables?.forEach((t: any) => {
      idToNameMap[t.id] = t.name.toLowerCase();
      tableFieldsMap[t.id] = { fields: t.fields || [] };
    });
  }

  const ordersData = allModelData.filter((row) => {
    const name = idToNameMap[row.model_table_id] || "";
    return name === "orders" || name.includes("order") || name.includes("sale");
  });
  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }

  const ordersTableId = Object.keys(idToNameMap).find(
    (id) =>
      idToNameMap[id] === "orders" ||
      idToNameMap[id]?.includes("order") ||
      idToNameMap[id]?.includes("sale")
  );
  const ordersTableName = ordersTableId
    ? (idToNameMap[ordersTableId] ?? null)
    : null;
  const fields = ordersTableId
    ? tableFieldsMap[ordersTableId]?.fields || []
    : [];

  const getVal = (
    obj: any,
    fieldName: string,
    fallbacks: string[] = []
  ): any => {
    if (obj[fieldName] !== undefined) return obj[fieldName];
    const lower = fieldName.toLowerCase();
    for (const key in obj) {
      if (key.toLowerCase() === lower) return obj[key];
    }
    for (const fb of fallbacks) {
      if (obj[fb] !== undefined) return obj[fb];
    }
    return undefined;
  };

  const parseDate = (dateStr: any): Date | null => {
    if (!dateStr) return null;
    if (typeof dateStr === "string") {
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/))
        return new Date(dateStr.replace(" ", "T") + ":00");
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}/))
        return new Date(dateStr + "T00:00:00");
    }
    const p = new Date(dateStr);
    return isNaN(p.getTime()) ? null : p;
  };

  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  const statusField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("status") ||
      f.name.toLowerCase().includes("state") ||
      f.name.toLowerCase().includes("stage") ||
      f.name.toLowerCase().includes("payment")
  )?.name;
  const totalField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("total") ||
      f.name.toLowerCase().includes("amount") ||
      f.name.toLowerCase().includes("revenue")
  )?.name;
  const dateField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("date") ||
      f.name.toLowerCase().includes("time")
  )?.name;

  const getOrderStatus = (obj: any): string => {
    const fromField = statusField
      ? getVal(obj, statusField, [
          "status",
          "Status",
          "state",
          "State",
          "Payment Status",
          "Order Status",
          "payment_status",
          "order_status",
        ])
      : undefined;
    if (fromField !== undefined && fromField !== null && fromField !== "")
      return String(fromField).toLowerCase().trim();
    const direct =
      obj.status ??
      obj.Status ??
      obj.state ??
      obj.State ??
      obj["Payment Status"] ??
      obj["Order Status"] ??
      obj["Status"];
    if (direct !== undefined && direct !== null && direct !== "")
      return String(direct).toLowerCase().trim();
    for (const key in obj) {
      const k = key.toLowerCase();
      if (
        k.includes("status") ||
        k.includes("state") ||
        (k.includes("payment") && (k.includes("status") || k.includes("state")))
      ) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "")
          return String(v).toLowerCase().trim();
      }
    }
    return "";
  };

  const isCapturedStatus = (status: string): boolean => {
    if (!status) return true;
    return CAPTURED_ORDER_STATUSES.some(
      (s: string) => status === s || status.includes(s)
    );
  };

  let ordersInRange = 0;
  let capturedCount = 0;
  let capturedSum = 0;
  const sampleOrderKeys = orders.length > 0 ? Object.keys(orders[0]) : [];

  for (const o of orders) {
    const dateStr = dateField
      ? getVal(o, dateField, [
          "date",
          "Date",
          "order_date",
          "sale_date",
          "created_at",
        ])
      : (o.date ?? o.order_date ?? o.sale_date ?? o.created_at ?? o["Date"]);
    const date = parseDate(dateStr);
    if (!date || date < fromObj || date > toObj) continue;
    ordersInRange += 1;

    const status = getOrderStatus(o);
    if (!isCapturedStatus(status)) continue;

    const totalRaw = totalField
      ? getVal(o, totalField, [
          "total",
          "Total",
          "amount",
          "Amount",
          "Total Amount",
        ])
      : (o.total ?? o.Total ?? o.amount ?? o.Amount ?? o["Total Amount"] ?? 0);
    const total =
      typeof totalRaw === "string"
        ? parseFloat(totalRaw || "0")
        : Number(totalRaw) || 0;

    capturedSum += total;
    capturedCount += 1;
  }

  const aov = capturedCount > 0 ? capturedSum / capturedCount : 0;

  return {
    ordersTableName,
    ordersCount: orders.length,
    ordersInRange,
    capturedCount,
    capturedSum,
    aov,
    sampleOrderKeys,
  };
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
      return jsonNoStore({ kpis: {} });
    }

    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];
    const debug = req.nextUrl.searchParams.get("debug") === "1";

    const [revenueResult, coversResult, ticketResult, primeCostResult] =
      await Promise.all([
        calculateTotalRevenue(supabase, user.id, fromDate, toDate),
        calculateCovers(supabase, user.id, fromDate, toDate),
        calculateAverageTicketSize(supabase, user.id, fromDate, toDate),
        calculatePrimeCostPercent(supabase, user.id, fromDate, toDate),
      ]);

    let averageTicketSize = ticketResult.currentValue ?? 0;
    const primeCostPercent = primeCostResult.currentValue ?? 0;

    // Fallback: when orders-based AOV is 0, use Captured orders
    // AOV = Sum of all Captured order totals / Number of Captured orders
    if (averageTicketSize === 0) {
      const aovCaptured = await aovFromCapturedOrders(
        supabase,
        company.id,
        fromDate,
        toDate
      );
      if (aovCaptured > 0) averageTicketSize = aovCaptured;
    }

    let netCashFlow = 0;
    let menuItemMargin = 0;
    try {
      const netCashFlowResult = await calculateNetCashFlow(
        supabase,
        user.id,
        fromDate,
        toDate
      );
      netCashFlow = netCashFlowResult.currentValue ?? 0;
    } catch {
      // no transactions or company; keep 0
    }
    let grossMargin = 0;
    let orderCount = 0;
    try {
      const orderCountResult = await calculateOrderCount(
        supabase,
        user.id,
        fromDate,
        toDate
      );
      orderCount = orderCountResult.currentValue ?? 0;
    } catch {
      // no orders; keep 0
    }
    try {
      const marginResult = await calculateMenuItemMargin(
        supabase,
        user.id,
        fromDate,
        toDate
      );
      menuItemMargin = marginResult.currentValue ?? 0;
      grossMargin = menuItemMargin; // same formula: (Total_Sales - Cost) / Total_Sales × 100
    } catch {
      // no order items / menu items with COGS; keep 0
    }

    const payload: Record<string, unknown> = {
      kpis: {
        totalRevenue: parseFloat((revenueResult.currentValue ?? 0).toFixed(2)),
        covers: Math.round(coversResult.currentValue ?? 0),
        averageTicketSize: parseFloat(averageTicketSize.toFixed(2)),
        averageOrderValue: parseFloat(averageTicketSize.toFixed(2)),
        primeCostPercent: parseFloat(primeCostPercent.toFixed(2)),
        netCashFlow: parseFloat(netCashFlow.toFixed(2)),
        menuItemMargin: parseFloat(menuItemMargin.toFixed(2)),
        grossMargin: parseFloat(grossMargin.toFixed(2)),
        orderCount: Math.round(orderCount),
      },
    };

    if (debug) {
      payload.debug = await getAovDebug(supabase, company.id, fromDate, toDate);
    }

    return jsonNoStore(payload);
  } catch (err) {
    console.error("[api/analytics/restaurant/kpis] Unexpected error:", err);
    return jsonNoStore({ kpis: {} });
  }
}
