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
        console.error("[kpis] Error fetching model_data:", result.error);
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

    // Calculate KPIs using JavaScript (since we can't run raw SQL)
    // This is a simplified version - in production, you'd want to use RPC functions
    // or execute the SQL queries directly via Supabase

    // Helper function to parse dates in various formats (MM/DD/YY, YYYY-MM-DD, etc.)
    const parseDate = (dateStr: string | null | undefined): Date | null => {
      if (!dateStr) return null;

      // Try YYYY-MM-DD format first
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        return new Date(dateStr + "T00:00:00");
      }

      // Try MM/DD/YY or MM/DD/YYYY format
      if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
        const parts = dateStr.split("/");
        if (parts.length === 3) {
          const month = parseInt(parts[0]) - 1;
          const day = parseInt(parts[1]);
          let year = parseInt(parts[2]);
          // Handle 2-digit years: assume 20XX if < 50, 19XX if >= 50
          if (year < 50) year += 2000;
          else if (year < 100) year += 1900;
          return new Date(year, month, day);
        }
      }

      // Fallback to standard Date parsing
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    // KPI 1: Active Members (End of Month) - simplified to current active
    const activeMembers = members.filter((m: any) => {
      const joinDate = parseDate(m.join_date);
      const cancelDate = parseDate(m.cancel_date || m.cancelDate);
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    }).length;

    // KPI 2: New monthly members
    const newMembers = members.filter((m: any) => {
      const joinDate = parseDate(m.join_date);
      if (!joinDate) return false;
      const from = new Date(fromDate + "T00:00:00");
      const to = new Date(toDate + "T23:59:59");
      return joinDate >= from && joinDate <= to;
    }).length;

    // KPI 3: Churned monthly members
    // Check for cancel_date field, or infer from status field
    const periodFrom = new Date(fromDate + "T00:00:00");
    const periodTo = new Date(toDate + "T23:59:59");

    const churnedMembers = members.filter((m: any) => {
      // First, try to use cancel_date if available
      const cancelDate = m.cancel_date
        ? parseDate(m.cancel_date)
        : m.cancelDate
          ? parseDate(m.cancelDate)
          : null;

      if (cancelDate && !isNaN(cancelDate.getTime())) {
        return cancelDate >= periodFrom && cancelDate <= periodTo;
      }

      // Fallback: if no cancel_date, check status field
      // If status is "cancelled" or "inactive", we need to infer the date
      // For now, we'll only count members with explicit cancel_date
      // This ensures accurate churn calculation
      return false;
    }).length;

    // KPI 4: Monthly Churn Rate (%)
    // Use active members at the START of the period for churn rate calculation
    const periodStart = new Date(fromDate + "T00:00:00");
    const activeMembersAtStart = members.filter((m: any) => {
      const joinDate = m.join_date ? parseDate(m.join_date) : null;
      const cancelDate = m.cancel_date
        ? parseDate(m.cancel_date)
        : m.cancelDate
          ? parseDate(m.cancelDate)
          : null;
      if (!joinDate || isNaN(joinDate.getTime())) return false;
      // Member was active at the start of the period if:
      // - They joined before or during the period start
      // - They haven't cancelled, or cancelled after the period start
      return (
        joinDate <= periodStart &&
        (!cancelDate || isNaN(cancelDate.getTime()) || cancelDate > periodStart)
      );
    }).length;

    // Calculate average active members during the period
    // Use active members at end of period as well
    const periodEnd = new Date(toDate + "T23:59:59");
    const activeMembersAtEnd = members.filter((m: any) => {
      const joinDate = m.join_date ? parseDate(m.join_date) : null;
      const cancelDate = m.cancel_date
        ? parseDate(m.cancel_date)
        : m.cancelDate
          ? parseDate(m.cancelDate)
          : null;
      if (!joinDate || isNaN(joinDate.getTime())) return false;
      return (
        joinDate <= periodEnd &&
        (!cancelDate || isNaN(cancelDate.getTime()) || cancelDate > periodEnd)
      );
    }).length;

    // Use the larger of start or end, or average if both are > 0
    // This handles cases where all members joined during the period
    const avgActiveMembers =
      activeMembersAtStart > 0 && activeMembersAtEnd > 0
        ? (activeMembersAtStart + activeMembersAtEnd) / 2
        : Math.max(activeMembersAtStart, activeMembersAtEnd);

    const churnRate =
      avgActiveMembers > 0 ? (churnedMembers / avgActiveMembers) * 100 : 0;

    // KPI 5: Average Member Tenure (Months) - simplified
    const activeMembersWithTenure = members.filter((m: any) => {
      const joinDate = parseDate(m.join_date);
      const cancelDate = parseDate(m.cancel_date || m.cancelDate);
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    });

    const avgTenure =
      activeMembersWithTenure.length > 0
        ? activeMembersWithTenure.reduce((sum: number, m: any) => {
            const joinDate = parseDate(m.join_date);
            const cancelDate = parseDate(m.cancel_date || m.cancelDate);
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

        if (!matchingClass) {
          return false;
        }

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

    const bookedSpots = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase();
      return status === "booked" || status === "attended";
    }).length;

    // Calculate total capacity from classes in the date range
    const classesInRange = Array.from(classMap.values()).filter((classData) => {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      return classData.startAt >= from && classData.startAt < to;
    });

    const totalCapacity = classesInRange.reduce((sum: number, classData) => {
      return sum + (classData.capacity || 0);
    }, 0);

    const utilizationRate =
      totalCapacity > 0 ? (bookedSpots / totalCapacity) * 100 : 0;

    // KPI 8: Cancellation Rate (%)
    const finalBookings = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase();
      return (
        status === "attended" ||
        status === "no_show" ||
        status === "cancelled" ||
        status === "booked"
      );
    });
    const cancelled = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase();
      return status === "cancelled";
    }).length;
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
