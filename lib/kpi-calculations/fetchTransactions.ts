import { SupabaseClient } from "@supabase/supabase-js";

export interface NormalizedTransaction {
  amount: number;
  date: string;
  type: "inflow" | "outflow";
}

/**
 * Fetch transaction rows from model_data for the company.
 * Uses model_table_id (resolves "Transactions" table by name).
 * Normalizes row data to { amount, date, type } supporting both legacy keys
 * (amount, date, type) and data_tables field names (Amount, Date, Direction (inflow / outflow)).
 */
export async function fetchTransactionsForCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<NormalizedTransaction[]> {
  const { data: tableDef } = await supabase
    .from("data_tables")
    .select("id")
    .ilike("name", "transactions")
    .limit(1)
    .single();

  if (!tableDef?.id) {
    return [];
  }

  const transactionsData: { data: unknown }[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", companyId)
      .eq("model_table_id", tableDef.id)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });

    if (result.error || !result.data?.length) {
      hasMore = false;
      break;
    }
    transactionsData.push(...(result.data as { data: unknown }[]));
    from += pageSize;
    hasMore = result.data.length === pageSize;
  }

  const normalized: NormalizedTransaction[] = [];
  for (const row of transactionsData) {
    const d = row.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object") continue;

    const amountRaw = d.amount ?? d.Amount ?? d.value ?? d.total;
    const amount =
      typeof amountRaw === "string" ? parseFloat(amountRaw) : Number(amountRaw);
    if (Number.isNaN(amount)) continue;

    const dateRaw = d.date ?? d.Date ?? d.payment_date ?? d.created_at;
    const dateStr = dateRaw != null ? String(dateRaw).trim() : "";
    if (!dateStr) continue;

    const directionRaw =
      d.type ?? d["Direction (inflow / outflow)"] ?? d.Direction ?? d.direction;
    const dir = String(directionRaw ?? "")
      .toLowerCase()
      .trim();
    const type: "inflow" | "outflow" =
      dir.includes("inflow") || dir === "in" ? "inflow" : "outflow";

    normalized.push({
      amount,
      date: dateStr,
      type,
    });
  }
  return normalized;
}
