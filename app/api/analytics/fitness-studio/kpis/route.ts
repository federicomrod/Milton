// GET /api/analytics/fitness-studio/kpis
// Returns KPI values for fitness studio performance metrics
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
      return jsonNoStore({ kpis: {} });
    }

    // Get date range from query params (default to last 6 months)
    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];

    // Fetch data from model_data
    const { data: membersData } = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .ilike("model_table_name", "members");

    const { data: bookingsData } = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .ilike("model_table_name", "bookings");

    const { data: classesData } = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .ilike("model_table_name", "classes");

    const { data: transactionsData } = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .ilike("model_table_name", "transactions");

    // Parse data
    const members: any[] = [];
    if (membersData) {
      for (const row of membersData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          members.push(...d);
        } else if (d && typeof d === "object") {
          members.push(d);
        }
      }
    }

    const bookings: any[] = [];
    if (bookingsData) {
      for (const row of bookingsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          bookings.push(...d);
        } else if (d && typeof d === "object") {
          bookings.push(d);
        }
      }
    }

    const classes: any[] = [];
    if (classesData) {
      for (const row of classesData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          classes.push(...d);
        } else if (d && typeof d === "object") {
          classes.push(d);
        }
      }
    }

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

    // Calculate KPIs using JavaScript (since we can't run raw SQL)
    // This is a simplified version - in production, you'd want to use RPC functions
    // or execute the SQL queries directly via Supabase

    // KPI 1: Active Members (End of Month) - simplified to current active
    const activeMembers = members.filter((m: any) => {
      const joinDate = m.join_date ? new Date(m.join_date) : null;
      const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    }).length;

    // KPI 2: New monthly members
    const newMembers = members.filter((m: any) => {
      const joinDate = m.join_date ? new Date(m.join_date) : null;
      if (!joinDate) return false;
      const from = new Date(fromDate);
      const to = new Date(toDate);
      return joinDate >= from && joinDate < to;
    }).length;

    // KPI 3: Churned monthly members
    const churnedMembers = members.filter((m: any) => {
      const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
      if (!cancelDate) return false;
      const from = new Date(fromDate);
      const to = new Date(toDate);
      return cancelDate >= from && cancelDate < to;
    }).length;

    // KPI 4: Monthly Churn Rate (%)
    const churnRate =
      activeMembers > 0 ? (churnedMembers / activeMembers) * 100 : 0;

    // KPI 5: Average Member Tenure (Months) - simplified
    const activeMembersWithTenure = members.filter((m: any) => {
      const joinDate = m.join_date ? new Date(m.join_date) : null;
      const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    });

    const avgTenure =
      activeMembersWithTenure.length > 0
        ? activeMembersWithTenure.reduce((sum: number, m: any) => {
            const joinDate = m.join_date ? new Date(m.join_date) : null;
            const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
            const endDate = cancelDate || new Date();
            if (!joinDate) return sum;
            const months =
              (endDate.getTime() - joinDate.getTime()) /
              (1000 * 60 * 60 * 24 * 30);
            return sum + months;
          }, 0) / activeMembersWithTenure.length
        : 0;

    // KPI 6: Revenue per Member (ARPM)
    const revenueTransactions = transactions.filter((t: any) => {
      const amount =
        typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0;
      const category = (t.category || "").toLowerCase();
      const date = t.date ? new Date(t.date) : null;
      if (!date) return false;
      const from = new Date(fromDate);
      const to = new Date(toDate);
      return (
        amount > 0 &&
        (category.includes("membership") ||
          category.includes("drop-in") ||
          category.includes("class pack") ||
          category.includes("revenue")) &&
        date >= from &&
        date < to
      );
    });

    const totalRevenue = revenueTransactions.reduce((sum: number, t: any) => {
      const amount =
        typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0;
      return sum + amount;
    }, 0);

    const revenuePerMember =
      activeMembers > 0 ? totalRevenue / activeMembers : 0;

    // KPI 7: Utilization Rate (%)
    const bookingsInRange = bookings.filter((b: any) => {
      const startAt = b.class_start_at ? new Date(b.class_start_at) : null;
      if (!startAt) return false;
      const from = new Date(fromDate);
      const to = new Date(toDate);
      return startAt >= from && startAt < to;
    });

    const bookedSpots = bookingsInRange.filter(
      (b: any) => b.status === "booked" || b.status === "attended"
    ).length;

    // Get total capacity from classes
    const classCapacityMap = new Map();
    classes.forEach((c: any) => {
      if (c.class_id && c.capacity) {
        classCapacityMap.set(c.class_id, c.capacity);
      }
    });

    const totalCapacity = bookingsInRange.reduce((sum: number, b: any) => {
      const capacity = classCapacityMap.get(b.class_id) || 0;
      return sum + capacity;
    }, 0);

    const utilizationRate =
      totalCapacity > 0 ? (bookedSpots / totalCapacity) * 100 : 0;

    // KPI 8: Cancellation Rate (%)
    const finalBookings = bookingsInRange.filter(
      (b: any) =>
        b.status === "attended" ||
        b.status === "no_show" ||
        b.status === "cancelled"
    );
    const cancelled = bookingsInRange.filter(
      (b: any) => b.status === "cancelled"
    ).length;
    const cancellationRate =
      finalBookings.length > 0 ? (cancelled / finalBookings.length) * 100 : 0;

    return jsonNoStore({
      kpis: {
        activeMembers,
        newMembers,
        churnedMembers,
        churnRate: parseFloat(churnRate.toFixed(2)),
        avgTenure: parseFloat(avgTenure.toFixed(1)),
        revenuePerMember: parseFloat(revenuePerMember.toFixed(2)),
        utilizationRate: parseFloat(utilizationRate.toFixed(2)),
        cancellationRate: parseFloat(cancellationRate.toFixed(2)),
      },
    });
  } catch (err) {
    console.error("[api/analytics/fitness-studio/kpis] Unexpected error:", err);
    return jsonNoStore({ kpis: {} });
  }
}
