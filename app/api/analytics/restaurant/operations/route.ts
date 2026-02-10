// GET /api/analytics/restaurant/operations?from_date=...&to_date=...&period=month|week
// Returns Operations analytics (covers, table utilization, peak times, reservations)
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
        coversByDay: [],
        coversByHour: [],
        tableUtilization: null,
        peakTimes: [],
        reservationsEffectiveness: null,
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
          "[restaurant-operations] Error fetching model_data:",
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
    const ordersData = allModelData.filter(
      (row) =>
        idToNameMap[row.model_table_id]?.includes("order") ||
        idToNameMap[row.model_table_id]?.includes("sale")
    );
    const reservationsData = allModelData.filter(
      (row) =>
        idToNameMap[row.model_table_id]?.includes("reservation") ||
        idToNameMap[row.model_table_id]?.includes("booking")
    );
    const tablesData = allModelData.filter(
      (row) =>
        idToNameMap[row.model_table_id]?.includes("table") ||
        idToNameMap[row.model_table_id]?.includes("seat")
    );

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

    const reservations: any[] = [];
    if (reservationsData) {
      for (const row of reservationsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          reservations.push(...d);
        } else if (d && typeof d === "object") {
          reservations.push(d);
        }
      }
    }

    const tables: any[] = [];
    if (tablesData) {
      for (const row of tablesData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          tables.push(...d);
        } else if (d && typeof d === "object") {
          tables.push(d);
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
      // Extract time from "Date & Time" if present
      const dateTimeField = o["Date & Time"] || o["Date &amp; Time"];
      let date =
        o.date ||
        o.order_date ||
        o.sale_date ||
        o.created_at ||
        o["Date"] ||
        o["Order Date"] ||
        dateTimeField;
      let time = o.time || o.order_time || o["Time"] || o["Order Time"] || null;

      // If we have "Date & Time", extract time portion
      if (dateTimeField && !time && dateTimeField.match(/\s+\d{2}:\d{2}/)) {
        const timeMatch = dateTimeField.match(/\s+(\d{2}:\d{2})/);
        if (timeMatch) {
          time = timeMatch[1];
        }
      }

      return {
        order_id: o.order_id || o.orderId || o.id || o["Order ID"] || o.ID,
        date,
        time,
        covers:
          typeof (
            o.covers ||
            o.guests ||
            o.party_size ||
            o["Covers"] ||
            o["Guests"]
          ) === "string"
            ? parseFloat(
                o.covers ||
                  o.guests ||
                  o.party_size ||
                  o["Covers"] ||
                  o["Guests"] ||
                  "0"
              )
            : o.covers ||
              o.guests ||
              o.party_size ||
              o["Covers"] ||
              o["Guests"] ||
              0,
        table_id:
          o.table_id ||
          o.tableId ||
          o.table ||
          o["Table ID"] ||
          o["Table"] ||
          null,
        duration:
          typeof (
            o.duration ||
            o.table_time ||
            o["Duration"] ||
            o["Table Time"]
          ) === "string"
            ? parseFloat(
                o.duration ||
                  o.table_time ||
                  o["Duration"] ||
                  o["Table Time"] ||
                  "0"
              )
            : o.duration ||
              o.table_time ||
              o["Duration"] ||
              o["Table Time"] ||
              0,
      };
    };

    const normalizeReservation = (r: any) => {
      // Extract time from "Date & Time" if present
      const dateTimeField = r["Date & Time"] || r["Date &amp; Time"];
      let date =
        r.date ||
        r.reservation_date ||
        r.created_at ||
        r["Date"] ||
        r["Reservation Date"] ||
        dateTimeField;
      let time =
        r.time ||
        r.reservation_time ||
        r["Time"] ||
        r["Reservation Time"] ||
        null;

      // If we have "Date & Time", extract time portion
      if (dateTimeField && !time && dateTimeField.match(/\s+\d{2}:\d{2}/)) {
        const timeMatch = dateTimeField.match(/\s+(\d{2}:\d{2})/);
        if (timeMatch) {
          time = timeMatch[1];
        }
      }

      return {
        reservation_id:
          r.reservation_id ||
          r.reservationId ||
          r.id ||
          r["Reservation ID"] ||
          r.ID,
        date,
        time,
        party_size:
          typeof (
            r.party_size ||
            r.guests ||
            r.covers ||
            r["Party Size"] ||
            r["Guests"]
          ) === "string"
            ? parseFloat(
                r.party_size ||
                  r.guests ||
                  r.covers ||
                  r["Party Size"] ||
                  r["Guests"] ||
                  "0"
              )
            : r.party_size ||
              r.guests ||
              r.covers ||
              r["Party Size"] ||
              r["Guests"] ||
              0,
        status:
          (
            r.status ||
            r["Status (booked, seated, no-show, cancelled)"] ||
            r["Status"] ||
            ""
          ).toLowerCase() || "confirmed",
        table_id:
          r.table_id ||
          r.tableId ||
          r.table ||
          r["Table ID"] ||
          r["Table"] ||
          null,
      };
    };

    // Filter orders by date range
    const ordersInRange = orders.map(normalizeOrder).filter((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return false;
      return orderDate >= fromDateStart && orderDate <= toDateEnd;
    });

    // Filter reservations by date range
    const reservationsInRange = reservations
      .map(normalizeReservation)
      .filter((r) => {
        const resDate = parseDate(r.date);
        if (!resDate) return false;
        return resDate >= fromDateStart && resDate <= toDateEnd;
      });

    // Covers by Day of Week
    const coversByDay = new Map<string, { covers: number; orders: number }>();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    ordersInRange.forEach((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return;
      const dayName = dayNames[orderDate.getDay()];
      const current = coversByDay.get(dayName) || { covers: 0, orders: 0 };
      coversByDay.set(dayName, {
        covers: current.covers + o.covers,
        orders: current.orders + 1,
      });
    });

    const coversByDayArray = dayNames.map((day) => ({
      day,
      covers: coversByDay.get(day)?.covers || 0,
      orders: coversByDay.get(day)?.orders || 0,
    }));

    // Covers by Hour
    const coversByHour = new Map<number, { covers: number; orders: number }>();

    ordersInRange.forEach((o) => {
      let hour = 12; // Default to noon if no time
      if (o.time) {
        // Try to parse time string (e.g., "14:30", "2:30 PM", "14:30:00")
        const timeStr = String(o.time);
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          hour = parseInt(timeMatch[1]);
          // Handle PM
          if (timeStr.toLowerCase().includes("pm") && hour < 12) {
            hour += 12;
          }
          if (timeStr.toLowerCase().includes("am") && hour === 12) {
            hour = 0;
          }
        }
      } else {
        // Try to extract from date if it includes time
        const orderDate = parseDate(o.date);
        if (orderDate) {
          hour = orderDate.getHours();
        }
      }

      const current = coversByHour.get(hour) || { covers: 0, orders: 0 };
      coversByHour.set(hour, {
        covers: current.covers + o.covers,
        orders: current.orders + 1,
      });
    });

    const coversByHourArray = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      hourLabel:
        i === 0
          ? "12am"
          : i === 12
            ? "12pm"
            : i < 12
              ? `${i}am`
              : `${i - 12}pm`,
      covers: coversByHour.get(i)?.covers || 0,
      orders: coversByHour.get(i)?.orders || 0,
    }));

    // Peak Times (top 5 hours by covers)
    const peakTimes = coversByHourArray
      .sort((a, b) => b.covers - a.covers)
      .slice(0, 5)
      .map((p) => ({
        hour: p.hour,
        hourLabel: p.hourLabel,
        covers: p.covers,
        orders: p.orders,
      }));

    // Table Utilization
    // Calculate total table capacity
    let totalTableCapacity = 0;
    if (tables.length > 0) {
      totalTableCapacity = tables.reduce((sum, t: any) => {
        const capacity =
          typeof (t.capacity || t.seats || t["Capacity"] || t["Seats"]) ===
          "string"
            ? parseFloat(
                t.capacity || t.seats || t["Capacity"] || t["Seats"] || "0"
              )
            : t.capacity || t.seats || t["Capacity"] || t["Seats"] || 0;
        return sum + capacity;
      }, 0);
    }

    // Calculate total covers served
    const totalCovers = ordersInRange.reduce((sum, o) => sum + o.covers, 0);

    // Calculate table turnover (average number of times a table is used per day)
    const ordersByDate = new Map<string, number>();
    ordersInRange.forEach((o) => {
      const orderDate = parseDate(o.date);
      if (!orderDate) return;
      const dateKey = orderDate.toISOString().split("T")[0];
      ordersByDate.set(dateKey, (ordersByDate.get(dateKey) || 0) + 1);
    });

    const daysInRange = Math.max(
      1,
      Math.ceil(
        (toDateEnd.getTime() - fromDateStart.getTime()) / (1000 * 60 * 60 * 24)
      )
    );
    const averageOrdersPerDay = ordersInRange.length / daysInRange;
    const tableTurnover =
      totalTableCapacity > 0
        ? (averageOrdersPerDay / totalTableCapacity) * 100
        : null;

    const tableUtilization =
      totalTableCapacity > 0
        ? {
            totalCapacity: totalTableCapacity,
            totalCovers,
            utilizationPercent: parseFloat(
              (
                (totalCovers / (totalTableCapacity * daysInRange)) *
                100
              ).toFixed(2)
            ),
            averageOrdersPerDay: parseFloat(averageOrdersPerDay.toFixed(2)),
            tableTurnover:
              tableTurnover !== null
                ? parseFloat(tableTurnover.toFixed(2))
                : null,
          }
        : null;

    // Reservations Effectiveness
    const confirmedReservations = reservationsInRange.filter(
      (r) => r.status === "confirmed" || r.status === "seated"
    ).length;
    const noShowReservations = reservationsInRange.filter(
      (r) => r.status === "no-show" || r.status === "cancelled"
    ).length;
    const totalReservations = reservationsInRange.length;

    // Match reservations to orders (by date/time/party size)
    const matchedReservations = reservationsInRange.filter((r) => {
      const resDate = parseDate(r.date);
      if (!resDate) return false;
      return ordersInRange.some((o) => {
        const orderDate = parseDate(o.date);
        if (!orderDate) return false;
        // Same day and similar party size
        return (
          orderDate.toDateString() === resDate.toDateString() &&
          Math.abs(o.covers - r.party_size) <= 2
        );
      });
    }).length;

    const reservationsEffectiveness =
      totalReservations > 0
        ? {
            totalReservations,
            confirmedReservations,
            noShowReservations,
            noShowRate: parseFloat(
              ((noShowReservations / totalReservations) * 100).toFixed(2)
            ),
            matchedToOrders: matchedReservations,
            conversionRate: parseFloat(
              ((matchedReservations / totalReservations) * 100).toFixed(2)
            ),
          }
        : null;

    return jsonNoStore({
      coversByDay: coversByDayArray,
      coversByHour: coversByHourArray,
      tableUtilization,
      peakTimes,
      reservationsEffectiveness,
    });
  } catch (err) {
    console.error(
      "[api/analytics/restaurant/operations] Unexpected error:",
      err
    );
    return jsonNoStore({
      coversByDay: [],
      coversByHour: [],
      tableUtilization: null,
      peakTimes: [],
      reservationsEffectiveness: null,
    });
  }
}
