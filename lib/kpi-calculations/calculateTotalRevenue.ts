import { SupabaseClient } from "@supabase/supabase-js";

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

  // Filter orders data
  const ordersData = allModelData.filter((row) => {
    const tableName = idToNameMap[row.model_table_id] || "";
    return (
      tableName === "orders" ||
      tableName.includes("order") ||
      tableName.includes("sale")
    );
  });

  // Parse orders
  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) {
      orders.push(...d);
    } else if (d && typeof d === "object") {
      orders.push(d);
    }
  }

  // Helper to parse dates
  const parseDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null;
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)) {
      return new Date(dateStr.replace(" ", "T") + ":00");
    }
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
      return new Date(dateStr + "T00:00:00");
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Normalize order
  const normalizeOrder = (o: any) => {
    return {
      date:
        o.date ||
        o.order_date ||
        o.sale_date ||
        o.created_at ||
        o["Date"] ||
        o["Order Date"] ||
        o["Date & Time"] ||
        o["Date &amp; Time"],
      total:
        typeof (
          o.total ||
          o.amount ||
          o.revenue ||
          o["Total"] ||
          o["Amount"] ||
          o["Total Amount"]
        ) === "string"
          ? parseFloat(
              o.total ||
                o.amount ||
                o.revenue ||
                o["Total"] ||
                o["Amount"] ||
                o["Total Amount"] ||
                "0"
            )
          : o.total ||
            o.amount ||
            o.revenue ||
            o["Total"] ||
            o["Amount"] ||
            o["Total Amount"] ||
            0,
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
