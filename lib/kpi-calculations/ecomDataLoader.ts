import type { SupabaseClient } from "@supabase/supabase-js";

/** E-Commerce table names as stored in data_tables.name (used for matching). */
export const ECOM_TABLE_NAMES = {
  customers: "E-Com Customers",
  orders: "E-Com Orders",
  orderItems: "E-Com Order Items",
  products: "E-Com Products",
  marketingSpend: "E-Com Marketing Spend",
  transactions: "Transactions",
} as const;

export interface EcomData {
  customers: any[];
  orders: any[];
  orderItems: any[];
  products: any[];
  marketingSpend: any[];
  transactions: any[];
}

/**
 * Fetches all E-Commerce model_data for a company and returns rows grouped by table.
 * Uses data_tables.id for model_data.model_table_id; matches table by data_tables.name.
 */
export async function getEcomModelData(
  supabase: SupabaseClient,
  companyId: string
): Promise<EcomData> {
  const empty: EcomData = {
    customers: [],
    orders: [],
    orderItems: [],
    products: [],
    marketingSpend: [],
    transactions: [],
  };

  let allRows: { model_table_id: string; data: unknown }[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await supabase
      .from("model_data")
      .select("model_table_id, data")
      .eq("company_id", companyId)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });

    if (result.error) return empty;
    if (result.data?.length) {
      allRows = [...allRows, ...result.data];
      from += pageSize;
      hasMore = result.data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  // Normalize to strings; Supabase may return UUID in different shape/casing
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const rawIds = [
    ...new Set(
      allRows
        .map((r) => (r.model_table_id != null ? String(r.model_table_id) : ""))
        .filter(Boolean)
    ),
  ];
  const tableIds = rawIds.map((id) =>
    isUuid.test(id) ? id.toLowerCase() : id
  );
  if (tableIds.length === 0) return empty;

  const ids = tableIds.filter((id) => isUuid.test(id));
  const slugs = tableIds.filter((id) => !isUuid.test(id));

  const idToName: Record<string, string> = {};
  const slugToName: Record<string, string> = {};
  const ecomNamesSet = new Set<string>(Object.values(ECOM_TABLE_NAMES));

  if (ids.length > 0) {
    const { data: tablesById } = await supabase
      .from("data_tables")
      .select("id, name")
      .in("id", ids);
    tablesById?.forEach((t: { id: string; name: string }) => {
      const key = String(t.id).toLowerCase();
      idToName[key] = t.name;
    });
  }
  if (slugs.length > 0) {
    const { data: tablesBySlug } = await supabase
      .from("data_tables")
      .select("slug, name")
      .in("slug", slugs);
    tablesBySlug?.forEach((t: { slug: string; name: string }) => {
      slugToName[t.slug] = t.name;
    });
  }

  const tableIdToName = (modelTableId: string): string | undefined => {
    const s = String(modelTableId).trim();
    const key = isUuid.test(s) ? s.toLowerCase() : s;
    if (idToName[key]) return idToName[key];
    if (slugToName[s]) return slugToName[s];
    if (ecomNamesSet.has(s)) return s;
    // Case-insensitive match (e.g. "e-com orders" -> "E-Com Orders")
    const byLower = Object.values(ECOM_TABLE_NAMES).find(
      (n) => n.toLowerCase() === s.toLowerCase()
    );
    if (byLower) return byLower;
    return undefined;
  };

  const flatten = (row: { data: unknown }): any[] => {
    const d = row.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") return [d];
    return [];
  };

  const byTable: Record<string, any[]> = {
    [ECOM_TABLE_NAMES.customers]: [],
    [ECOM_TABLE_NAMES.orders]: [],
    [ECOM_TABLE_NAMES.orderItems]: [],
    [ECOM_TABLE_NAMES.products]: [],
    [ECOM_TABLE_NAMES.marketingSpend]: [],
    [ECOM_TABLE_NAMES.transactions]: [],
  };

  for (const row of allRows) {
    const name = tableIdToName(row.model_table_id);
    if (!name) continue;
    if (byTable[name]) {
      byTable[name].push(...flatten(row));
      continue;
    }
    // Fallback: match by name pattern so "Orders", "Order", "ecom_orders" still map
    const lower = name.toLowerCase();
    if (lower.includes("order") && !lower.includes("item")) {
      byTable[ECOM_TABLE_NAMES.orders].push(...flatten(row));
    } else if (lower.includes("item") && lower.includes("order")) {
      byTable[ECOM_TABLE_NAMES.orderItems].push(...flatten(row));
    } else if (lower.includes("marketing") || lower.includes("spend")) {
      byTable[ECOM_TABLE_NAMES.marketingSpend].push(...flatten(row));
    } else if (lower.includes("customer")) {
      byTable[ECOM_TABLE_NAMES.customers].push(...flatten(row));
    } else if (lower.includes("product")) {
      byTable[ECOM_TABLE_NAMES.products].push(...flatten(row));
    } else if (lower.includes("transaction")) {
      byTable[ECOM_TABLE_NAMES.transactions].push(...flatten(row));
    }
  }

  return {
    customers: byTable[ECOM_TABLE_NAMES.customers] ?? [],
    orders: byTable[ECOM_TABLE_NAMES.orders] ?? [],
    orderItems: byTable[ECOM_TABLE_NAMES.orderItems] ?? [],
    products: byTable[ECOM_TABLE_NAMES.products] ?? [],
    marketingSpend: byTable[ECOM_TABLE_NAMES.marketingSpend] ?? [],
    transactions: byTable[ECOM_TABLE_NAMES.transactions] ?? [],
  };
}
