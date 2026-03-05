import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { toPeriod, parseFlexibleDate, readField } from "./fieldAccessors";

/**
 * Returns YYYY-MM for each month in [from, to] (inclusive of month boundaries).
 */
function monthsInRange(from: Date, to: Date): string[] {
  const months: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    months.push(toPeriod(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

/** Parse invoice date: flexible string, Date object, or Excel serial number. */
function parseInvoiceDate(value: any): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    if (value > 1e12) return new Date(value); // Unix ms
    if (value > 1000 && value < 100000)
      return new Date((value - 25569) * 86400 * 1000); // Excel serial
    return null;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const d = new Date(value.trim().replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }
  return parseFlexibleDate(value);
}

/** Find first key in record that contains the given substring (case-insensitive). */
function findKey(record: any, substring: string): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const sub = substring.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase().includes(sub)) return key;
  }
  return undefined;
}

/** Get value from record by key, with fallbacks (case-insensitive match). */
function getInvVal(inv: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = readField(inv, k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  const lowerKeys = keys.map((x) => x.toLowerCase());
  for (const key of Object.keys(inv || {})) {
    if (lowerKeys.includes(key.toLowerCase())) return inv[key];
  }
  return undefined;
}

/**
 * Revenue Growth Rate KPI (based on paid invoices only):
 * - Card: growth from beginning to end of selected date range
 * - Chart: month-over-month growth % for each month in range
 *
 * Resolves date/status/amount columns from the actual invoice data so it works
 * regardless of how columns are named in data_tables or the file.
 */
export async function calculateRevenueGrowthRate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  currentValue: number | null;
  historicalData: { period: string; value: number }[];
}> {
  try {
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();

    if (!company) return { currentValue: null, historicalData: [] };

    const invoices = await getModelDataRows(
      supabase,
      company.id,
      "invoices",
      "Invoices",
      "invoice"
    );

    if (!invoices?.length) return { currentValue: null, historicalData: [] };

    const from = new Date(fromDate + "T00:00:00");
    const to = new Date(toDate + "T23:59:59");
    if (from.getTime() > to.getTime())
      return { currentValue: null, historicalData: [] };

    // Resolve column names from first invoice (matches actual stored keys)
    const first = invoices[0] as Record<string, unknown>;
    const dateKey =
      findKey(first, "issue") || findKey(first, "date") || "Issue Date";
    const statusKey = findKey(first, "status") || "Status";
    const amountKey =
      findKey(first, "total amount") ||
      findKey(first, "amount") ||
      findKey(first, "total") ||
      "Total Amount";

    const monthlyRevenue: Record<string, number> = {};
    for (const inv of invoices as Record<string, any>[]) {
      const statusRaw = inv[statusKey] ?? getInvVal(inv, "Status", "status");
      const status = String(statusRaw ?? "")
        .toLowerCase()
        .trim();
      if (status !== "paid") continue;

      const dateRaw =
        inv[dateKey] ??
        getInvVal(inv, "Issue Date", "date", "Date", "invoice_date");
      const date = dateRaw ? parseInvoiceDate(dateRaw) : null;
      if (!date || isNaN(date.getTime()) || date < from || date > to) continue;

      const period = toPeriod(date);
      const amountRaw =
        inv[amountKey] ??
        getInvVal(inv, "Total Amount", "amount", "Amount", "total", "Total");
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(String(amountRaw).replace(/,/g, ""))
          : Number(amountRaw) || 0;
      monthlyRevenue[period] = (monthlyRevenue[period] ?? 0) + Math.abs(amount);
    }

    const orderedMonths = monthsInRange(from, to);
    if (orderedMonths.length === 0)
      return { currentValue: null, historicalData: [] };

    const revenueFirst = monthlyRevenue[orderedMonths[0]] ?? 0;
    const revenueLast =
      monthlyRevenue[orderedMonths[orderedMonths.length - 1]] ?? 0;

    const currentValue =
      revenueFirst > 0
        ? ((revenueLast - revenueFirst) / revenueFirst) * 100
        : revenueLast > 0
          ? null
          : 0;

    // Chart: growth vs first month in range (so 0% at starting month, positive above, negative below)
    const revFirst = monthlyRevenue[orderedMonths[0]] ?? 0;
    const historicalData: { period: string; value: number }[] = [];
    for (let i = 0; i < orderedMonths.length; i++) {
      const period = orderedMonths[i];
      const revThis = monthlyRevenue[period] ?? 0;
      const value = revFirst > 0 ? ((revThis - revFirst) / revFirst) * 100 : 0;
      historicalData.push({
        period,
        value: Math.round(value * 100) / 100,
      });
    }

    return {
      currentValue:
        currentValue !== null
          ? Math.round(currentValue * 100) / 100
          : currentValue,
      historicalData,
    };
  } catch {
    return { currentValue: null, historicalData: [] };
  }
}
