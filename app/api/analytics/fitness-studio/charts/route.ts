// GET /api/analytics/fitness-studio/charts?chart=member-count&from_date=...&to_date=...
// Returns chart data for fitness studio analytics
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function generateMonths(fromDate: Date, toDate: Date): string[] {
  const months: string[] = [];
  const current = new Date(fromDate);
  while (current < toDate) {
    months.push(current.toISOString().split("T")[0].substring(0, 7)); // YYYY-MM
    current.setMonth(current.getMonth() + 1);
  }
  return months;
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
      return jsonNoStore({ data: [] });
    }

    const chartType = req.nextUrl.searchParams.get("chart") || "member-count";
    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];

    const from = new Date(fromDate);
    const to = new Date(toDate);

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

    let chartData: any[] = [];

    switch (chartType) {
      case "member-count": {
        // Chart 1: Members Over Time (Active Members, monthly)
        const months = generateMonths(from, to);
        chartData = months.map((month) => {
          const monthEnd = new Date(month + "-01");
          monthEnd.setMonth(monthEnd.getMonth() + 1);
          monthEnd.setDate(0);

          const active = members.filter((m: any) => {
            const joinDate = m.join_date ? new Date(m.join_date) : null;
            const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
            if (!joinDate) return false;
            return (
              joinDate <= monthEnd && (!cancelDate || cancelDate > monthEnd)
            );
          }).length;

          return {
            period: month,
            value: active,
          };
        });
        break;
      }

      case "new-vs-churned": {
        // Chart 2: New vs Churned Members (monthly comparison)
        const months = generateMonths(from, to);
        chartData = months.map((month) => {
          const monthStart = new Date(month + "-01");
          const monthEnd = new Date(month + "-01");
          monthEnd.setMonth(monthEnd.getMonth() + 1);

          const newMembers = members.filter((m: any) => {
            const joinDate = m.join_date ? new Date(m.join_date) : null;
            if (!joinDate) return false;
            return joinDate >= monthStart && joinDate < monthEnd;
          }).length;

          const churned = members.filter((m: any) => {
            const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
            if (!cancelDate) return false;
            return cancelDate >= monthStart && cancelDate < monthEnd;
          }).length;

          return {
            period: month,
            new_members: newMembers,
            churned_members: churned,
          };
        });
        break;
      }

      case "revenue-per-member": {
        // Chart 4: Revenue per Member Trend (ARPM)
        const months = generateMonths(from, to);
        chartData = months.map((month) => {
          const monthStart = new Date(month + "-01");
          const monthEnd = new Date(month + "-01");
          monthEnd.setMonth(monthEnd.getMonth() + 1);
          const monthEndDate = new Date(monthEnd);
          monthEndDate.setDate(0);

          // Active members at end of month
          const activeMembers = members.filter((m: any) => {
            const joinDate = m.join_date ? new Date(m.join_date) : null;
            const cancelDate = m.cancel_date ? new Date(m.cancel_date) : null;
            if (!joinDate) return false;
            return (
              joinDate <= monthEndDate &&
              (!cancelDate || cancelDate > monthEndDate)
            );
          }).length;

          // Revenue in month
          const revenue = transactions
            .filter((t: any) => {
              const date = t.date ? new Date(t.date) : null;
              const amount =
                typeof t.amount === "string"
                  ? parseFloat(t.amount)
                  : t.amount || 0;
              const category = (t.category || "").toLowerCase();
              if (!date) return false;
              return (
                amount > 0 &&
                (category.includes("membership") ||
                  category.includes("drop-in") ||
                  category.includes("class pack") ||
                  category.includes("revenue")) &&
                date >= monthStart &&
                date < monthEnd
              );
            })
            .reduce((sum: number, t: any) => {
              const amount =
                typeof t.amount === "string"
                  ? parseFloat(t.amount)
                  : t.amount || 0;
              return sum + amount;
            }, 0);

          return {
            period: month,
            value:
              activeMembers > 0
                ? parseFloat((revenue / activeMembers).toFixed(2))
                : 0,
          };
        });
        break;
      }

      case "utilization-heatmap": {
        // Chart 5: Utilization Heatmap (Weekday × Hour)
        const classCapacityMap = new Map();
        classes.forEach((c: any) => {
          if (c.class_id && c.capacity) {
            classCapacityMap.set(c.class_id, c.capacity);
          }
        });

        const bookingsInRange = bookings.filter((b: any) => {
          const startAt = b.class_start_at ? new Date(b.class_start_at) : null;
          if (!startAt) return false;
          return startAt >= from && startAt < to;
        });

        // Group by weekday (1=Mon, 7=Sun) and hour
        const heatmapData: Record<
          string,
          { booked: number; capacity: number }
        > = {};

        bookingsInRange.forEach((b: any) => {
          const startAt = b.class_start_at ? new Date(b.class_start_at) : null;
          if (!startAt) return;

          // JavaScript getDay() returns 0 (Sun) to 6 (Sat)
          // SQL ISODOW returns 1 (Mon) to 7 (Sun)
          // Convert: 0 (Sun) -> 7, 1 (Mon) -> 1, ..., 6 (Sat) -> 6
          const jsDay = startAt.getDay();
          const weekday = jsDay === 0 ? 7 : jsDay;
          const hour = startAt.getHours();
          const key = `${weekday}-${hour}`;

          if (!heatmapData[key]) {
            heatmapData[key] = { booked: 0, capacity: 0 };
          }

          if (b.status === "booked" || b.status === "attended") {
            heatmapData[key].booked += 1;
          }

          const capacity = classCapacityMap.get(b.class_id) || 0;
          heatmapData[key].capacity += capacity;
        });

        chartData = Object.entries(heatmapData).map(([key, value]) => {
          const [weekday, hour] = key.split("-").map(Number);
          const utilization =
            value.capacity > 0
              ? parseFloat(((value.booked / value.capacity) * 100).toFixed(2))
              : 0;
          return {
            weekday_iso: weekday,
            hour_of_day: hour,
            utilization,
          };
        });
        break;
      }

      default:
        chartData = [];
    }

    return jsonNoStore({ data: chartData });
  } catch (err) {
    console.error(
      "[api/analytics/fitness-studio/charts] Unexpected error:",
      err
    );
    return jsonNoStore({ data: [] });
  }
}
