import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Number of Orders = count of orders in the date range.
 * Uses Orders table; filters by date.
 */
export async function calculateOrderCount(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  currentValue: number;
  historicalData: { period: string; value: number }[];
}> {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    return { currentValue: 0, historicalData: [] };
  }

  let allModelData: { model_table_id: string; data: unknown }[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await supabase
      .from("model_data")
      .select("model_table_id, data")
      .eq("company_id", company.id)
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

  if (tableIds.length > 0) {
    const { data: tables } = await supabase
      .from("data_tables")
      .select("id, name")
      .in("id", tableIds);
    tables?.forEach((t: { id: string; name: string }) => {
      idToNameMap[t.id] = t.name.toLowerCase();
    });
  }

  const ordersData = allModelData.filter((row) => {
    const n = idToNameMap[row.model_table_id] || "";
    return (
      n === "orders" ||
      (n.includes("order") && !n.includes("item")) ||
      n.includes("sale")
    );
  });

  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }

  const parseDate = (dateStr: any): Date | null => {
    if (dateStr == null || dateStr === "") return null;
    if (typeof dateStr === "number") {
      const ms = dateStr > 1e12 ? dateStr : dateStr * 1000;
      const p = new Date(ms);
      return Number.isNaN(p.getTime()) ? null : p;
    }
    if (typeof dateStr === "string") {
      const s = dateStr.trim();
      if (s.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/))
        return new Date(s.replace(" ", "T") + ":00");
      if (s.match(/^\d{4}-\d{2}-\d{2}/))
        return new Date(s.substring(0, 10) + "T00:00:00");
      const p = new Date(s);
      if (!Number.isNaN(p.getTime())) return p;
    }
    const p = new Date(dateStr);
    return Number.isNaN(p.getTime()) ? null : p;
  };

  const dateFallbacks = [
    "Date & Time",
    "Date &amp; Time",
    "date",
    "Date",
    "order_date",
    "Order Date",
    "sale_date",
    "created_at",
  ];

  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  const ordersInRange: Date[] = [];
  for (const o of orders) {
    let dateStr =
      o["Date & Time"] ?? o.date ?? o.order_date ?? o.sale_date ?? o.created_at;
    if (dateStr == null) {
      for (const k of Object.keys(o)) {
        if (/date|time/i.test(k) && o[k]) {
          dateStr = o[k];
          break;
        }
      }
    }
    const orderDate = parseDate(dateStr);
    if (!orderDate || Number.isNaN(orderDate.getTime())) continue;
    if (orderDate < fromObj || orderDate > toObj) continue;
    ordersInRange.push(orderDate);
  }

  const monthlyCounts: Record<string, number> = {};
  for (const d of ordersInRange) {
    const period = d.toISOString().substring(0, 7);
    monthlyCounts[period] = (monthlyCounts[period] || 0) + 1;
  }

  const historicalData = Object.entries(monthlyCounts)
    .map(([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: ordersInRange.length,
    historicalData,
  };
}
