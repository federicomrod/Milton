import type { SupabaseClient } from "@supabase/supabase-js";

/** Status values treated as "Captured" for AOV. */
export const CAPTURED_ORDER_STATUSES: string[] = [
  "captured",
  "completed",
  "complete",
  "paid",
  "closed",
  "fulfilled",
  "settled",
  "received",
  "authorized",
  "success",
  "done",
  "delivered",
];

/**
 * AOV = Sum of all Captured order totals / Number of Captured orders.
 * Uses orders table(s); filters by date range and status in CAPTURED_ORDER_STATUSES (or no status).
 */
export async function aovFromCapturedOrders(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<number> {
  let allModelData: { model_table_id: string; data: unknown }[] = [];
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
    if (result.error) break;
    if (result.data?.length) {
      allModelData = [...allModelData, ...result.data];
      from += pageSize;
      hasMore = result.data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  const tableIds = [...new Set(allModelData.map((r) => r.model_table_id))];
  const idToNameMap: Record<string, string> = {};
  const tableFieldsMap: Record<string, { fields: Array<{ name: string }> }> =
    {};
  if (tableIds.length > 0) {
    const { data: tables } = await supabase
      .from("data_tables")
      .select("id, name, fields")
      .in("id", tableIds);
    tables?.forEach((t: any) => {
      idToNameMap[t.id] = t.name.toLowerCase();
      tableFieldsMap[t.id] = { fields: t.fields || [] };
    });
  }

  const ordersData = allModelData.filter((row) => {
    const name = idToNameMap[row.model_table_id] || "";
    return name === "orders" || name.includes("order") || name.includes("sale");
  });
  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }

  const ordersTableId = Object.keys(idToNameMap).find(
    (id) =>
      idToNameMap[id] === "orders" ||
      idToNameMap[id]?.includes("order") ||
      idToNameMap[id]?.includes("sale")
  );
  const fields = ordersTableId
    ? tableFieldsMap[ordersTableId]?.fields || []
    : [];

  const getVal = (
    obj: any,
    fieldName: string,
    fallbacks: string[] = []
  ): any => {
    if (obj[fieldName] !== undefined) return obj[fieldName];
    const lower = fieldName.toLowerCase();
    for (const key in obj) {
      if (key.toLowerCase() === lower) return obj[key];
    }
    for (const fb of fallbacks) {
      if (obj[fb] !== undefined) return obj[fb];
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
      if (s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s + "T00:00:00");
      const p = new Date(s);
      if (!isNaN(p.getTime())) return p;
    }
    const p = new Date(dateStr);
    return isNaN(p.getTime()) ? null : p;
  };

  /** Parse total/amount: strip $ € £ , and parse float */
  const parseTotal = (value: any): number => {
    if (value == null) return 0;
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    const str = String(value)
      .trim()
      .replace(/[$€£,\s]/g, "");
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : 0;
  };

  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  const statusField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("status") ||
      f.name.toLowerCase().includes("state") ||
      f.name.toLowerCase().includes("stage") ||
      f.name.toLowerCase().includes("payment")
  )?.name;
  const totalField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("total") ||
      f.name.toLowerCase().includes("amount") ||
      f.name.toLowerCase().includes("revenue")
  )?.name;
  const dateField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("date") ||
      f.name.toLowerCase().includes("time")
  )?.name;

  const getOrderStatus = (obj: any): string => {
    const fromField = statusField
      ? getVal(obj, statusField, [
          "status",
          "Status",
          "state",
          "State",
          "Payment Status",
          "Order Status",
          "payment_status",
          "order_status",
        ])
      : undefined;
    if (fromField !== undefined && fromField !== null && fromField !== "")
      return String(fromField).toLowerCase().trim();
    const direct =
      obj.status ??
      obj.Status ??
      obj.state ??
      obj.State ??
      obj["Payment Status"] ??
      obj["Order Status"] ??
      obj["Status"];
    if (direct !== undefined && direct !== null && direct !== "")
      return String(direct).toLowerCase().trim();
    for (const key in obj) {
      const k = key.toLowerCase();
      if (
        k.includes("status") ||
        k.includes("state") ||
        (k.includes("payment") && (k.includes("status") || k.includes("state")))
      ) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "")
          return String(v).toLowerCase().trim();
      }
    }
    return "";
  };

  const isCapturedStatus = (status: string): boolean => {
    if (!status) return true;
    return CAPTURED_ORDER_STATUSES.some(
      (s) => status === s || status.includes(s)
    );
  };

  let capturedSum = 0;
  let capturedCount = 0;

  const getOrderTotal = (obj: any): number => {
    const fallbacks = [
      "total",
      "Total",
      "amount",
      "Amount",
      "Total Amount",
      "Order Total",
      "order_total",
      "total_amount",
      "Grand Total",
      "grand_total",
      "revenue",
      "Revenue",
      "value",
      "Value",
    ];
    if (totalField) {
      const v = getVal(obj, totalField, fallbacks);
      if (v !== undefined && v !== null && v !== "") return parseTotal(v);
    }
    for (const key of fallbacks) {
      const v = obj[key];
      if (v !== undefined && v !== null && v !== "") return parseTotal(v);
    }
    for (const key in obj) {
      const k = key.toLowerCase();
      if (
        k.includes("total") ||
        k.includes("amount") ||
        (k.includes("sum") && !k.includes("item"))
      ) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "") {
          const n = parseTotal(v);
          if (n > 0) return n;
        }
      }
    }
    return 0;
  };

  const getOrderDate = (obj: any): Date | null => {
    const fallbacks = [
      "date",
      "Date",
      "order_date",
      "sale_date",
      "created_at",
      "Order Date",
      "order_date",
      "Created At",
      "created_at",
    ];
    let dateStr: any = null;
    if (dateField) {
      dateStr = getVal(obj, dateField, fallbacks);
    }
    if (dateStr == null)
      dateStr =
        obj.date ??
        obj.Date ??
        obj.order_date ??
        obj.sale_date ??
        obj.created_at ??
        obj["Order Date"] ??
        obj["Created At"];
    if (dateStr == null) {
      for (const key in obj) {
        if (
          key.toLowerCase().includes("date") ||
          key.toLowerCase().includes("time")
        ) {
          const v = obj[key];
          if (v !== undefined && v !== null && v !== "") {
            const d = parseDate(v);
            if (d) return d;
          }
        }
      }
      return null;
    }
    return parseDate(dateStr);
  };

  let anyInRangeSum = 0;
  let anyInRangeCount = 0;

  for (const o of orders) {
    const date = getOrderDate(o);
    if (!date || date < fromObj || date > toObj) continue;

    const total = getOrderTotal(o);
    anyInRangeSum += total;
    anyInRangeCount += 1;

    const status = getOrderStatus(o);
    if (!isCapturedStatus(status)) continue;

    capturedSum += total;
    capturedCount += 1;
  }

  if (capturedCount > 0) return capturedSum / capturedCount;
  if (anyInRangeCount > 0) return anyInRangeSum / anyInRangeCount;
  return 0;
}

export type AovWithHistorical = {
  currentValue: number;
  historicalData: { period: string; value: number }[];
};

/**
 * Same as aovFromCapturedOrders but also returns AOV per month for charting.
 */
export async function aovFromCapturedOrdersWithHistorical(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<AovWithHistorical> {
  let allModelData: { model_table_id: string; data: unknown }[] = [];
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
    if (result.error) break;
    if (result.data?.length) {
      allModelData = [...allModelData, ...result.data];
      from += pageSize;
      hasMore = result.data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  const tableIds = [...new Set(allModelData.map((r) => r.model_table_id))];
  const idToNameMap: Record<string, string> = {};
  const tableFieldsMap: Record<string, { fields: Array<{ name: string }> }> =
    {};
  if (tableIds.length > 0) {
    const { data: tables } = await supabase
      .from("data_tables")
      .select("id, name, fields")
      .in("id", tableIds);
    tables?.forEach((t: any) => {
      idToNameMap[t.id] = t.name.toLowerCase();
      tableFieldsMap[t.id] = { fields: t.fields || [] };
    });
  }

  const ordersData = allModelData.filter((row) => {
    const name = idToNameMap[row.model_table_id] || "";
    return name === "orders" || name.includes("order") || name.includes("sale");
  });
  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }

  const ordersTableId = Object.keys(idToNameMap).find(
    (id) =>
      idToNameMap[id] === "orders" ||
      idToNameMap[id]?.includes("order") ||
      idToNameMap[id]?.includes("sale")
  );
  const fields = ordersTableId
    ? tableFieldsMap[ordersTableId]?.fields || []
    : [];

  const getVal = (
    obj: any,
    fieldName: string,
    fallbacks: string[] = []
  ): any => {
    if (obj[fieldName] !== undefined) return obj[fieldName];
    const lower = fieldName.toLowerCase();
    for (const key in obj) {
      if (key.toLowerCase() === lower) return obj[key];
    }
    for (const fb of fallbacks) {
      if (obj[fb] !== undefined) return obj[fb];
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
      if (s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s + "T00:00:00");
      const p = new Date(s);
      if (!isNaN(p.getTime())) return p;
    }
    const p = new Date(dateStr);
    return isNaN(p.getTime()) ? null : p;
  };

  const parseTotal = (value: any): number => {
    if (value == null) return 0;
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    const str = String(value)
      .trim()
      .replace(/[$€£,\s]/g, "");
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : 0;
  };

  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  const statusField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("status") ||
      f.name.toLowerCase().includes("state") ||
      f.name.toLowerCase().includes("stage") ||
      f.name.toLowerCase().includes("payment")
  )?.name;
  const totalField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("total") ||
      f.name.toLowerCase().includes("amount") ||
      f.name.toLowerCase().includes("revenue")
  )?.name;
  const dateField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("date") ||
      f.name.toLowerCase().includes("time")
  )?.name;

  const getOrderStatus = (obj: any): string => {
    const fromField = statusField
      ? getVal(obj, statusField, [
          "status",
          "Status",
          "state",
          "State",
          "Payment Status",
          "Order Status",
          "payment_status",
          "order_status",
        ])
      : undefined;
    if (fromField !== undefined && fromField !== null && fromField !== "")
      return String(fromField).toLowerCase().trim();
    const direct =
      obj.status ??
      obj.Status ??
      obj.state ??
      obj.State ??
      obj["Payment Status"] ??
      obj["Order Status"] ??
      obj["Status"];
    if (direct !== undefined && direct !== null && direct !== "")
      return String(direct).toLowerCase().trim();
    for (const key in obj) {
      const k = key.toLowerCase();
      if (
        k.includes("status") ||
        k.includes("state") ||
        (k.includes("payment") && (k.includes("status") || k.includes("state")))
      ) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "")
          return String(v).toLowerCase().trim();
      }
    }
    return "";
  };

  const isCapturedStatus = (status: string): boolean => {
    if (!status) return true;
    return CAPTURED_ORDER_STATUSES.some(
      (s) => status === s || status.includes(s)
    );
  };

  const getOrderTotal = (obj: any): number => {
    const fallbacks = [
      "total",
      "Total",
      "amount",
      "Amount",
      "Total Amount",
      "Order Total",
      "order_total",
      "total_amount",
      "Grand Total",
      "grand_total",
      "revenue",
      "Revenue",
      "value",
      "Value",
    ];
    if (totalField) {
      const v = getVal(obj, totalField, fallbacks);
      if (v !== undefined && v !== null && v !== "") return parseTotal(v);
    }
    for (const key of fallbacks) {
      const v = obj[key];
      if (v !== undefined && v !== null && v !== "") return parseTotal(v);
    }
    for (const key in obj) {
      const k = key.toLowerCase();
      if (
        k.includes("total") ||
        k.includes("amount") ||
        (k.includes("sum") && !k.includes("item"))
      ) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "") {
          const n = parseTotal(v);
          if (n > 0) return n;
        }
      }
    }
    return 0;
  };

  const getOrderDate = (obj: any): Date | null => {
    const fallbacks = [
      "date",
      "Date",
      "order_date",
      "sale_date",
      "created_at",
      "Order Date",
      "order_date",
      "Created At",
      "created_at",
    ];
    let dateStr: any = null;
    if (dateField) {
      dateStr = getVal(obj, dateField, fallbacks);
    }
    if (dateStr == null)
      dateStr =
        obj.date ??
        obj.Date ??
        obj.order_date ??
        obj.sale_date ??
        obj.created_at ??
        obj["Order Date"] ??
        obj["Created At"];
    if (dateStr == null) {
      for (const key in obj) {
        if (
          key.toLowerCase().includes("date") ||
          key.toLowerCase().includes("time")
        ) {
          const v = obj[key];
          if (v !== undefined && v !== null && v !== "") {
            const d = parseDate(v);
            if (d) return d;
          }
        }
      }
      return null;
    }
    return parseDate(dateStr);
  };

  const byPeriodCaptured: Record<string, { sum: number; count: number }> = {};
  const byPeriodAll: Record<string, { sum: number; count: number }> = {};
  let capturedSum = 0;
  let capturedCount = 0;
  let anyInRangeSum = 0;
  let anyInRangeCount = 0;

  for (const o of orders) {
    const date = getOrderDate(o);
    if (!date || Number.isNaN(date.getTime())) continue;
    if (date < fromObj || date > toObj) continue;

    const total = getOrderTotal(o);
    // Use UTC year/month so server timezone doesn't shift Feb/Mar into Jan/Dec
    const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    anyInRangeSum += total;
    anyInRangeCount += 1;
    if (!byPeriodAll[period]) byPeriodAll[period] = { sum: 0, count: 0 };
    byPeriodAll[period].sum += total;
    byPeriodAll[period].count += 1;

    const status = getOrderStatus(o);
    const includeAsCaptured = isCapturedStatus(status);
    if (includeAsCaptured) {
      capturedSum += total;
      capturedCount += 1;
      if (!byPeriodCaptured[period])
        byPeriodCaptured[period] = { sum: 0, count: 0 };
      byPeriodCaptured[period].sum += total;
      byPeriodCaptured[period].count += 1;
    }
  }

  const currentValue =
    capturedCount > 0
      ? capturedSum / capturedCount
      : anyInRangeCount > 0
        ? anyInRangeSum / anyInRangeCount
        : 0;

  const byPeriod =
    Object.keys(byPeriodCaptured).length > 0 ? byPeriodCaptured : byPeriodAll;

  const historicalData = Object.entries(byPeriod)
    .map(([period, { sum, count }]) => ({
      period,
      value: count > 0 ? parseFloat((sum / count).toFixed(2)) : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: parseFloat(currentValue.toFixed(2)),
    historicalData,
  };
}
