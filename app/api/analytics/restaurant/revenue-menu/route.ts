// GET /api/analytics/restaurant/revenue-menu?from_date=...&to_date=...&period=month|week
// Returns Revenue & Menu Performance analytics
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
        salesTrends: [],
        categoryBreakdown: [],
        channelBreakdown: [],
        topItems: [],
        bottomItems: [],
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
          "[restaurant-revenue-menu] Error fetching model_data:",
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
    const ordersData = allModelData.filter((row) => {
      const tableName = idToNameMap[row.model_table_id] || "";
      return (
        tableName === "orders" ||
        tableName.includes("order") ||
        tableName.includes("sale")
      );
    });
    const orderItemsData = allModelData.filter((row) => {
      const tableName = idToNameMap[row.model_table_id] || "";
      return (
        tableName === "order items" ||
        tableName.includes("order item") ||
        (tableName.includes("order") && tableName.includes("item"))
      );
    });
    const menuItemsData = allModelData.filter((row) => {
      const tableName = idToNameMap[row.model_table_id] || "";
      return (
        tableName === "menu items" ||
        tableName.includes("menu item") ||
        (tableName.includes("menu") && !tableName.includes("order"))
      );
    });

    // Parse data
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

    const orderItems: any[] = [];
    if (orderItemsData) {
      for (const row of orderItemsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          orderItems.push(...d);
        } else if (d && typeof d === "object") {
          orderItems.push(d);
        }
      }
    }

    const menuItems: any[] = [];
    if (menuItemsData) {
      for (const row of menuItemsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          menuItems.push(...d);
        } else if (d && typeof d === "object") {
          menuItems.push(d);
        }
      }
    }

    // Get field names from data_tables definitions
    const ordersTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id] === "orders" ||
        idToNameMap[id]?.includes("order") ||
        idToNameMap[id]?.includes("sale")
    );
    const orderItemsTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id] === "order items" ||
        idToNameMap[id]?.includes("order item") ||
        (idToNameMap[id]?.includes("order") &&
          idToNameMap[id]?.includes("item"))
    );
    const menuItemsTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id] === "menu items" ||
        idToNameMap[id]?.includes("menu item") ||
        (idToNameMap[id]?.includes("menu") &&
          !idToNameMap[id]?.includes("order"))
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
        // Handle YYYY-MM-DD HH:MM format (from test data)
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)) {
          return new Date(dateStr.replace(" ", "T") + ":00");
        }
        // Handle YYYY-MM-DD format
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
      // Try standard Date parsing
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const normalizeOrder = (o: any) => {
      const orderIdField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("order") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const order_id = orderIdField
        ? getFieldValue(o, orderIdField, ["order_id", "Order ID", "id", "ID"])
        : o.order_id || o.orderId || o.id || o["Order ID"] || o.ID;

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
            "Date & Time",
          ])
        : o.date ||
          o.order_date ||
          o.sale_date ||
          o.created_at ||
          o["Date"] ||
          o["Order Date"] ||
          o["Date & Time"] ||
          o["Date &amp; Time"];

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
            "Total Amount",
          ])
        : o.total ||
          o.amount ||
          o.revenue ||
          o["Total"] ||
          o["Amount"] ||
          o["Total Amount"];
      const total =
        typeof totalRaw === "string"
          ? parseFloat(totalRaw || "0")
          : totalRaw || 0;

      const channelField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("channel") ||
          f.name.toLowerCase().includes("type")
      )?.name;
      const channel = channelField
        ? getFieldValue(o, channelField, [
            "channel",
            "Channel",
            "order_type",
            "Order Type",
            "type",
            "Channel (Dine-in, Takeaway, etc.)",
          ]) || "dine-in"
        : o.channel ||
          o.order_type ||
          o.type ||
          o["Channel"] ||
          o["Order Type"] ||
          o["Channel (Dine-in, Takeaway, etc.)"] ||
          "dine-in";

      const categoryField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("category") ||
          f.name.toLowerCase().includes("menu_category")
      )?.name;
      const category = categoryField
        ? getFieldValue(o, categoryField, [
            "category",
            "Category",
            "menu_category",
            "Menu Category",
          ]) || "Other"
        : o.category ||
          o.menu_category ||
          o["Category"] ||
          o["Menu Category"] ||
          "Other";

      return {
        order_id,
        date,
        total,
        channel,
        category,
      };
    };

    // Filter orders by date range
    const ordersInRange = orders.map(normalizeOrder).filter((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return false;
      return orderDate >= fromDateStart && orderDate <= toDateEnd;
    });

    const totalRevenue = ordersInRange.reduce((sum, o) => sum + o.total, 0);

    // Sales Trends (daily breakdown)
    const salesByDate = new Map<string, number>();
    ordersInRange.forEach((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return;
      const dateKey = orderDate.toISOString().split("T")[0];
      salesByDate.set(dateKey, (salesByDate.get(dateKey) || 0) + o.total);
    });

    const salesTrends = Array.from(salesByDate.entries())
      .map(([date, revenue]) => ({
        date,
        revenue: parseFloat(revenue.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Category Breakdown
    const revenueByCategory = new Map<string, number>();
    ordersInRange.forEach((o) => {
      const category = o.category || "Other";
      revenueByCategory.set(
        category,
        (revenueByCategory.get(category) || 0) + o.total
      );
    });

    const categoryBreakdown = Array.from(revenueByCategory.entries())
      .map(([category, revenue]) => ({
        category,
        revenue: parseFloat(revenue.toFixed(2)),
        percentage:
          totalRevenue > 0
            ? parseFloat(((revenue / totalRevenue) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Channel Breakdown (dine-in vs takeaway)
    const revenueByChannel = new Map<string, number>();
    ordersInRange.forEach((o) => {
      const channel = (o.channel || "dine-in").toLowerCase();
      // Normalize channel names
      const normalizedChannel =
        channel.includes("takeaway") ||
        channel.includes("take-out") ||
        channel.includes("delivery") ||
        channel.includes("to-go")
          ? "takeaway"
          : "dine-in";
      revenueByChannel.set(
        normalizedChannel,
        (revenueByChannel.get(normalizedChannel) || 0) + o.total
      );
    });

    const channelBreakdown = Array.from(revenueByChannel.entries())
      .map(([channel, revenue]) => ({
        channel,
        revenue: parseFloat(revenue.toFixed(2)),
        percentage:
          totalRevenue > 0
            ? parseFloat(((revenue / totalRevenue) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Menu Item Performance
    // Link Order Items to Orders by Order ID - use actual field names from data_tables
    const normalizeOrderItem = (oi: any) => {
      const orderIdField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("order") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const order_id = orderIdField
        ? getFieldValue(oi, orderIdField, ["order_id", "Order ID", "id", "ID"])
        : oi.order_id || oi.orderId || oi["Order ID"] || oi.ID;

      const itemIdField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("item") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const item_id = itemIdField
        ? getFieldValue(oi, itemIdField, ["item_id", "Item ID"]) || ""
        : oi.item_id || oi.itemId || oi["Item ID"] || "";

      const itemNameField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("item") &&
          (f.name.toLowerCase().includes("name") ||
            f.name.toLowerCase() === "name")
      )?.name;
      const item_name = itemNameField
        ? getFieldValue(oi, itemNameField, [
            "item_name",
            "Item Name",
            "name",
            "Name",
          ]) || "Unknown"
        : oi.item_name ||
          oi.itemName ||
          oi["Item Name"] ||
          oi.name ||
          oi.Name ||
          "Unknown";

      const quantityField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("quantity") ||
          f.name.toLowerCase().includes("qty")
      )?.name;
      const quantityRaw = quantityField
        ? getFieldValue(oi, quantityField, [
            "quantity",
            "Quantity",
            "qty",
            "Qty",
          ])
        : oi.quantity || oi.qty || oi["Quantity"] || oi["Qty"];
      const quantity =
        typeof quantityRaw === "string"
          ? parseFloat(quantityRaw || "1")
          : quantityRaw || 1;

      const netAmountField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("net") ||
          f.name.toLowerCase().includes("amount") ||
          f.name.toLowerCase().includes("price")
      )?.name;
      const netAmountRaw = netAmountField
        ? getFieldValue(oi, netAmountField, [
            "net_amount",
            "Net Amount",
            "amount",
            "price",
            "Unit Price",
          ])
        : oi.net_amount ||
          oi.amount ||
          oi["Net Amount"] ||
          oi.price ||
          oi["Unit Price"];
      const net_amount =
        typeof netAmountRaw === "string"
          ? parseFloat(netAmountRaw || "0")
          : netAmountRaw || 0;

      const unitPriceField = orderItemsFields.find(
        (f) =>
          f.name.toLowerCase().includes("unit") ||
          (f.name.toLowerCase().includes("price") &&
            !f.name.toLowerCase().includes("net"))
      )?.name;
      const unitPriceRaw = unitPriceField
        ? getFieldValue(oi, unitPriceField, [
            "unit_price",
            "Unit Price",
            "price",
          ])
        : oi.unit_price || oi["Unit Price"] || oi.price;
      const unit_price =
        typeof unitPriceRaw === "string"
          ? parseFloat(unitPriceRaw || "0")
          : unitPriceRaw || 0;

      return {
        order_id,
        item_id,
        item_name,
        quantity,
        net_amount,
        unit_price,
      };
    };

    // Create a map of order IDs from orders in range (normalize to strings for comparison)
    const orderIdsInRange = new Set(
      ordersInRange.map((o) => String(o.order_id || ""))
    );

    // Filter order items that belong to orders in range
    const orderItemsInRange = orderItems
      .map(normalizeOrderItem)
      .filter((oi) => {
        const oiOrderId = String(oi.order_id || "");
        return orderIdsInRange.has(oiOrderId);
      });

    // Aggregate menu item performance
    const itemRevenue = new Map<
      string,
      { revenue: number; quantity: number; name: string }
    >();

    orderItemsInRange.forEach((oi) => {
      const itemName = oi.item_name;
      // Use net_amount if available, otherwise calculate from unit_price * quantity
      const itemRevenueAmount =
        oi.net_amount > 0 ? oi.net_amount : oi.unit_price * oi.quantity;

      const current = itemRevenue.get(itemName) || {
        revenue: 0,
        quantity: 0,
        name: itemName,
      };
      itemRevenue.set(itemName, {
        revenue: current.revenue + itemRevenueAmount,
        quantity: current.quantity + oi.quantity,
        name: itemName,
      });
    });

    // Also check menu items table for COGS/margin data - use actual field names from data_tables
    const menuItemMap = new Map<string, any>();
    const menuItemNameField = menuItemsFields.find(
      (f) =>
        f.name.toLowerCase().includes("item") &&
        (f.name.toLowerCase().includes("name") ||
          f.name.toLowerCase() === "name")
    )?.name;
    menuItems.forEach((item: any) => {
      const itemName = menuItemNameField
        ? getFieldValue(item, menuItemNameField, [
            "name",
            "Name",
            "item_name",
            "Item Name",
            "menu_item",
          ]) || ""
        : item.name ||
          item.item_name ||
          item.menu_item ||
          item["Item Name"] ||
          item["Name"] ||
          "";
      if (itemName) {
        menuItemMap.set(itemName.toLowerCase(), item);
      }
    });

    const cogsField = menuItemsFields.find(
      (f) =>
        f.name.toLowerCase().includes("cogs") ||
        f.name.toLowerCase().includes("cost")
    )?.name;

    const topItems = Array.from(itemRevenue.values())
      .map((item) => {
        const menuItem = menuItemMap.get(item.name.toLowerCase());
        const cogsRaw =
          cogsField && menuItem
            ? getFieldValue(menuItem, cogsField, [
                "cogs",
                "COGS",
                "cost",
                "Cost",
              ])
            : menuItem?.cogs ||
              menuItem?.cost ||
              menuItem?.["COGS"] ||
              menuItem?.["Cost"];
        const cogs =
          typeof cogsRaw === "string"
            ? parseFloat(cogsRaw || "0")
            : cogsRaw || 0;
        const margin =
          item.revenue > 0 && cogs > 0
            ? item.revenue - cogs * item.quantity
            : null;
        const marginPercent =
          item.revenue > 0 && margin !== null
            ? (margin / item.revenue) * 100
            : null;

        return {
          name: item.name,
          revenue: parseFloat(item.revenue.toFixed(2)),
          quantity: Math.round(item.quantity),
          revenueShare:
            totalRevenue > 0
              ? parseFloat(((item.revenue / totalRevenue) * 100).toFixed(2))
              : 0,
          margin: margin !== null ? parseFloat(margin.toFixed(2)) : null,
          marginPercent:
            marginPercent !== null
              ? parseFloat(marginPercent.toFixed(2))
              : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const bottomItems = Array.from(itemRevenue.values())
      .map((item) => {
        const menuItem = menuItemMap.get(item.name.toLowerCase());
        const cogsRaw =
          cogsField && menuItem
            ? getFieldValue(menuItem, cogsField, [
                "cogs",
                "COGS",
                "cost",
                "Cost",
              ])
            : menuItem?.cogs ||
              menuItem?.cost ||
              menuItem?.["COGS"] ||
              menuItem?.["Cost"];
        const cogs =
          typeof cogsRaw === "string"
            ? parseFloat(cogsRaw || "0")
            : cogsRaw || 0;
        const margin =
          item.revenue > 0 && cogs > 0
            ? item.revenue - cogs * item.quantity
            : null;
        const marginPercent =
          item.revenue > 0 && margin !== null
            ? (margin / item.revenue) * 100
            : null;

        return {
          name: item.name,
          revenue: parseFloat(item.revenue.toFixed(2)),
          quantity: Math.round(item.quantity),
          revenueShare:
            totalRevenue > 0
              ? parseFloat(((item.revenue / totalRevenue) * 100).toFixed(2))
              : 0,
          margin: margin !== null ? parseFloat(margin.toFixed(2)) : null,
          marginPercent:
            marginPercent !== null
              ? parseFloat(marginPercent.toFixed(2))
              : null,
        };
      })
      .sort((a, b) => a.revenue - b.revenue)
      .slice(0, 10);

    return jsonNoStore({
      salesTrends,
      categoryBreakdown,
      channelBreakdown,
      topItems,
      bottomItems,
    });
  } catch (err) {
    console.error(
      "[api/analytics/restaurant/revenue-menu] Unexpected error:",
      err
    );
    return jsonNoStore({
      salesTrends: [],
      categoryBreakdown: [],
      channelBreakdown: [],
      topItems: [],
      bottomItems: [],
    });
  }
}
