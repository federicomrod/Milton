// GET /api/analytics/fitness-studio/cash-flow?from_date=...&to_date=...&period=month|year|ytd|custom
// Returns Cash Flow transactions and (when available) runway/burn from unified kpi-calculations layer.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TransactionData } from "@/lib/types/data";
import { calculateRunway, calculateBurnRate } from "@/lib/kpi-calculations";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function parseDate(dateStr: any): Date | null {
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
      return jsonNoStore({ transactions: [] });
    }

    // Get date range from query params
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
      if (period === "year") {
        fromDate = new Date(new Date().getFullYear() - 1, 0, 1);
        toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59);
      } else if (period === "ytd") {
        fromDate = new Date(new Date().getFullYear(), 0, 1);
      } else {
        // month - default to current month
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
      }
    }

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // Fetch all model_data for the company (with pagination)
    let allModelData: { model_table_id: string; data: unknown }[] = [];
    let fromIdx = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const result = await supabase
        .from("model_data")
        .select("model_table_id, data")
        .eq("company_id", company.id)
        .range(fromIdx, fromIdx + pageSize - 1)
        .order("id", { ascending: true });

      if (result.error) {
        console.error("[cash-flow] Error fetching model_data:", result.error);
        break;
      }

      if (result.data && result.data.length > 0) {
        allModelData = [...allModelData, ...result.data];
        fromIdx += pageSize;
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

    // Filter data by table name - look for transactions table
    const transactionsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "transactions"
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

    // Get field names from data_tables definitions
    const transactionsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "transactions"
    );
    const transactionsFields = transactionsTableId
      ? tableFieldsMap[transactionsTableId]?.fields || []
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

    // Normalize transactions using database field names
    const normalizeTransaction = (t: any): TransactionData => {
      const dateField = transactionsFields.find((f) =>
        f.name.toLowerCase().includes("date")
      )?.name;
      const date = dateField
        ? getFieldValue(t, dateField, ["date", "Date", "transaction_date"])
        : t.date || t.Date || t.transaction_date || "";

      const amountField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("amount") ||
          f.name.toLowerCase().includes("value") ||
          f.name.toLowerCase().includes("price")
      )?.name;
      const amountRaw = amountField
        ? getFieldValue(t, amountField, [
            "amount",
            "Amount",
            "value",
            "Value",
            "price",
            "Price",
          ])
        : t.amount || t.Amount || t.value || t.Value || t.price || t.Price || 0;
      const amount =
        typeof amountRaw === "string" ? parseFloat(amountRaw) : amountRaw || 0;

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
        : t.category || t.Category || t.type || t.Type || "Uncategorized";

      const descriptionField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("description") ||
          f.name.toLowerCase().includes("name") ||
          f.name.toLowerCase().includes("memo")
      )?.name;
      const description = descriptionField
        ? getFieldValue(t, descriptionField, [
            "description",
            "Description",
            "name",
            "Name",
            "memo",
            "Memo",
          ])
        : t.description ||
          t.Description ||
          t.name ||
          t.Name ||
          t.memo ||
          t.Memo ||
          "";

      const referenceField = transactionsFields.find(
        (f) =>
          f.name.toLowerCase().includes("reference") ||
          f.name.toLowerCase().includes("id")
      )?.name;
      const reference = referenceField
        ? getFieldValue(t, referenceField, [
            "reference",
            "Reference",
            "id",
            "ID",
          ])
        : t.reference || t.Reference || t.id || t.ID || "";

      return {
        id: t.id || t.ID || `tx_${Math.random().toString(36).substr(2, 9)}`,
        date,
        amount,
        category,
        name: description,
        description,
        reference,
      };
    };

    // Normalize all transactions
    const normalizedTransactions = transactions.map(normalizeTransaction);

    // Filter transactions by date range
    const filteredTransactions = normalizedTransactions.filter((t) => {
      const txDate = parseDate(t.date);
      if (!txDate) return false;
      return txDate >= fromDate && txDate <= toDate;
    });

    const fromDateStr = fromDate.toISOString().slice(0, 10);
    const toDateStr = toDate.toISOString().slice(0, 10);
    const [runwayRes, burnRes] = await Promise.all([
      calculateRunway(supabase, user!.id, fromDateStr, toDateStr).catch(() => ({
        currentValue: null,
      })),
      calculateBurnRate(supabase, user!.id, fromDateStr, toDateStr).catch(
        () => ({ currentValue: null })
      ),
    ]);

    return jsonNoStore({
      transactions: filteredTransactions,
      runwayMonths: runwayRes.currentValue ?? undefined,
      burnRate: burnRes.currentValue ?? undefined,
    });
  } catch (err) {
    console.error(
      "[api/analytics/fitness-studio/cash-flow] Unexpected error:",
      err
    );
    return jsonNoStore({ transactions: [] });
  }
}
