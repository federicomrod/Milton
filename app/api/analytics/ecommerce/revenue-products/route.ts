// GET /api/analytics/ecommerce/revenue-products?from_date=...&to_date=...&period=month|year|ytd|custom
// Returns revenue trends, category breakdown, top/bottom products, order metrics.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEcomModelData } from "@/lib/kpi-calculations/ecomDataLoader";
import {
  ecomOrderAcc,
  ecomOrderItemAcc,
  ecomProductAcc,
  toPeriod,
} from "@/lib/kpi-calculations/ecomFieldAccessors";

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
        topProducts: [],
        bottomProducts: [],
        orderCount: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
      });
    }

    const period = req.nextUrl.searchParams.get("period") || "month";
    const fromDateParam = req.nextUrl.searchParams.get("from_date");
    const toDateParam = req.nextUrl.searchParams.get("to_date");

    let fromDate: Date;
    let toDate: Date;

    if (fromDateParam && toDateParam) {
      fromDate = new Date(fromDateParam + "T00:00:00");
      toDate = new Date(toDateParam + "T23:59:59");
    } else {
      toDate = new Date();
      fromDate = new Date();
      if (period === "year") {
        fromDate = new Date(new Date().getFullYear() - 1, 0, 1);
        toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59);
      } else if (period === "ytd") {
        fromDate = new Date(new Date().getFullYear(), 0, 1);
      } else {
        fromDate.setMonth(fromDate.getMonth() - 1);
      }
    }

    const fromObj = new Date(fromDate);
    fromObj.setHours(0, 0, 0, 0);
    const toObj = new Date(toDate);
    toObj.setHours(23, 59, 59, 999);

    const data = await getEcomModelData(supabase, company.id);

    const productIdToProduct = new Map<string, any>();
    for (const p of data.products) {
      productIdToProduct.set(String(ecomProductAcc.id(p)).toLowerCase(), p);
    }

    const orderIdToOrder = new Map<string, any>();
    const ordersInRange: any[] = [];
    const salesByDate = new Map<string, number>();
    const ordersByDate = new Map<string, number>();
    let totalRevenue = 0;

    for (const o of data.orders) {
      const date = ecomOrderAcc.orderDate(o);
      if (!date || date < fromObj || date > toObj) continue;
      const rev = ecomOrderAcc.totalRevenue(o);
      orderIdToOrder.set(ecomOrderAcc.id(o), o);
      ordersInRange.push(o);
      totalRevenue += rev;
      const dateStr = date.toISOString().split("T")[0];
      salesByDate.set(dateStr, (salesByDate.get(dateStr) ?? 0) + rev);
      ordersByDate.set(dateStr, (ordersByDate.get(dateStr) ?? 0) + 1);
    }

    const salesTrends = Array.from(salesByDate.entries())
      .map(([date, revenue]) => ({
        date,
        revenue: parseFloat(revenue.toFixed(2)),
        orders: ordersByDate.get(date) ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const revenueByCategory = new Map<string, number>();
    const productIdToRevenue = new Map<string, number>();
    const productIdToCost = new Map<string, number>();
    const productIdToQuantity = new Map<string, number>();

    for (const item of data.orderItems) {
      const orderId = ecomOrderItemAcc.orderId(item);
      if (!orderIdToOrder.has(orderId)) continue;
      const qty = ecomOrderItemAcc.quantity(item);
      const price = ecomOrderItemAcc.price(item);
      const cost = ecomOrderItemAcc.cost(item);
      const lineRevenue = qty * price;
      const lineCost = qty * cost;
      const productId = String(ecomOrderItemAcc.productId(item)).toLowerCase();
      const product = productIdToProduct.get(productId);
      const category = product ? ecomProductAcc.category(product) : "Other";
      const productName = product
        ? ecomProductAcc.name(product)
        : productId
          ? `Product ${productId}`
          : "Unknown";

      revenueByCategory.set(
        category,
        (revenueByCategory.get(category) ?? 0) + lineRevenue
      );
      const key = productId || productName;
      productIdToRevenue.set(
        key,
        (productIdToRevenue.get(key) ?? 0) + lineRevenue
      );
      productIdToCost.set(key, (productIdToCost.get(key) ?? 0) + lineCost);
      productIdToQuantity.set(key, (productIdToQuantity.get(key) ?? 0) + qty);
    }

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

    const productEntries: {
      name: string;
      revenue: number;
      quantity: number;
      cost: number;
      margin: number | null;
      marginPercent: number | null;
      revenueShare: number;
    }[] = [];

    const productIdToName = new Map<string, string>();
    for (const p of data.products) {
      productIdToName.set(
        String(ecomProductAcc.id(p)).toLowerCase(),
        ecomProductAcc.name(p)
      );
    }

    for (const [key, revenue] of productIdToRevenue.entries()) {
      const cost = productIdToCost.get(key) ?? 0;
      const quantity = productIdToQuantity.get(key) ?? 0;
      const matchedProduct = data.products.find(
        (p) => String(ecomProductAcc.id(p)).toLowerCase() === key
      );
      const name =
        productIdToName.get(key) ??
        (matchedProduct ? ecomProductAcc.name(matchedProduct) : key);
      const margin = revenue > 0 ? revenue - cost : null;
      const marginPercent =
        revenue > 0 && margin !== null
          ? parseFloat(((margin / revenue) * 100).toFixed(2))
          : null;
      productEntries.push({
        name,
        revenue: parseFloat(revenue.toFixed(2)),
        quantity,
        cost: parseFloat(cost.toFixed(2)),
        margin,
        marginPercent,
        revenueShare:
          totalRevenue > 0
            ? parseFloat(((revenue / totalRevenue) * 100).toFixed(2))
            : 0,
      });
    }

    productEntries.sort((a, b) => b.revenue - a.revenue);
    const topProducts = productEntries.slice(0, 10);
    const bottomProducts = productEntries
      .filter((p) => p.revenue > 0)
      .slice(-10)
      .reverse();

    const orderCount = ordersInRange.length;
    const averageOrderValue =
      orderCount > 0 ? parseFloat((totalRevenue / orderCount).toFixed(2)) : 0;

    return jsonNoStore({
      salesTrends,
      categoryBreakdown,
      topProducts,
      bottomProducts,
      orderCount,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      averageOrderValue,
    });
  } catch (err) {
    console.error("[ecommerce/revenue-products] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch revenue & products data",
        salesTrends: [],
        categoryBreakdown: [],
        topProducts: [],
        bottomProducts: [],
        orderCount: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
      },
      { status: 500 }
    );
  }
}
