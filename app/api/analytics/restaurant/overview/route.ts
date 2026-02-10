// GET /api/analytics/restaurant/overview?from_date=...&to_date=...&period=month|week
// Returns KPIs for Restaurant Overview (Dashboard) - Priority 1 KPIs
// Now uses database KPI definitions from business_model_templates
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateTotalRevenue } from "@/lib/kpi-calculations/calculateTotalRevenue";
import { calculateCovers } from "@/lib/kpi-calculations/calculateCovers";
import { calculateAverageTicketSize } from "@/lib/kpi-calculations/calculateAverageTicketSize";
import { calculatePrimeCostPercent } from "@/lib/kpi-calculations/calculatePrimeCostPercent";

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
      return jsonNoStore({ kpis: {}, trends: {}, kpiDefinitions: [] });
    }

    // Get date range and period from query params
    const period = req.nextUrl.searchParams.get("period") || "month";
    const fromDateParam = req.nextUrl.searchParams.get("from_date");
    const toDateParam = req.nextUrl.searchParams.get("to_date");

    let fromDate: Date;
    let toDate: Date;

    if (fromDateParam && toDateParam) {
      fromDate = new Date(fromDateParam);
      toDate = new Date(toDateParam);
    } else {
      toDate = new Date();
      fromDate = new Date();
      if (period === "week") {
        fromDate.setDate(fromDate.getDate() - 7);
      } else {
        fromDate.setMonth(fromDate.getMonth() - 1);
      }
    }

    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];

    // Get restaurant business model template to fetch KPI IDs
    const { data: template, error: templateError } = await supabase
      .from("business_model_templates")
      .select("kpi_ids")
      .eq("key", "restaurant")
      .single();

    if (templateError || !template || !template.kpi_ids) {
      return jsonNoStore({ kpis: {}, trends: {}, kpiDefinitions: [] });
    }

    const kpiIds = template.kpi_ids as string[];

    // Get KPI definitions for restaurant template KPIs
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", kpiIds);

    if (kpisError || !kpis) {
      return jsonNoStore({ kpis: {}, trends: {}, kpiDefinitions: [] });
    }

    // Filter to Priority 1 KPIs only (for overview tab)
    const priority1KpiNames = [
      "Total Revenue",
      "Covers (Guests Served)",
      "Average Ticket Size",
      "Prime Cost %",
    ];

    const priority1Kpis = kpis.filter((kpi) =>
      priority1KpiNames.includes(kpi.name)
    );

    // Calculate each KPI
    const calculatedKpis = await Promise.all(
      priority1Kpis.map(async (kpi) => {
        try {
          const kpiName = kpi.name?.toLowerCase().trim();
          let result = null;

          if (
            kpiName?.includes("total revenue") ||
            kpiName?.includes("revenue")
          ) {
            result = await calculateTotalRevenue(
              supabase,
              user.id,
              fromDateStr,
              toDateStr
            );
          } else if (
            kpiName?.includes("covers") ||
            kpiName?.includes("guests served")
          ) {
            result = await calculateCovers(
              supabase,
              user.id,
              fromDateStr,
              toDateStr
            );
          } else if (
            kpiName?.includes("average ticket") ||
            kpiName?.includes("ticket size")
          ) {
            result = await calculateAverageTicketSize(
              supabase,
              user.id,
              fromDateStr,
              toDateStr
            );
          } else if (
            kpiName?.includes("prime cost") ||
            kpiName?.includes("prime cost %")
          ) {
            result = await calculatePrimeCostPercent(
              supabase,
              user.id,
              fromDateStr,
              toDateStr
            );
          } else {
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
            error:
              calcError instanceof Error
                ? calcError.message
                : "Calculation error",
          };
        }
      })
    );

    // Calculate trends by comparing with previous period
    const periodDuration = toDate.getTime() - fromDate.getTime();
    const prevToDate = new Date(fromDate);
    prevToDate.setHours(23, 59, 59, 999);
    const prevFromDate = new Date(prevToDate.getTime() - periodDuration);
    prevFromDate.setHours(0, 0, 0, 0);

    const prevFromDateStr = prevFromDate.toISOString().split("T")[0];
    const prevToDateStr = prevToDate.toISOString().split("T")[0];

    // Calculate previous period values for trends
    const prevCalculatedKpis = await Promise.all(
      priority1Kpis.map(async (kpi) => {
        try {
          const kpiName = kpi.name?.toLowerCase().trim();
          let result = null;

          if (
            kpiName?.includes("total revenue") ||
            kpiName?.includes("revenue")
          ) {
            result = await calculateTotalRevenue(
              supabase,
              user.id,
              prevFromDateStr,
              prevToDateStr
            );
          } else if (
            kpiName?.includes("covers") ||
            kpiName?.includes("guests served")
          ) {
            result = await calculateCovers(
              supabase,
              user.id,
              prevFromDateStr,
              prevToDateStr
            );
          } else if (
            kpiName?.includes("average ticket") ||
            kpiName?.includes("ticket size")
          ) {
            result = await calculateAverageTicketSize(
              supabase,
              user.id,
              prevFromDateStr,
              prevToDateStr
            );
          } else if (
            kpiName?.includes("prime cost") ||
            kpiName?.includes("prime cost %")
          ) {
            result = await calculatePrimeCostPercent(
              supabase,
              user.id,
              prevFromDateStr,
              prevToDateStr
            );
          } else {
            result = { currentValue: 0, historicalData: [] };
          }

          return {
            kpiId: kpi.id,
            currentValue: result.currentValue,
          };
        } catch {
          return {
            kpiId: kpi.id,
            currentValue: 0,
          };
        }
      })
    );

    // Build trends map
    const trendsMap: Record<string, number> = {};
    calculatedKpis.forEach((kpi) => {
      const prevKpi = prevCalculatedKpis.find((p) => p.kpiId === kpi.id);
      const prevValue = prevKpi?.currentValue || 0;
      const currentValue = kpi.currentValue || 0;

      let trend = 0;
      if (prevValue > 0) {
        trend = ((currentValue - prevValue) / prevValue) * 100;
      } else if (currentValue > 0) {
        trend = 100;
      }

      // For Prime Cost %, use absolute difference instead of percentage
      if (kpi.name?.includes("Prime Cost %")) {
        trend = currentValue - prevValue;
      }

      trendsMap[kpi.id] = parseFloat(trend.toFixed(1));
    });

    // Calculate COGS, Labor, and Prime Cost for the breakdown display
    // We need to fetch transactions and calculate these values
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
    const tableIds = [
      ...new Set(allModelData.map((row) => row.model_table_id)),
    ];
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

    const fromDateObj = new Date(fromDateStr);
    fromDateObj.setHours(0, 0, 0, 0);
    const toDateObj = new Date(toDateStr);
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

    const totalCOGS =
      Math.abs(
        transactionsInRange
          .filter((t) => isCOGS(t.category, t.description) && t.amount < 0)
          .reduce((sum, t) => {
            const amount = Math.abs(t.amount) || 0;
            return (sum || 0) + amount;
          }, 0)
      ) || 0;

    const totalLabor =
      Math.abs(
        transactionsInRange
          .filter((t) => isLabor(t.category, t.description) && t.amount < 0)
          .reduce((sum, t) => {
            const amount = Math.abs(t.amount) || 0;
            return (sum || 0) + amount;
          }, 0)
      ) || 0;

    const primeCost = (totalCOGS || 0) + (totalLabor || 0);

    // Build legacy format for backward compatibility
    const kpisMap: Record<string, number> = {};
    calculatedKpis.forEach((kpi) => {
      const value = kpi.currentValue || 0;
      if (kpi.name?.includes("Total Revenue")) {
        kpisMap.totalRevenue = parseFloat(value.toFixed(2));
      } else if (kpi.name?.includes("Covers")) {
        kpisMap.covers = Math.round(value);
      } else if (kpi.name?.includes("Average Ticket Size")) {
        kpisMap.averageTicketSize = parseFloat(value.toFixed(2));
      } else if (kpi.name?.includes("Prime Cost %")) {
        kpisMap.primeCostPercent = parseFloat(value.toFixed(2));
      }
    });

    // Add breakdown values
    kpisMap.totalCOGS = parseFloat(totalCOGS.toFixed(2));
    kpisMap.totalLabor = parseFloat(totalLabor.toFixed(2));
    kpisMap.primeCost = parseFloat(primeCost.toFixed(2));

    const trendsMapLegacy: Record<string, number> = {};
    Object.entries(trendsMap).forEach(([kpiId, trend]) => {
      const kpi = calculatedKpis.find((k) => k.id === kpiId);
      if (kpi?.name?.includes("Total Revenue")) {
        trendsMapLegacy.totalRevenue = trend;
      } else if (kpi?.name?.includes("Covers")) {
        trendsMapLegacy.covers = trend;
      } else if (kpi?.name?.includes("Average Ticket Size")) {
        trendsMapLegacy.averageTicketSize = trend;
      } else if (kpi?.name?.includes("Prime Cost %")) {
        trendsMapLegacy.primeCostPercent = trend;
      }
    });

    return jsonNoStore({
      kpis: kpisMap,
      trends: trendsMapLegacy,
      kpiDefinitions: calculatedKpis.map((kpi) => ({
        id: kpi.id,
        name: kpi.name,
        definition: kpi.definition,
        currentValue: kpi.currentValue,
        trend: trendsMap[kpi.id],
      })),
    });
  } catch (err) {
    console.error("[api/analytics/restaurant/overview] Unexpected error:", err);
    return jsonNoStore({ kpis: {}, trends: {}, kpiDefinitions: [] });
  }
}
