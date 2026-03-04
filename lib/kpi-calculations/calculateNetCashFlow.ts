import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { toPeriod } from "./fieldAccessors";

export async function calculateNetCashFlow(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) throw new Error("Company not found");

  const transactions = await getModelDataRows(
    supabase,
    company.id,
    "transactions"
  );
  const invoices = await getModelDataRows(supabase, company.id, "invoices");

  const from = new Date(fromDate);
  const to = new Date(toDate);
  const monthlyStats: Record<string, { inflows: number; outflows: number }> =
    {};

  // Helper function to parse dates in various formats
  const parseDate = (dateStr: any): Date | null => {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr !== "string") return null;

    // Try YYYY-MM-DD HH:mm:ss format (with space separator)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
      return new Date(dateStr.replace(" ", "T"));
    }

    // Try YYYY-MM-DD format (date only)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr + "T00:00:00");
    }

    // Try YYYY-MM-DD format (with other characters after)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      return new Date(dateStr.split(" ")[0] + "T00:00:00");
    }

    // Try MM/DD/YY or MM/DD/YYYY format
    if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
      const parts = dateStr.split("/");
      if (parts.length === 3) {
        const month = parseInt(parts[0]) - 1;
        const day = parseInt(parts[1]);
        let year = parseInt(parts[2]);

        // Handle 2-digit years
        if (year < 50) {
          year += 2000; // 00-49 -> 2000-2049
        } else if (year < 100) {
          year += 1900; // 50-99 -> 1950-1999
        }

        return new Date(year, month, day);
      }
    }

    // Fallback to standard Date parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Helper to get field value with fallbacks
  const getFieldValue = (
    obj: any,
    fieldName: string,
    fallbacks: string[] = []
  ): any => {
    if (obj[fieldName] !== undefined) return obj[fieldName];
    const lowerFieldName = fieldName.toLowerCase();
    for (const key in obj) {
      if (key.toLowerCase() === lowerFieldName) {
        return obj[key];
      }
    }
    for (const fallback of fallbacks) {
      if (obj[fallback] !== undefined) return obj[fallback];
    }
    return undefined;
  };

  // Process transactions
  transactions.forEach((t: any) => {
    const date = parseDate(t.date || t.Date || t.transaction_date);
    if (!date || date < from || date >= to) return;

    const period = toPeriod(date);
    if (!monthlyStats[period]) {
      monthlyStats[period] = { inflows: 0, outflows: 0 };
    }

    const amountRaw = getFieldValue(t, "amount", ["Amount", "value", "Value"]);
    const amount =
      typeof amountRaw === "string"
        ? parseFloat(amountRaw)
        : Number(amountRaw) || 0;

    // Determine if inflow or outflow
    const directionRaw = getFieldValue(t, "direction", [
      "Direction (inflow / outflow)",
      "flow",
    ]);
    const direction = String(directionRaw || "").toLowerCase();

    if (direction.includes("outflow") || direction === "out" || amount < 0) {
      monthlyStats[period].outflows += Math.abs(amount);
    } else if (
      direction.includes("inflow") ||
      direction === "in" ||
      amount > 0
    ) {
      monthlyStats[period].inflows += Math.abs(amount);
    }
  });

  // Process paid invoices as inflows
  invoices.forEach((inv: any) => {
    const status = String(
      getFieldValue(inv, "status", ["Status"]) || ""
    ).toLowerCase();
    if (status !== "paid") return;

    const date = parseDate(inv.date || inv.Date || inv.invoice_date);
    if (!date || date < from || date >= to) return;

    const period = toPeriod(date);
    if (!monthlyStats[period]) {
      monthlyStats[period] = { inflows: 0, outflows: 0 };
    }

    const amountRaw = getFieldValue(inv, "total", [
      "Total",
      "amount",
      "Amount",
      "Total Amount",
    ]);
    const amount =
      typeof amountRaw === "string"
        ? parseFloat(amountRaw)
        : Number(amountRaw) || 0;

    monthlyStats[period].inflows += Math.abs(amount);
  });

  // Calculate monthly net cash flow
  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period,
      value: stats.inflows - stats.outflows,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue = historicalData.reduce(
    (sum, point) => sum + point.value,
    0
  );

  return { currentValue, historicalData };
}
