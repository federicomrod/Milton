import { SupabaseClient } from "@supabase/supabase-js";
import { calculateTotalRevenue } from "./calculateTotalRevenue";

export async function calculatePrimeCostPercent(
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

  // Get total revenue
  const revenueResult = await calculateTotalRevenue(
    supabase,
    userId,
    fromDate,
    toDate
  );
  const totalRevenue = revenueResult.currentValue;

  // Fetch transactions data
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

  // Filter transactions data
  const transactionsData = allModelData.filter(
    (row) =>
      idToNameMap[row.model_table_id]?.includes("transaction") ||
      idToNameMap[row.model_table_id]?.includes("expense") ||
      idToNameMap[row.model_table_id]?.includes("payment")
  );

  // Parse transactions
  const transactions: any[] = [];
  for (const row of transactionsData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) {
      transactions.push(...d);
    } else if (d && typeof d === "object") {
      transactions.push(d);
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

  // Normalize transaction
  const normalizeTransaction = (t: any) => {
    return {
      date:
        t.date ||
        t.transaction_date ||
        t.payment_date ||
        t.created_at ||
        t["Date"],
      amount:
        typeof (t.amount || t.value || t["Amount"]) === "string"
          ? parseFloat(t.amount || t.value || t["Amount"] || "0")
          : t.amount || t.value || t["Amount"] || 0,
      category: (t.category || t.type || t["Category"] || "").toLowerCase(),
      description: (
        t.description ||
        t.name ||
        t["Description"] ||
        ""
      ).toLowerCase(),
    };
  };

  const fromDateObj = new Date(fromDate);
  fromDateObj.setHours(0, 0, 0, 0);
  const toDateObj = new Date(toDate);
  toDateObj.setHours(23, 59, 59, 999);

  // Filter transactions by date
  const transactionsInRange = transactions
    .map(normalizeTransaction)
    .filter((t) => {
      const transDate = parseDate(t.date);
      if (!transDate) return false;
      return transDate >= fromDateObj && transDate <= toDateObj;
    });

  // Identify COGS (Cost of Goods Sold)
  const isCOGS = (category: string, description: string) => {
    const cogsKeywords = [
      "cogs",
      "cost of goods",
      "food cost",
      "ingredient",
      "inventory",
      "purchase",
      "supply",
    ];
    return (
      cogsKeywords.some((kw) => category.includes(kw)) ||
      cogsKeywords.some((kw) => description.includes(kw))
    );
  };

  // Identify Labor costs
  const isLabor = (category: string, description: string) => {
    const laborKeywords = [
      "labor",
      "wage",
      "salary",
      "payroll",
      "staff",
      "employee",
      "hourly",
    ];
    return (
      laborKeywords.some((kw) => category.includes(kw)) ||
      laborKeywords.some((kw) => description.includes(kw))
    );
  };

  const totalCOGS = Math.abs(
    transactionsInRange
      .filter((t) => isCOGS(t.category, t.description) && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
  );

  const totalLabor = Math.abs(
    transactionsInRange
      .filter((t) => isLabor(t.category, t.description) && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
  );

  const primeCost = totalCOGS + totalLabor;
  const primeCostPercent =
    totalRevenue > 0 ? (primeCost / totalRevenue) * 100 : 0;

  // Calculate monthly breakdown for historical data
  const monthlyPrimeCost: {
    [key: string]: { cogs: number; labor: number; revenue: number };
  } = {};

  transactionsInRange.forEach((t) => {
    const transDate = parseDate(t.date);
    if (!transDate) return;
    const period = transDate.toISOString().substring(0, 7);
    if (!monthlyPrimeCost[period]) {
      monthlyPrimeCost[period] = { cogs: 0, labor: 0, revenue: 0 };
    }
    const amount = Math.abs(t.amount < 0 ? t.amount : 0);
    if (isCOGS(t.category, t.description)) {
      monthlyPrimeCost[period].cogs += amount;
    } else if (isLabor(t.category, t.description)) {
      monthlyPrimeCost[period].labor += amount;
    }
  });

  // Get monthly revenue from revenueResult
  const revenueByPeriod = new Map(
    revenueResult.historicalData.map((d) => [d.period, d.value])
  );

  const historicalData = Object.entries(monthlyPrimeCost)
    .map(([period, costs]) => {
      const revenue = revenueByPeriod.get(period) || 0;
      const primeCost = costs.cogs + costs.labor;
      const percent = revenue > 0 ? (primeCost / revenue) * 100 : 0;
      return {
        period,
        value: parseFloat(percent.toFixed(2)),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: parseFloat(primeCostPercent.toFixed(2)),
    historicalData,
  };
}
