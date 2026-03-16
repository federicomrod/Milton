// GET /api/analytics/restaurant/cash-flow?from_date=...&to_date=...&period=month|week
// Returns Cash Flow analytics. Burn rate and runway from unified kpi-calculations layer.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateNetCashFlow,
  calculateRunway,
  calculateBurnRate,
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

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return jsonNoStore({
        inflows: [],
        outflows: [],
        netCashFlow: 0,
        burnRate: null,
        cashBalance: null,
        cashRunway: null,
      });
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

    // Normalize dates
    const fromDateStart = new Date(fromDate);
    fromDateStart.setHours(0, 0, 0, 0);
    const toDateEnd = new Date(toDate);
    toDateEnd.setHours(23, 59, 59, 999);

    // Fetch all model_data
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

      if (result.error) {
        console.error(
          "[restaurant-cash-flow] Error fetching model_data:",
          result.error
        );
        break;
      }

      if (result.data && result.data.length > 0) {
        allModelData = [...allModelData, ...result.data];
        from += pageSize;
        hasMore = result.data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    // Get table IDs and convert to names, also fetch field definitions
    const tableIds = [
      ...new Set(allModelData.map((row) => row.model_table_id)),
    ];
    const idToNameMap: Record<string, string> = {};
    const tableFieldsMap: Record<string, { fields: Array<{ name: string }> }> =
      {};

    if (tableIds.length > 0) {
      const { data: tableDefinitions, error: tableError } = await supabase
        .from("data_tables")
        .select("id, name, fields")
        .in("id", tableIds);

      if (!tableError && tableDefinitions) {
        tableDefinitions.forEach((table: any) => {
          idToNameMap[table.id] = table.name.toLowerCase();
          tableFieldsMap[table.id] = {
            fields: table.fields || [],
          };
        });
      }
    }

    // Filter data by table name
    const transactionsData = allModelData.filter(
      (row) =>
        idToNameMap[row.model_table_id]?.includes("transaction") ||
        idToNameMap[row.model_table_id]?.includes("payment") ||
        idToNameMap[row.model_table_id]?.includes("expense") ||
        idToNameMap[row.model_table_id]?.includes("income") ||
        idToNameMap[row.model_table_id]?.includes("bank")
    );
    const ordersData = allModelData.filter(
      (row) =>
        idToNameMap[row.model_table_id]?.includes("order") ||
        idToNameMap[row.model_table_id]?.includes("sale")
    );

    // Parse data
    const transactions: any[] = [];
    if (transactionsData) {
      for (const row of transactionsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          transactions.push(...d);
        } else if (d && typeof d === "object") {
          transactions.push(d);
        }
      }
    }

    const orders: any[] = [];
    if (ordersData) {
      for (const row of ordersData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          orders.push(...d);
        } else if (d && typeof d === "object") {
          orders.push(d);
        }
      }
    }

    // Get field names from data_tables definitions
    const transactionsTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id]?.includes("transaction") ||
        idToNameMap[id]?.includes("payment") ||
        idToNameMap[id]?.includes("expense") ||
        idToNameMap[id]?.includes("income") ||
        idToNameMap[id]?.includes("bank")
    );
    const ordersTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id]?.includes("order") || idToNameMap[id]?.includes("sale")
    );

    const transactionsFields = transactionsTableId
      ? tableFieldsMap[transactionsTableId]?.fields || []
      : [];
    const ordersFields = ordersTableId
      ? tableFieldsMap[ordersTableId]?.fields || []
      : [];

    // Helper to get field value
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

    // Helper functions
    const parseDate = (dateStr: any): Date | null => {
      if (!dateStr) return null;
      if (typeof dateStr === "string") {
        // Handle YYYY-MM-DD HH:mm:ss format
        if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
          return new Date(dateStr.replace(" ", "T"));
        }
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return new Date(dateStr + "T00:00:00");
        }
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
            return parsed;
          }
          return new Date(dateStr.split(" ")[0] + "T00:00:00");
        }
      }
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const normalizeTransaction = (t: any) => {
      const dateField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("time")
      )?.name;
      const date = dateField
        ? getFieldValue(t, dateField, [
            "date",
            "Date",
            "transaction_date",
            "payment_date",
            "created_at",
          ])
        : t.date ||
          t.transaction_date ||
          t.payment_date ||
          t.created_at ||
          t["Date"];

      const amountField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("amount") ||
          f.name.toLowerCase().includes("value")
      )?.name;
      const amountRaw = amountField
        ? getFieldValue(t, amountField, ["amount", "Amount", "value", "Value"])
        : t.amount || t.value || t["Amount"];
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw || "0")
          : amountRaw || 0;

      const categoryField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("category") ||
          f.name.toLowerCase().includes("type")
      )?.name;
      const category = categoryField
        ? getFieldValue(t, categoryField, [
            "category",
            "Category",
            "type",
            "Type",
          ]) || "Uncategorized"
        : t.category || t.type || t["Category"] || t["Type"] || "Uncategorized";

      const descriptionField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("description") ||
          f.name.toLowerCase().includes("name")
      )?.name;
      const description = descriptionField
        ? getFieldValue(t, descriptionField, [
            "description",
            "Description",
            "name",
            "Name",
          ]) || ""
        : t.description || t.name || t["Description"] || t["Name"] || "";

      return {
        date,
        amount,
        category,
        description,
      };
    };

    const normalizeOrder = (o: any) => {
      const dateField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("time")
      )?.name;
      const date = dateField
        ? getFieldValue(o, dateField, [
            "date",
            "Date",
            "order_date",
            "sale_date",
            "created_at",
            "Order Date",
          ])
        : o.date ||
          o.order_date ||
          o.sale_date ||
          o.created_at ||
          o["Date"] ||
          o["Order Date"];

      const totalField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("total") ||
          f.name.toLowerCase().includes("amount") ||
          f.name.toLowerCase().includes("revenue")
      )?.name;
      const totalRaw = totalField
        ? getFieldValue(o, totalField, [
            "total",
            "Total",
            "amount",
            "Amount",
            "revenue",
          ])
        : o.total || o.amount || o.revenue || o["Total"] || o["Amount"];
      const total =
        typeof totalRaw === "string"
          ? parseFloat(totalRaw || "0")
          : totalRaw || 0;

      return {
        date,
        total,
      };
    };

    // Filter transactions by date range
    const transactionsInRange = transactions
      .map(normalizeTransaction)
      .filter((t) => {
        const transDate = parseDate(t.date);
        if (!transDate) return false;
        return transDate >= fromDateStart && transDate <= toDateEnd;
      });

    // Filter orders by date range (for revenue inflows)
    const ordersInRange = orders.map(normalizeOrder).filter((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return false;
      return orderDate >= fromDateStart && orderDate <= toDateEnd;
    });

    // Calculate inflows (positive transactions + revenue from orders)
    const transactionInflows = transactionsInRange
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const orderRevenue = ordersInRange.reduce((sum, o) => sum + o.total, 0);

    // Combine inflows (avoid double counting if orders are also in transactions)
    const totalInflows = Math.max(transactionInflows, orderRevenue);

    // Calculate outflows (negative transactions)
    const totalOutflows = Math.abs(
      transactionsInRange
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    );

    // Net cash flow: use same calculation as Dashboard KPI (Transactions + Invoices)
    // so Dashboard card and Cash Flow tab show the same value
    let netCashFlow = totalInflows - totalOutflows;
    try {
      const fromDateStr =
        fromDateParam || fromDateStart.toISOString().slice(0, 10);
      const toDateStr = toDateParam || toDateEnd.toISOString().slice(0, 10);
      const ncfResult = await calculateNetCashFlow(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      );
      netCashFlow = ncfResult.currentValue ?? netCashFlow;
    } catch {
      // fallback to local calculation
    }

    // Inflows by category
    const inflowsByCategory = new Map<string, number>();
    transactionsInRange
      .filter((t) => t.amount > 0)
      .forEach((t) => {
        const category = t.category || "Other";
        inflowsByCategory.set(
          category,
          (inflowsByCategory.get(category) || 0) + t.amount
        );
      });

    // Add revenue category
    if (orderRevenue > 0) {
      inflowsByCategory.set(
        "Revenue",
        (inflowsByCategory.get("Revenue") || 0) + orderRevenue
      );
    }

    const inflows = Array.from(inflowsByCategory.entries())
      .map(([category, amount]) => ({
        category,
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    // Outflows by category
    const outflowsByCategory = new Map<string, number>();
    transactionsInRange
      .filter((t) => t.amount < 0)
      .forEach((t) => {
        const category = t.category || "Other";
        outflowsByCategory.set(
          category,
          (outflowsByCategory.get(category) || 0) + Math.abs(t.amount)
        );
      });

    const outflows = Array.from(outflowsByCategory.entries())
      .map(([category, amount]) => ({
        category,
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    // Cash Balance (if available in transactions - sum all transactions)
    const allTransactions = transactions.map(normalizeTransaction);
    const cashBalance = allTransactions.reduce((sum, t) => sum + t.amount, 0);

    const fromDateStr = fromDateStart.toISOString().slice(0, 10);
    const toDateStr = toDateEnd.toISOString().slice(0, 10);
    const [runwayRes, burnRes] = await Promise.all([
      calculateRunway(supabase, user!.id, fromDateStr, toDateStr).catch(() => ({
        currentValue: null,
      })),
      calculateBurnRate(supabase, user!.id, fromDateStr, toDateStr).catch(
        () => ({ currentValue: null })
      ),
    ]);

    const burnRate =
      burnRes.currentValue != null
        ? parseFloat(Number(burnRes.currentValue).toFixed(2))
        : null;
    const cashRunway =
      runwayRes.currentValue != null
        ? parseFloat(Number(runwayRes.currentValue).toFixed(1))
        : burnRate != null && burnRate > 0 && cashBalance > 0
          ? parseFloat((cashBalance / burnRate).toFixed(1))
          : null;

    return jsonNoStore({
      inflows,
      outflows,
      netCashFlow: parseFloat(netCashFlow.toFixed(2)),
      burnRate,
      cashBalance:
        cashBalance !== 0 ? parseFloat(cashBalance.toFixed(2)) : null,
      cashRunway,
    });
  } catch (err) {
    console.error(
      "[api/analytics/restaurant/cash-flow] Unexpected error:",
      err
    );
    return jsonNoStore({
      inflows: [],
      outflows: [],
      netCashFlow: 0,
      burnRate: null,
      cashBalance: null,
      cashRunway: null,
    });
  }
}
