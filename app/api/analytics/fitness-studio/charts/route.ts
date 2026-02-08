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

    // Fetch all model_data for the company (with pagination)
    let allModelData: { model_table_id: string; data: unknown }[] = [];
    let fromIdx = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const result = await supabase
        .from("model_data")
        .select("model_table_id, data")
        .eq("company_id", company.id)
        .range(fromIdx, fromIdx + pageSize - 1)
        .order("id", { ascending: true });

      if (result.error) {
        console.error("[charts] Error fetching model_data:", result.error);
        break;
      }

      if (result.data && result.data.length > 0) {
        allModelData = [...allModelData, ...result.data];
        fromIdx += pageSize;
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
    const membersData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "members"
    );
    const bookingsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "bookings"
    );
    const classesData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "classes"
    );
    const transactionsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "transactions"
    );

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
        // Normalize class data - handle various field name formats
        const normalizeClass = (c: any) => {
          const classId =
            c.id ||
            c.class_id ||
            c.classId ||
            c.class_ID ||
            c["Class ID"] ||
            c["classId"];
          const capacity = c.capacity || c.Capacity || 0;
          const classStartAt =
            c.class_start_at ||
            c.class_date_time ||
            c.date_time ||
            c.date ||
            c["Class Date"] ||
            c["class_start_at"];
          return { classId, capacity, classStartAt };
        };

        // Normalize booking data - handle various field name formats
        const normalizeBooking = (b: any) => {
          const classId =
            b.class_id ||
            b.classId ||
            b.class_ID ||
            b.class ||
            b["Class ID"] ||
            b["Class ID"];
          const status =
            b.status ||
            b.attendance_status ||
            b["Attendance Status"] ||
            b["Status"] ||
            "";
          return { classId, status };
        };

        // Create a map of class_id -> class data (including date/time and capacity)
        const classMap = new Map();
        classes.forEach((c: any) => {
          const normalized = normalizeClass(c);
          if (!normalized.classId) return;

          const classStartAt = normalized.classStartAt
            ? new Date(normalized.classStartAt)
            : null;

          if (classStartAt && !isNaN(classStartAt.getTime())) {
            classMap.set(String(normalized.classId), {
              capacity: normalized.capacity,
              startAt: classStartAt,
            });
          }
        });

        // Filter bookings and get their class date/time from Classes table
        const bookingsInRange = bookings.filter((b: any) => {
          const normalized = normalizeBooking(b);
          if (!normalized.classId) return false;

          // Convert to string for consistent comparison
          const bookingClassIdStr = String(normalized.classId);
          let classData = classMap.get(bookingClassIdStr);

          if (!classData) {
            // Try case-insensitive match
            for (const [mapKey, mapValue] of classMap.entries()) {
              if (
                String(mapKey).toLowerCase() === bookingClassIdStr.toLowerCase()
              ) {
                classData = mapValue;
                break;
              }
            }
          }

          if (!classData) {
            // Try to find matching class in classes array
            const matchingClass = classes.find((c: any) => {
              const normalizedClass = normalizeClass(c);
              if (!normalizedClass.classId) return false;
              return (
                String(normalizedClass.classId).toLowerCase() ===
                bookingClassIdStr.toLowerCase()
              );
            });

            if (!matchingClass) return false;

            const normalizedMatching = normalizeClass(matchingClass);
            const classStartAt = normalizedMatching.classStartAt
              ? new Date(normalizedMatching.classStartAt)
              : null;

            if (!classStartAt || isNaN(classStartAt.getTime())) return false;

            classData = {
              capacity: normalizedMatching.capacity,
              startAt: classStartAt,
            };
            classMap.set(String(normalizedMatching.classId), classData);
          }

          if (!classData || !classData.startAt) return false;

          const from = new Date(fromDate + "T00:00:00");
          const to = new Date(toDate + "T23:59:59");
          return classData.startAt >= from && classData.startAt <= to;
        });

        // Group by weekday (1=Mon, 7=Sun) and hour
        const heatmapData: Record<
          string,
          { booked: number; capacity: number }
        > = {};

        bookingsInRange.forEach((b: any) => {
          const normalized = normalizeBooking(b);
          if (!normalized.classId) return;

          const bookingClassIdStr = String(normalized.classId);
          let classData = classMap.get(bookingClassIdStr);

          if (!classData) {
            // Try case-insensitive match
            for (const [mapKey, mapValue] of classMap.entries()) {
              if (
                String(mapKey).toLowerCase() === bookingClassIdStr.toLowerCase()
              ) {
                classData = mapValue;
                break;
              }
            }
          }

          if (!classData || !classData.startAt) return;

          const startAt = classData.startAt;

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

          const bookingStatus = normalized.status.toLowerCase();
          if (bookingStatus === "booked" || bookingStatus === "attended") {
            heatmapData[key].booked += 1;
          }

          heatmapData[key].capacity += classData.capacity;
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
