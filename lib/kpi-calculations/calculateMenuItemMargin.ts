import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Menu Item Margin = Weighted average gross margin % across all items sold.
 * Formula: (Total_Sales - Cost) / Total_Sales × 100
 * Requires: Order Items (quantity, price/revenue, item link) + Menu Items (COGS/cost).
 */
export async function calculateMenuItemMargin(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  currentValue: number;
  historicalData: { period: string; value: number }[];
}> {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    return { currentValue: 0, historicalData: [] };
  }

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
      return Number.isNaN(p.getTime()) ? null : p;
    }
    if (typeof dateStr === "string") {
      const s = dateStr.trim();
      // YYYY-MM-DD HH:mm:ss
      if (s.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/))
        return new Date(s.replace(" ", "T"));
      // YYYY-MM-DD HH:mm
      if (s.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/))
        return new Date(s.replace(" ", "T") + ":00");
      // YYYY-MM-DD
      if (s.match(/^\d{4}-\d{2}-\d{2}/))
        return new Date(s.substring(0, 10) + "T00:00:00");
      const p = new Date(s);
      if (!Number.isNaN(p.getTime())) return p;
    }
    const p = new Date(dateStr);
    return Number.isNaN(p.getTime()) ? null : p;
  };

  const ordersData = allModelData.filter((row) => {
    const n = idToNameMap[row.model_table_id] || "";
    return (
      n === "orders" ||
      (n.includes("order") && !n.includes("item")) ||
      n.includes("sale")
    );
  });
  const orderItemsData = allModelData.filter((row) => {
    const n = idToNameMap[row.model_table_id] || "";
    return (
      n === "order items" ||
      n.includes("order item") ||
      (n.includes("order") && n.includes("item"))
    );
  });
  const menuItemsData = allModelData.filter((row) => {
    const n = idToNameMap[row.model_table_id] || "";
    return (
      n === "menu items" ||
      n.includes("menu item") ||
      (n.includes("menu") && !n.includes("order"))
    );
  });

  const orders: any[] = [];
  for (const row of ordersData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orders.push(...d);
    else if (d && typeof d === "object") orders.push(d);
  }
  const orderItems: any[] = [];
  for (const row of orderItemsData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) orderItems.push(...d);
    else if (d && typeof d === "object") orderItems.push(d);
  }
  const menuItems: any[] = [];
  for (const row of menuItemsData) {
    const d = row.data as unknown;
    if (Array.isArray(d)) menuItems.push(...d);
    else if (d && typeof d === "object") menuItems.push(d);
  }

  const ordersTableId =
    Object.keys(idToNameMap).find((id) => idToNameMap[id] === "orders") ??
    Object.keys(idToNameMap).find((id) => {
      const n = idToNameMap[id] || "";
      return (n.includes("order") && !n.includes("item")) || n.includes("sale");
    });
  const orderItemsTableId = Object.keys(idToNameMap).find(
    (id) =>
      idToNameMap[id] === "order items" ||
      idToNameMap[id]?.includes("order item") ||
      (idToNameMap[id]?.includes("order") && idToNameMap[id]?.includes("item"))
  );
  const menuItemsTableId = Object.keys(idToNameMap).find(
    (id) =>
      idToNameMap[id] === "menu items" ||
      idToNameMap[id]?.includes("menu item") ||
      (idToNameMap[id]?.includes("menu") && !idToNameMap[id]?.includes("order"))
  );

  const ordersFields = ordersTableId
    ? tableFieldsMap[ordersTableId]?.fields || []
    : [];
  const orderItemsFields = orderItemsTableId
    ? tableFieldsMap[orderItemsTableId]?.fields || []
    : [];
  const menuItemsFields = menuItemsTableId
    ? tableFieldsMap[menuItemsTableId]?.fields || []
    : [];

  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  // Build order_id -> date map
  // Orders: ID (pk), "Date & Time" per data_tables schema
  const dateField = ordersFields.find(
    (f) =>
      f.name.toLowerCase().includes("date") ||
      f.name.toLowerCase().includes("time")
  )?.name;
  const orderIdField =
    ordersFields.find(
      (f) =>
        f.name.toLowerCase().includes("order") &&
        f.name.toLowerCase().includes("id")
    )?.name || ordersFields.find((f) => f.name.toLowerCase() === "id")?.name;

  const dateFallbacks = [
    "Date & Time",
    "Date &amp; Time",
    "date",
    "Date",
    "order_date",
    "Order Date",
    "sale_date",
    "created_at",
  ];
  const orderIdToDate = new Map<string, Date>();
  const normalizeId = (v: any) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  for (const o of orders) {
    const oid = normalizeId(
      orderIdField
        ? getVal(o, orderIdField, ["order_id", "Order ID", "id", "ID"])
        : (o.order_id ?? o.id ?? o["Order ID"] ?? o["ID"] ?? "")
    );
    if (!oid) continue;
    let dateStr = dateField
      ? getVal(o, dateField, dateFallbacks)
      : (getVal(o, "", dateFallbacks) ??
        o.date ??
        o.order_date ??
        o.sale_date ??
        o.created_at ??
        o["Date & Time"]);
    if (dateStr == null) {
      for (const k of Object.keys(o)) {
        if (/date|time/i.test(k) && o[k]) {
          dateStr = o[k];
          break;
        }
      }
    }
    const date = parseDate(dateStr);
    if (date && !Number.isNaN(date.getTime())) orderIdToDate.set(oid, date);
  }

  // Build menu item lookup by item_id and by item_name
  // Menu Items: ID (pk), "Item Name", "COGS (cost of goods sold)" per data_tables schema
  const itemIdField =
    menuItemsFields.find(
      (f) =>
        f.name.toLowerCase().includes("item") &&
        f.name.toLowerCase().includes("id")
    )?.name || menuItemsFields.find((f) => f.name.toLowerCase() === "id")?.name;
  const itemNameField = menuItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("item") &&
      (f.name.toLowerCase().includes("name") || f.name.toLowerCase() === "name")
  )?.name;
  const cogsField = menuItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("cogs") ||
      f.name.toLowerCase().includes("cost")
  )?.name;

  const menuItemById = new Map<string, any>();
  const menuItemByName = new Map<string, any>();
  for (const m of menuItems) {
    const id = normalizeId(
      itemIdField
        ? getVal(m, itemIdField, ["item_id", "Item ID", "id", "ID"])
        : (m.item_id ?? m.id ?? "")
    );
    const name = String(
      itemNameField
        ? getVal(m, itemNameField, ["name", "Name", "item_name", "Item Name"])
        : (m.name ?? m.item_name ?? "")
    )
      .toLowerCase()
      .trim();
    if (id) menuItemById.set(id, m);
    if (name) menuItemByName.set(name, m);
  }

  const getCogs = (menuItem: any): number => {
    if (!menuItem) return 0;
    const raw = cogsField
      ? getVal(menuItem, cogsField, [
          "COGS (cost of goods sold)",
          "cogs",
          "COGS",
          "cost",
          "Cost",
        ])
      : (menuItem["COGS (cost of goods sold)"] ??
        menuItem.cogs ??
        menuItem.cost ??
        menuItem["COGS"] ??
        menuItem["Cost"]);
    if (raw == null) return 0;
    const n = typeof raw === "string" ? parseFloat(raw || "0") : Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  // Order Items fields: Order ID, Item ID, Quantity, Net Amount, Unit Price, Item Name per data_tables
  const oiOrderIdField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("order") &&
      f.name.toLowerCase().includes("id")
  )?.name;
  const oiItemIdField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("item") &&
      f.name.toLowerCase().includes("id")
  )?.name;
  const oiItemNameField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("item") &&
      (f.name.toLowerCase().includes("name") || f.name.toLowerCase() === "name")
  )?.name;
  const oiQtyField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("quantity") ||
      f.name.toLowerCase().includes("qty")
  )?.name;
  const oiAmountField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("net") ||
      (f.name.toLowerCase().includes("amount") &&
        !f.name.toLowerCase().includes("unit"))
  )?.name;
  const oiUnitPriceField = orderItemsFields.find(
    (f) =>
      f.name.toLowerCase().includes("unit") ||
      (f.name.toLowerCase().includes("price") &&
        !f.name.toLowerCase().includes("net"))
  )?.name;

  const byPeriod: Record<string, { sales: number; cost: number }> = {};
  let totalSales = 0;
  let totalCost = 0;
  let skippedNoOrderDate = 0;
  let skippedOutOfRange = 0;
  let skippedNoRevenue = 0;
  let skippedNoCogs = 0;
  let included = 0;

  for (const oi of orderItems) {
    const orderId = normalizeId(
      oiOrderIdField
        ? getVal(oi, oiOrderIdField, ["order_id", "Order ID"])
        : (oi.order_id ?? oi["Order ID"] ?? "")
    );
    const orderDate = orderIdToDate.get(orderId);
    if (!orderDate) {
      skippedNoOrderDate++;
      continue;
    }
    if (orderDate < fromObj || orderDate > toObj) {
      skippedOutOfRange++;
      continue;
    }

    const qtyVal = oiQtyField
      ? getVal(oi, oiQtyField, ["quantity", "Quantity", "qty", "Qty"])
      : (oi.quantity ?? oi.qty ?? oi["Quantity"] ?? oi["Qty"] ?? 1);
    const quantity =
      typeof qtyVal === "string"
        ? parseFloat(qtyVal || "1")
        : Number(qtyVal) || 1;

    const netAmountVal = oiAmountField
      ? getVal(oi, oiAmountField, [
          "net_amount",
          "Net Amount",
          "amount",
          "price",
        ])
      : (oi.net_amount ?? oi.amount ?? oi["Net Amount"] ?? oi.price ?? 0);
    const netAmount =
      typeof netAmountVal === "string"
        ? parseFloat(String(netAmountVal).replace(/[$€£,\s]/g, "") || "0")
        : Number(netAmountVal) || 0;

    const unitPriceVal = oiUnitPriceField
      ? getVal(oi, oiUnitPriceField, ["unit_price", "Unit Price", "price"])
      : (oi.unit_price ?? oi.price ?? oi["Unit Price"] ?? 0);
    const unitPrice =
      typeof unitPriceVal === "string"
        ? parseFloat(String(unitPriceVal).replace(/[$€£,\s]/g, "") || "0")
        : Number(unitPriceVal) || 0;

    const revenue = netAmount > 0 ? netAmount : unitPrice * quantity;
    if (revenue <= 0) {
      skippedNoRevenue++;
      continue;
    }

    const itemId = normalizeId(
      oiItemIdField
        ? getVal(oi, oiItemIdField, ["item_id", "Item ID"])
        : (oi.item_id ?? oi["Item ID"] ?? "")
    );
    const itemName = String(
      oiItemNameField
        ? getVal(oi, oiItemNameField, [
            "item_name",
            "Item Name",
            "name",
            "Name",
          ])
        : (oi.item_name ?? oi.name ?? "")
    )
      .toLowerCase()
      .trim();

    const menuItem =
      (itemId && menuItemById.get(itemId)) ||
      (itemName && menuItemByName.get(itemName));
    const cogsPerUnit = getCogs(menuItem);
    // Only include items where we have COGS data; otherwise margin is misleading
    if (cogsPerUnit <= 0) {
      skippedNoCogs++;
      continue;
    }

    const cost = cogsPerUnit * quantity;
    included++;

    totalSales += revenue;
    totalCost += cost;

    const period = `${orderDate.getUTCFullYear()}-${String(orderDate.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byPeriod[period]) byPeriod[period] = { sales: 0, cost: 0 };
    byPeriod[period].sales += revenue;
    byPeriod[period].cost += cost;
  }

  // (Total_Sales - Cost) / Total_Sales × 100
  const currentValue =
    totalSales > 0
      ? parseFloat((((totalSales - totalCost) / totalSales) * 100).toFixed(2))
      : 0;

  const historicalData = Object.entries(byPeriod)
    .map(([period, { sales, cost }]) => ({
      period,
      value:
        sales > 0 ? parseFloat((((sales - cost) / sales) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue,
    historicalData,
  };
}
