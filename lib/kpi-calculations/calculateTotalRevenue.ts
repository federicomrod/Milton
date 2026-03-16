import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Total Revenue = Sum of order totals in the date range.
 * Formula: Σ (each order's Total Amount) for orders where date is in [fromDate, toDate].
 * Uses Orders table; fields: "Total Amount", "Date & Time" (or equivalents).
 */
export async function calculateTotalRevenue(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  // Get company ID
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) throw new Error("Company not found");

  // Fetch all model_data for the company
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
    if (result.data && result.data.length > 0) {
      allModelData = [...allModelData, ...result.data];
      from += pageSize;
      hasMore = result.data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  // Get table IDs and convert to names
  const tableIds = [...new Set(allModelData.map((row) => row.model_table_id))];
  const idToNameMap: Record<string, string> = {};

  if (tableIds.length > 0) {
    const { data: tableDefinitions } = await supabase
      .from("data_tables")
      .select("id, name")
      .in("id", tableIds);

    if (tableDefinitions) {
      tableDefinitions.forEach((table) => {
        idToNameMap[table.id] = table.name.toLowerCase();
      });
    }
  }

  // Filter orders data (exclude Order Items - name must not include "item")
  const ordersData = allModelData.filter((row) => {
    const tableName = idToNameMap[row.model_table_id] || "";
    return (
      tableName === "orders" ||
      (tableName.includes("order") && !tableName.includes("item")) ||
      tableName.includes("sale")
    );
  });
  const invoicesData = allModelData.filter((row) => {
    const tableName = idToNameMap[row.model_table_id] || "";
    return tableName.includes("invoice");
  });
  const subscriptionsData = allModelData.filter((row) => {
    const tableName = idToNameMap[row.model_table_id] || "";
    return tableName.includes("subscription");
  });

  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }
  for (const row of invoicesData) {
    const d = row.data as any;
    if (
      d &&
      typeof d === "object" &&
      (d["Type (AR = sales, AP = bill)"] === "AR" ||
        d.Type === "AR" ||
        d.type === "AR")
    ) {
      orders.push({
        date: d["Issue Date"] ?? d.issue_date ?? d.date,
        total: d["Total Amount"] ?? d.total_amount ?? d.total ?? d.amount ?? 0,
      });
    }
  }
  for (const row of subscriptionsData) {
    const d = row.data as any;
    if (d && typeof d === "object") {
      const mrr =
        d["Monthly Recurring Revenue"] ??
        d.monthly_recurring_revenue ??
        d.mrr ??
        0;
      const start = d["Start Date"] ?? d.start_date ?? d.date;
      if (mrr && start) {
        orders.push({
          date: start,
          total: typeof mrr === "number" ? mrr : parseFloat(String(mrr)) || 0,
        });
      }
    }
  }

  const getVal = (obj: any, fallbacks: string[]): any => {
    for (const fb of fallbacks) {
      if (obj[fb] !== undefined && obj[fb] != null) return obj[fb];
      const lower = fb.toLowerCase();
      for (const key in obj) {
        if (key.toLowerCase() === lower) return obj[key];
      }
    }
    return undefined;
  };

  const parseDate = (dateStr: any): Date | null => {
    if (dateStr == null || dateStr === "") return null;
    if (typeof dateStr === "number") {
      const ms = dateStr > 1e12 ? dateStr : dateStr * 1000;
      const p = new Date(ms);
      return isNaN(p.getTime()) ? null : p;
    }
    if (typeof dateStr === "string") {
      const s = dateStr.trim();
      if (s.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/))
        return new Date(s.replace(" ", "T") + ":00");
      if (s.match(/^\d{4}-\d{2}-\d{2}/))
        return new Date(s.substring(0, 10) + "T00:00:00");
      const p = new Date(s);
      if (!isNaN(p.getTime())) return p;
    }
    const p = new Date(dateStr);
    return isNaN(p.getTime()) ? null : p;
  };

  const parseAmount = (val: any): number => {
    if (val == null) return 0;
    if (typeof val === "number" && !isNaN(val)) return val;
    const s = String(val)
      .trim()
      .replace(/[$€£,\s]/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
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
  const totalFallbacks = [
    "Total Amount",
    "Total",
    "Amount",
    "total",
    "amount",
    "revenue",
    "Revenue",
  ];

  // Normalize order: extract date and total using field fallbacks
  const normalizeOrder = (o: any) => {
    let dateStr = getVal(o, dateFallbacks);
    if (dateStr == null) {
      for (const k of Object.keys(o)) {
        if (/date|time/i.test(k) && o[k]) {
          dateStr = o[k];
          break;
        }
      }
    }
    const totalVal = getVal(o, totalFallbacks);
    return {
      date: dateStr,
      total: parseAmount(totalVal),
    };
  };

  const fromDateObj = new Date(fromDate);
  fromDateObj.setHours(0, 0, 0, 0);
  const toDateObj = new Date(toDate);
  toDateObj.setHours(23, 59, 59, 999);

  // Filter and calculate
  const ordersInRange = orders.map(normalizeOrder).filter((o) => {
    const orderDate = parseDate(o.date);
    if (!orderDate) return false;
    return orderDate >= fromDateObj && orderDate <= toDateObj;
  });

  const totalRevenue = ordersInRange.reduce((sum, o) => sum + o.total, 0);

  // Calculate monthly breakdown for historical data
  const monthlyRevenue: { [key: string]: number } = {};
  ordersInRange.forEach((o) => {
    const orderDate = parseDate(o.date);
    if (!orderDate) return;
    const period = orderDate.toISOString().substring(0, 7); // YYYY-MM
    monthlyRevenue[period] = (monthlyRevenue[period] || 0) + o.total;
  });

  const historicalData = Object.entries(monthlyRevenue)
    .map(([period, revenue]) => ({
      period,
      value: parseFloat(revenue.toFixed(2)),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: parseFloat(totalRevenue.toFixed(2)),
    historicalData,
  };
}
