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

    // Get table IDs and convert to names
    const tableIds = [
      ...new Set(allModelData.map((row) => row.model_table_id)),
    ];
    const idToNameMap: Record<string, string> = {};

    if (tableIds.length > 0) {
      const { data: tableDefinitions, error: tableError } = await supabase
        .from("data_tables")
        .select("id, name")
        .in("id", tableIds);

      if (!tableError && tableDefinitions) {
        tableDefinitions.forEach((table) => {
          idToNameMap[table.id] = table.name.toLowerCase();
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

    // Helper functions
    const parseDate = (dateStr: string | null | undefined): Date | null => {
      if (!dateStr) return null;

      // Handle YYYY-MM-DD HH:MM format (from test data)
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)) {
        return new Date(dateStr.replace(" ", "T") + ":00");
      }

      // Handle YYYY-MM-DD format
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        return new Date(dateStr + "T00:00:00");
      }

      // Try standard Date parsing
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const normalizeOrder = (o: any) => {
      return {
        order_id: o.order_id || o.orderId || o.id || o["Order ID"] || o.ID,
        date:
          o.date ||
          o.order_date ||
          o.sale_date ||
          o.created_at ||
          o["Date"] ||
          o["Order Date"] ||
          o["Date & Time"] ||
          o["Date &amp; Time"],
        total:
          typeof (
            o.total ||
            o.amount ||
            o.revenue ||
            o["Total"] ||
            o["Amount"] ||
            o["Total Amount"]
          ) === "string"
            ? parseFloat(
                o.total ||
                  o.amount ||
                  o.revenue ||
                  o["Total"] ||
                  o["Amount"] ||
                  o["Total Amount"] ||
                  "0"
              )
            : o.total ||
              o.amount ||
              o.revenue ||
              o["Total"] ||
              o["Amount"] ||
              o["Total Amount"] ||
              0,
        channel:
          o.channel ||
          o.order_type ||
          o.type ||
          o["Channel"] ||
          o["Order Type"] ||
          o["Channel (Dine-in, Takeaway, etc.)"] ||
          "dine-in",
        category:
          o.category ||
          o.menu_category ||
          o["Category"] ||
          o["Menu Category"] ||
          "Other",
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
    // Link Order Items to Orders by Order ID
    const normalizeOrderItem = (oi: any) => {
      return {
        order_id: oi.order_id || oi.orderId || oi["Order ID"] || oi.ID,
        item_id: oi.item_id || oi.itemId || oi["Item ID"] || "",
        item_name:
          oi.item_name ||
          oi.itemName ||
          oi["Item Name"] ||
          oi.name ||
          oi.Name ||
          "Unknown",
        quantity:
          typeof (oi.quantity || oi.qty || oi["Quantity"] || oi["Qty"]) ===
          "string"
            ? parseFloat(
                oi.quantity || oi.qty || oi["Quantity"] || oi["Qty"] || "1"
              )
            : oi.quantity || oi.qty || oi["Quantity"] || oi["Qty"] || 1,
        net_amount:
          typeof (
            oi.net_amount ||
            oi.amount ||
            oi["Net Amount"] ||
            oi.price ||
            oi["Unit Price"]
          ) === "string"
            ? parseFloat(
                oi.net_amount ||
                  oi.amount ||
                  oi["Net Amount"] ||
                  oi.price ||
                  oi["Unit Price"] ||
                  "0"
              )
            : oi.net_amount ||
              oi.amount ||
              oi["Net Amount"] ||
              oi.price ||
              oi["Unit Price"] ||
              0,
        unit_price:
          typeof (oi.unit_price || oi["Unit Price"] || oi.price) === "string"
            ? parseFloat(oi.unit_price || oi["Unit Price"] || oi.price || "0")
            : oi.unit_price || oi["Unit Price"] || oi.price || 0,
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

    // Also check menu items table for COGS/margin data
    const menuItemMap = new Map<string, any>();
    menuItems.forEach((item: any) => {
      const itemName =
        item.name ||
        item.item_name ||
        item.menu_item ||
        item["Item Name"] ||
        item["Name"] ||
        "";
      if (itemName) {
        menuItemMap.set(itemName.toLowerCase(), item);
      }
    });

    const topItems = Array.from(itemRevenue.values())
      .map((item) => {
        const menuItem = menuItemMap.get(item.name.toLowerCase());
        const cogs =
          typeof (
            menuItem?.cogs ||
            menuItem?.cost ||
            menuItem?.["COGS"] ||
            menuItem?.["Cost"]
          ) === "string"
            ? parseFloat(
                menuItem?.cogs ||
                  menuItem?.cost ||
                  menuItem?.["COGS"] ||
                  menuItem?.["Cost"] ||
                  "0"
              )
            : menuItem?.cogs ||
              menuItem?.cost ||
              menuItem?.["COGS"] ||
              menuItem?.["Cost"] ||
              0;
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
        const cogs =
          typeof (
            menuItem?.cogs ||
            menuItem?.cost ||
            menuItem?.["COGS"] ||
            menuItem?.["Cost"]
          ) === "string"
            ? parseFloat(
                menuItem?.cogs ||
                  menuItem?.cost ||
                  menuItem?.["COGS"] ||
                  menuItem?.["Cost"] ||
                  "0"
              )
            : menuItem?.cogs ||
              menuItem?.cost ||
              menuItem?.["COGS"] ||
              menuItem?.["Cost"] ||
              0;
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
