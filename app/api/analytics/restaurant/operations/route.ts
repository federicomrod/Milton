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

    // Get field names from data_tables definitions
    const ordersTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id]?.includes("order") || idToNameMap[id]?.includes("sale")
    );
    const reservationsTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id]?.includes("reservation") ||
        idToNameMap[id]?.includes("booking")
    );
    const tablesTableId = Object.keys(idToNameMap).find(
      (id) =>
        idToNameMap[id]?.includes("table") || idToNameMap[id]?.includes("seat")
    );

    const ordersFields = ordersTableId
      ? tableFieldsMap[ordersTableId]?.fields || []
      : [];
    const reservationsFields = reservationsTableId
      ? tableFieldsMap[reservationsTableId]?.fields || []
      : [];
    const tablesFields = tablesTableId
      ? tableFieldsMap[tablesTableId]?.fields || []
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
      // Get field names from data_tables
      const dateTimeField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") ||
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("&")
      )?.name;
      const dateTimeValue = dateTimeField
        ? getFieldValue(o, dateTimeField, [
            "Date & Time",
            "date_time",
            "order_date",
            "date",
          ])
        : o["Date & Time"] || o["Date &amp; Time"] || null;

      const dateField = ordersFields.find((f) =>
        f.name.toLowerCase().includes("date")
      )?.name;
      let date = dateField
        ? getFieldValue(o, dateField, [
            "date",
            "Date",
            "order_date",
            "sale_date",
            "created_at",
          ]) || dateTimeValue
        : o.date ||
          o.order_date ||
          o.sale_date ||
          o.created_at ||
          o["Date"] ||
          o["Order Date"] ||
          dateTimeValue;

      const timeField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") &&
          !f.name.toLowerCase().includes("date")
      )?.name;
      let time = timeField
        ? getFieldValue(o, timeField, [
            "time",
            "Time",
            "order_time",
            "Order Time",
          ])
        : o.time || o.order_time || o["Time"] || o["Order Time"] || null;

      // If we have "Date & Time", extract time portion
      if (dateTimeValue && !time && dateTimeValue.match(/\s+\d{2}:\d{2}/)) {
        const timeMatch = dateTimeValue.match(/\s+(\d{2}:\d{2})/);
        if (timeMatch) {
          time = timeMatch[1];
        }
      }

      const orderIdField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("order") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const order_id = orderIdField
        ? getFieldValue(o, orderIdField, ["order_id", "Order ID", "id", "ID"])
        : o.order_id || o.orderId || o.id || o["Order ID"] || o.ID;

      const coversField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("cover") ||
          f.name.toLowerCase().includes("guest") ||
          f.name.toLowerCase().includes("party")
      )?.name;
      const coversRaw = coversField
        ? getFieldValue(o, coversField, [
            "covers",
            "Covers",
            "guests",
            "Guests",
            "party_size",
          ])
        : o.covers || o.guests || o.party_size || o["Covers"] || o["Guests"];
      const covers =
        typeof coversRaw === "string"
          ? parseFloat(coversRaw || "0")
          : coversRaw || 0;

      const tableIdField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("table") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const table_id = tableIdField
        ? getFieldValue(o, tableIdField, [
            "table_id",
            "Table ID",
            "table",
            "Table",
          ]) || null
        : o.table_id ||
          o.tableId ||
          o.table ||
          o["Table ID"] ||
          o["Table"] ||
          null;

      const durationField = ordersFields.find(
        (f) =>
          f.name.toLowerCase().includes("duration") ||
          f.name.toLowerCase().includes("table_time")
      )?.name;
      const durationRaw = durationField
        ? getFieldValue(o, durationField, [
            "duration",
            "Duration",
            "table_time",
            "Table Time",
          ])
        : o.duration || o.table_time || o["Duration"] || o["Table Time"];
      const duration =
        typeof durationRaw === "string"
          ? parseFloat(durationRaw || "0")
          : durationRaw || 0;

      return {
        order_id,
        date,
        time,
        covers,
        table_id,
        duration,
      };
    };

    const normalizeReservation = (r: any) => {
      // Get field names from data_tables
      const dateTimeField = reservationsFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") ||
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("&")
      )?.name;
      const dateTimeValue = dateTimeField
        ? getFieldValue(r, dateTimeField, [
            "Date & Time",
            "date_time",
            "reservation_date",
            "date",
          ])
        : r["Date & Time"] || r["Date &amp; Time"] || null;

      const dateField = reservationsFields.find((f) =>
        f.name.toLowerCase().includes("date")
      )?.name;
      let date = dateField
        ? getFieldValue(r, dateField, [
            "date",
            "Date",
            "reservation_date",
            "created_at",
          ]) || dateTimeValue
        : r.date ||
          r.reservation_date ||
          r.created_at ||
          r["Date"] ||
          r["Reservation Date"] ||
          dateTimeValue;

      const timeField = reservationsFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") &&
          !f.name.toLowerCase().includes("date")
      )?.name;
      let time = timeField
        ? getFieldValue(r, timeField, [
            "time",
            "Time",
            "reservation_time",
            "Reservation Time",
          ])
        : r.time ||
          r.reservation_time ||
          r["Time"] ||
          r["Reservation Time"] ||
          null;

      // If we have "Date & Time", extract time portion
      if (dateTimeValue && !time && dateTimeValue.match(/\s+\d{2}:\d{2}/)) {
        const timeMatch = dateTimeValue.match(/\s+(\d{2}:\d{2})/);
        if (timeMatch) {
          time = timeMatch[1];
        }
      }

      const reservationIdField = reservationsFields.find(
        (f) =>
          f.name.toLowerCase().includes("reservation") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const reservation_id = reservationIdField
        ? getFieldValue(r, reservationIdField, [
            "reservation_id",
            "Reservation ID",
            "id",
            "ID",
          ])
        : r.reservation_id ||
          r.reservationId ||
          r.id ||
          r["Reservation ID"] ||
          r.ID;

      const partySizeField = reservationsFields.find(
        (f) =>
          f.name.toLowerCase().includes("party") ||
          f.name.toLowerCase().includes("guest") ||
          f.name.toLowerCase().includes("cover")
      )?.name;
      const partySizeRaw = partySizeField
        ? getFieldValue(r, partySizeField, [
            "party_size",
            "Party Size",
            "guests",
            "Guests",
            "covers",
          ])
        : r.party_size ||
          r.guests ||
          r.covers ||
          r["Party Size"] ||
          r["Guests"];
      const party_size =
        typeof partySizeRaw === "string"
          ? parseFloat(partySizeRaw || "0")
          : partySizeRaw || 0;

      const statusField = reservationsFields.find((f) =>
        f.name.toLowerCase().includes("status")
      )?.name;
      const status = statusField
        ? (
            getFieldValue(r, statusField, [
              "status",
              "Status",
              "Status (booked, seated, no-show, cancelled)",
            ]) || ""
          ).toLowerCase() || "confirmed"
        : (
            r.status ||
            r["Status (booked, seated, no-show, cancelled)"] ||
            r["Status"] ||
            ""
          ).toLowerCase() || "confirmed";

      const tableIdField = reservationsFields.find(
        (f) =>
          f.name.toLowerCase().includes("table") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const table_id = tableIdField
        ? getFieldValue(r, tableIdField, [
            "table_id",
            "Table ID",
            "table",
            "Table",
          ]) || null
        : r.table_id ||
          r.tableId ||
          r.table ||
          r["Table ID"] ||
          r["Table"] ||
          null;

      return {
        reservation_id,
        date,
        time,
        party_size,
        status,
        table_id,
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
    // Calculate total table capacity - use actual field names from data_tables
    let totalTableCapacity = 0;
    if (tables.length > 0) {
      const capacityField = tablesFields.find(
        (f) =>
          f.name.toLowerCase().includes("capacity") ||
          f.name.toLowerCase().includes("seat")
      )?.name;
      totalTableCapacity = tables.reduce((sum, t: any) => {
        const capacityRaw = capacityField
          ? getFieldValue(t, capacityField, [
              "capacity",
              "Capacity",
              "seats",
              "Seats",
            ])
          : t.capacity || t.seats || t["Capacity"] || t["Seats"];
        const capacity =
          typeof capacityRaw === "string"
            ? parseFloat(capacityRaw || "0")
            : capacityRaw || 0;
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
