// GET /api/analytics/ecommerce/products?from_date=...&to_date=...
// Returns product profitability leaderboard.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEcomModelData } from "@/lib/kpi-calculations/ecomDataLoader";
import {
  ecomOrderAcc,
  ecomOrderItemAcc,
  ecomProductAcc,
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
        productLeaderboard: [],
        categoryMargins: [],
      });
    }

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
      fromDate.setMonth(fromDate.getMonth() - 1);
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

    const orderIdsInRange = new Set<string>();
    for (const o of data.orders) {
      const date = ecomOrderAcc.orderDate(o);
      if (!date || date < fromObj || date > toObj) continue;
      orderIdsInRange.add(ecomOrderAcc.id(o));
    }

    const productStats = new Map<
      string,
      { name: string; category: string; revenue: number; cost: number }
    >();

    for (const item of data.orderItems) {
      if (!orderIdsInRange.has(ecomOrderItemAcc.orderId(item))) continue;
      const productId = String(ecomOrderItemAcc.productId(item)).toLowerCase();
      const qty = ecomOrderItemAcc.quantity(item);
      const price = ecomOrderItemAcc.price(item);
      const cost = ecomOrderItemAcc.cost(item);
      const lineRevenue = qty * price;
      const lineCost = qty * cost;
      const product = productIdToProduct.get(productId);
      const name = product
        ? ecomProductAcc.name(product)
        : `Product ${productId}`;
      const category = product ? ecomProductAcc.category(product) : "Other";

      const key = productId || name;
      const existing = productStats.get(key);
      if (existing) {
        existing.revenue += lineRevenue;
        existing.cost += lineCost;
      } else {
        productStats.set(key, {
          name,
          category,
          revenue: lineRevenue,
          cost: lineCost,
        });
      }
    }

    const productLeaderboard = Array.from(productStats.entries())
      .map(([, stats]) => {
        const margin = stats.revenue - stats.cost;
        const marginPercent =
          stats.revenue > 0
            ? parseFloat(((margin / stats.revenue) * 100).toFixed(2))
            : 0;
        return {
          name: stats.name,
          category: stats.category,
          revenue: parseFloat(stats.revenue.toFixed(2)),
          cost: parseFloat(stats.cost.toFixed(2)),
          margin: parseFloat(margin.toFixed(2)),
          marginPercent,
        };
      })
      .sort((a, b) => b.marginPercent - a.marginPercent);

    const categoryMarginMap = new Map<
      string,
      { revenue: number; cost: number }
    >();
    for (const p of productLeaderboard) {
      const existing = categoryMarginMap.get(p.category) ?? {
        revenue: 0,
        cost: 0,
      };
      existing.revenue += p.revenue;
      existing.cost += p.cost;
      categoryMarginMap.set(p.category, existing);
    }

    const categoryMargins = Array.from(categoryMarginMap.entries())
      .map(([category, { revenue, cost }]) => {
        const margin = revenue - cost;
        const marginPercent =
          revenue > 0 ? parseFloat(((margin / revenue) * 100).toFixed(2)) : 0;
        return {
          category,
          revenue: parseFloat(revenue.toFixed(2)),
          cost: parseFloat(cost.toFixed(2)),
          margin: parseFloat(margin.toFixed(2)),
          marginPercent,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return jsonNoStore({
      productLeaderboard,
      categoryMargins,
    });
  } catch (err) {
    console.error("[ecommerce/products] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch product performance data",
        productLeaderboard: [],
        categoryMargins: [],
      },
      { status: 500 }
    );
  }
}
