// GET /api/analytics/fitness-studio/classes-utilization?from_date=...&to_date=...&period=month|week
// Returns KPIs and tables for Classes & Utilization analytics. KPI values from unified kpi-calculations layer.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateAverageClassOccupancy,
  calculateRevenuePerClass,
  calculateCancellationRate,
  calculateUtilizationRate,
  calculateAverageClassSize,
} from "@/lib/kpi-calculations";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function parseDate(dateStr: any): Date | null {
  if (dateStr == null) return null;
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
  if (typeof dateStr === "number") {
    if (dateStr > 1e12) return new Date(dateStr);
    if (dateStr > 1000) return new Date((dateStr - 25569) * 86400 * 1000);
    return null;
  }
  if (typeof dateStr !== "string") return null;

  // Try YYYY-MM-DD HH:mm:ss format (with space separator)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
    return new Date(dateStr.replace(" ", "T"));
  }

  // Try YYYY-MM-DD format (date only)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateStr + "T00:00:00");
  }

  // Try YYYY-MM-DD format (with other characters after)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return new Date(dateStr.split(" ")[0] + "T00:00:00");
  }

  // Try MM/DD/YY or MM/DD/YYYY format
  if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const month = parseInt(parts[0]) - 1;
      const day = parseInt(parts[1]);
      let year = parseInt(parts[2]);
      if (year < 50) year += 2000;
      else if (year < 100) year += 1900;
      const parsed = new Date(year, month, day);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month &&
        parsed.getDate() === day
      ) {
        return parsed;
      }
    }
  }

  // Fallback to standard Date parsing
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
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
      return jsonNoStore({ kpis: {}, topClasses: [], bottomClasses: [] });
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

    // Fetch all model_data for the company (with pagination)
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
          "[classes-utilization] Error fetching model_data:",
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
    const bookingsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "bookings"
    );
    const classesData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "classes"
    );
    const instructorsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "instructors"
    );

    // Parse data
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

    const instructors: any[] = [];
    if (instructorsData) {
      for (const row of instructorsData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          instructors.push(...d);
        } else if (d && typeof d === "object") {
          instructors.push(d);
        }
      }
    }

    // Normalize dates to start/end of day for accurate filtering
    const fromDateStart = new Date(fromDate);
    fromDateStart.setHours(0, 0, 0, 0);
    const toDateEnd = new Date(toDate);
    toDateEnd.setHours(23, 59, 59, 999);

    // Get field names from data_tables definitions
    const bookingsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "bookings"
    );
    const classesTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "classes"
    );

    const bookingsFields = bookingsTableId
      ? tableFieldsMap[bookingsTableId]?.fields || []
      : [];
    const classesFields = classesTableId
      ? tableFieldsMap[classesTableId]?.fields || []
      : [];
    const instructorsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "instructors"
    );
    const instructorsFields = instructorsTableId
      ? tableFieldsMap[instructorsTableId]?.fields || []
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

    // Normalize field names - use actual field names from data_tables
    const normalizeBooking = (b: any) => {
      const classIdField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("class") &&
          (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
      )?.name;
      const classId = classIdField
        ? getFieldValue(b, classIdField, ["class_id", "Class ID"])
        : b.class_id || b["Class ID"] || b.classId;

      const memberIdField = bookingsFields.find(
        (f) =>
          (f.name.toLowerCase().includes("member") ||
            f.name.toLowerCase().includes("customer")) &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const customerId = memberIdField
        ? getFieldValue(b, memberIdField, [
            "member_id",
            "Member ID",
            "customer_id",
          ])
        : b.customer_id || b["Member ID"] || b.customerId || b.member_id;

      const bookingIdField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("booking") &&
          f.name.toLowerCase().includes("id")
      )?.name;
      const bookingId = bookingIdField
        ? getFieldValue(b, bookingIdField, ["booking_id", "Booking ID"])
        : b.booking_id || b["Booking ID"] || b.bookingId;

      const statusField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("status") ||
          f.name.toLowerCase().includes("attendance")
      )?.name;
      const status = statusField
        ? getFieldValue(b, statusField, [
            "status",
            "Status",
            "Attendance Status",
          ]) || ""
        : b.status ||
          b.attendance_status ||
          b["Attendance Status"] ||
          b.attendanceStatus ||
          "";

      const priceField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("price") ||
          f.name.toLowerCase().includes("amount")
      )?.name;
      const pricePaid = priceField
        ? getFieldValue(b, priceField, [
            "price_paid",
            "Price Paid",
            "price",
            "Price",
          ]) || 0
        : b.price_paid || b.price || b.Price || b.pricePaid || 0;

      const dateTimeField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") ||
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("&")
      )?.name;
      const classStartAt = dateTimeField
        ? getFieldValue(b, dateTimeField, [
            "Date & Time",
            "date_time",
            "class_start_at",
            "booking_time",
            "date",
          ])
        : b.class_start_at ||
          b.booking_time ||
          b.date ||
          b.class_date ||
          b["Class Date"] ||
          b["Booking Time"] ||
          b["Date"] ||
          b["Date & Time"];

      return {
        class_id: classId,
        customer_id: customerId,
        booking_id: bookingId,
        status,
        price_paid: pricePaid,
        class_start_at: classStartAt,
        _original: b,
      };
    };

    const normalizedBookings = bookings.map(normalizeBooking);

    // Create class lookup maps FIRST - use actual field names from data_tables
    const classMap = new Map();
    classes.forEach((c: any) => {
      const classIdField = classesFields.find(
        (f) =>
          f.name.toLowerCase().includes("class") &&
          (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
      )?.name;
      const classId = classIdField
        ? getFieldValue(c, classIdField, ["id", "class_id", "Class ID"])
        : c.id || c.class_id || c["Class ID"] || c.classId;

      if (classId) {
        const capacityField = classesFields.find((f) =>
          f.name.toLowerCase().includes("capacity")
        )?.name;
        const capacity = capacityField
          ? getFieldValue(c, capacityField, ["capacity", "Capacity"]) || 0
          : c.capacity || c.Capacity || c["Capacity"] || 0;

        // Prefer "Class Name" over "Type ID" for display
        const nameField =
          classesFields.find(
            (f) =>
              f.name.toLowerCase().includes("class") &&
              f.name.toLowerCase().includes("name")
          )?.name ??
          classesFields.find(
            (f) =>
              f.name.toLowerCase().includes("name") &&
              !f.name.toLowerCase().includes("type")
          )?.name ??
          classesFields.find(
            (f) =>
              f.name.toLowerCase().includes("name") ||
              f.name.toLowerCase().includes("type")
          )?.name;
        const className = nameField
          ? getFieldValue(c, nameField, ["class_name", "Class Name", "name"])
          : (c.class_name ??
            c["Class Name"] ??
            c.className ??
            c.name ??
            c.Name ??
            c.type ??
            c.Type);

        const categoryField = classesFields.find((f) =>
          f.name.toLowerCase().includes("category")
        )?.name;
        const category = categoryField
          ? getFieldValue(c, categoryField, ["category", "Category", "type"])
          : c.category || c.Category || c["Category"] || c.type || c.Type;

        const dateTimeField = classesFields.find(
          (f) =>
            f.name.toLowerCase().includes("time") ||
            f.name.toLowerCase().includes("date") ||
            f.name.toLowerCase().includes("starting")
        )?.name;
        const date = dateTimeField
          ? getFieldValue(c, dateTimeField, [
              "Class Starting Time",
              "class_start_at",
              "Date & Time",
              "date_time",
              "date",
            ])
          : c.class_start_at ||
            c["Class Starting Time"] ||
            c.date ||
            c["Class Date"] ||
            c["Date"] ||
            c.start_date ||
            c["Start Date"] ||
            c["Date & Time"];

        const instructorIdField = classesFields.find(
          (f) =>
            f.name.toLowerCase().includes("instructor") &&
            (f.name.toLowerCase().includes("id") ||
              f.name.toLowerCase() === "id")
        )?.name;
        const instructorId = instructorIdField
          ? getFieldValue(c, instructorIdField, [
              "instructor_id",
              "Instructor ID",
            ])
          : (c.instructor_id ?? c["Instructor ID"]);

        // Normalize class data
        const normalizedClass = {
          class_id: classId,
          capacity,
          class_name: className,
          category,
          date,
          instructor_id: instructorId,
          _original: c,
        };
        classMap.set(classId, normalizedClass);
      }
    });

    // Filter bookings by date range
    const bookingsInRange = normalizedBookings.filter((b: any) => {
      let startAtStr = b.class_start_at;

      // If no date in booking, try to get it from the class
      if (!startAtStr && b.class_id) {
        const classData = classMap.get(b.class_id);
        if (classData && (classData as any).date) {
          startAtStr = (classData as any).date;
        } else {
          return false;
        }
      } else if (!startAtStr) {
        return false;
      }

      if (!startAtStr) {
        return false; // Skip bookings without dates for now
      }

      const startAt = parseDate(startAtStr);
      if (!startAt || isNaN(startAt.getTime())) {
        return false;
      }

      return startAt >= fromDateStart && startAt <= toDateEnd;
    });

    const instructorMap = new Map<string, any>();
    const instructorIdField = instructorsFields.find(
      (f) =>
        f.name.toLowerCase().includes("instructor") &&
        (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
    )?.name;
    instructors.forEach((i: any) => {
      const id = instructorIdField
        ? getFieldValue(i, instructorIdField, [
            "instructor_id",
            "Instructor ID",
          ])
        : (i.instructor_id ?? i["Instructor ID"]);
      if (id != null && id !== "") {
        instructorMap.set(String(id), i);
      }
    });

    // Calculate KPIs
    // KPI 1: Average Class Occupancy (%)
    const classOccurrences = new Map<
      string,
      { filled: number; capacity: number; period: string | null }
    >();

    bookingsInRange.forEach((b: any) => {
      const classId = b.class_id;
      const classData = classMap.get(classId);
      if (!classData) {
        return;
      }

      const capacity = Number(classData.capacity) || 0;
      let startAtStr = b.class_start_at;
      // If no date in booking, use date from class
      if (!startAtStr && (classData as any).date) {
        startAtStr = (classData as any).date;
      }
      if (!startAtStr) {
        return; // Skip if still no date
      }
      const key = `${classId}_${startAtStr}`;
      const startAt = parseDate(startAtStr);
      const period =
        startAt && !isNaN(startAt.getTime())
          ? `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, "0")}`
          : null;

      if (!classOccurrences.has(key)) {
        classOccurrences.set(key, { filled: 0, capacity, period });
      }

      const occurrence = classOccurrences.get(key)!;
      const status = (b.status || "").toLowerCase();
      if (status === "booked" || status === "attended") {
        occurrence.filled += 1;
      }
    });

    let totalOccupancy = 0;
    let occurrenceCount = 0;
    classOccurrences.forEach((occ) => {
      if (occ.capacity > 0) {
        totalOccupancy += (occ.filled / occ.capacity) * 100;
        occurrenceCount += 1;
      }
    });

    // KPI from layer below; keep local computation for reference
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced by layer
    const _avgClassOccupancy =
      occurrenceCount > 0 ? totalOccupancy / occurrenceCount : 0;

    // KPI 2: Revenue per Class (average revenue per class occurrence)
    const revenueByOccurrence = new Map<string, number>();
    bookingsInRange.forEach((b: any) => {
      const status = (b.status || "").toLowerCase();
      if (status === "booked" || status === "attended") {
        let startAtStr = b.class_start_at;
        // If no date in booking, use date from class
        if (!startAtStr && b.class_id) {
          const classData = classMap.get(b.class_id);
          if (classData && (classData as any).date) {
            startAtStr = (classData as any).date;
          }
        }
        if (!startAtStr) return; // Skip if still no date
        const key = `${b.class_id}_${startAtStr}`;
        const pricePaid =
          typeof b.price_paid === "string"
            ? parseFloat(b.price_paid)
            : b.price_paid || 0;

        const current = revenueByOccurrence.get(key) || 0;
        revenueByOccurrence.set(key, current + pricePaid);
      }
    });

    const totalRevenue = Array.from(revenueByOccurrence.values()).reduce(
      (sum, rev) => sum + rev,
      0
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced by layer
    const _revenuePerClass =
      revenueByOccurrence.size > 0
        ? totalRevenue / revenueByOccurrence.size
        : 0;

    // Also keep revenueByClass for top classes table
    const revenueByClass = new Map<string, number>();
    bookingsInRange.forEach((b: any) => {
      const status = (b.status || "").toLowerCase();
      if (status === "booked" || status === "attended") {
        const classId = b.class_id;
        // price_paid might be in bookings or might need to come from payments table
        const pricePaid =
          typeof b.price_paid === "string"
            ? parseFloat(b.price_paid)
            : b.price_paid ||
              (typeof b.price === "string" ? parseFloat(b.price) : b.price) ||
              0;

        const current = revenueByClass.get(classId) || 0;
        revenueByClass.set(classId, current + pricePaid);
      }
    });

    // KPI 3: Cancellation Rate (%)
    const finalBookings = bookingsInRange.filter((b: any) => {
      const status = (b.status || "").toLowerCase();
      return (
        status === "attended" ||
        status === "no_show" ||
        status === "cancelled" ||
        status === "booked"
      );
    });
    const cancelled = bookingsInRange.filter((b: any) => {
      const status = (b.status || "").toLowerCase();
      return status === "cancelled";
    }).length;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced by layer
    const _cancellationRate =
      finalBookings.length > 0 ? (cancelled / finalBookings.length) * 100 : 0;

    // No Show Rate (%): no_show / (attended + no_show) — booked spots where member did not attend
    // Read status from normalized b.status or raw row (Excel uses "Attendance Status" / "No-Show")
    const getBookingStatus = (b: any): string => {
      const raw =
        b.status ??
        b._original?.["Attendance Status"] ??
        b._original?.attendance_status ??
        b._original?.Status ??
        b._original?.status ??
        "";
      return String(raw)
        .toLowerCase()
        .replace(/-/g, "_")
        .replace(/\s+/g, "_")
        .trim();
    };
    let attendedCount = 0;
    let noShowCount = 0;
    bookingsInRange.forEach((b: any) => {
      const status = getBookingStatus(b);
      if (status === "attended") attendedCount += 1;
      else if (status === "no_show" || status === "noshow") noShowCount += 1;
    });
    const noShowDenom = attendedCount + noShowCount;
    const noShowRate = noShowDenom > 0 ? (noShowCount / noShowDenom) * 100 : 0;

    // KPI 4: Capacity Utilization (%)
    let totalFilledSpots = 0;
    let totalCapacitySpots = 0;

    classOccurrences.forEach((occ) => {
      totalFilledSpots += occ.filled;
      totalCapacitySpots += Number(occ.capacity) || 0;
    });

    const capacityUtilization =
      totalCapacitySpots > 0
        ? (totalFilledSpots / totalCapacitySpots) * 100
        : 0;

    // KPI 5: Average Class Size (average number of attendees per class occurrence)
    let totalAttendees = 0;
    let classOccurrenceCount = 0;
    const averageClassSizeByPeriodMap = new Map<
      string,
      { totalFilled: number; count: number }
    >();
    classOccurrences.forEach((occ) => {
      totalAttendees += occ.filled;
      classOccurrenceCount += 1;
      if (occ.period) {
        const p = averageClassSizeByPeriodMap.get(occ.period) ?? {
          totalFilled: 0,
          count: 0,
        };
        p.totalFilled += occ.filled;
        p.count += 1;
        averageClassSizeByPeriodMap.set(occ.period, p);
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced by layer
    const _averageClassSize =
      classOccurrenceCount > 0 ? totalAttendees / classOccurrenceCount : 0;
    const averageClassSizeByPeriod = Array.from(
      averageClassSizeByPeriodMap.entries()
    )
      .map(([period, { totalFilled, count }]) => ({
        period,
        value: count > 0 ? parseFloat((totalFilled / count).toFixed(2)) : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // Top Performing Classes (combines revenue and occupancy)
    const occupancyByClass = new Map<
      string,
      { totalOccupancy: number; count: number }
    >();

    classOccurrences.forEach((occ, key) => {
      const classId = key.split("_")[0];
      const occupancy =
        occ.capacity > 0 ? (occ.filled / occ.capacity) * 100 : 0;

      if (!occupancyByClass.has(classId)) {
        occupancyByClass.set(classId, { totalOccupancy: 0, count: 0 });
      }

      const classOcc = occupancyByClass.get(classId)!;
      classOcc.totalOccupancy += occupancy;
      classOcc.count += 1;
    });

    // Get schedule information from bookings - group by day and time
    const classSchedules = new Map<string, Map<string, Set<string>>>(); // classId -> time -> days
    bookingsInRange.forEach((b: any) => {
      const classId = b.class_id;
      const startAtStr = b.class_start_at || b.booking_time || b.date || null;
      const startAt = startAtStr ? new Date(startAtStr) : null;
      if (!startAt) return;

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayName = dayNames[startAt.getDay()];
      const hours = startAt.getHours();
      const minutes = startAt.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
      const timeStr = `${displayHour}:${minutes.toString().padStart(2, "0")} ${ampm}`;

      if (!classSchedules.has(classId)) {
        classSchedules.set(classId, new Map());
      }
      const timeMap = classSchedules.get(classId)!;
      if (!timeMap.has(timeStr)) {
        timeMap.set(timeStr, new Set());
      }
      timeMap.get(timeStr)!.add(dayName);
    });

    const topPerformingClasses = Array.from(revenueByClass.entries())
      .map(([classId, revenue]) => {
        const classData = classMap.get(classId);
        const className =
          classData?.class_name || classData?.name || "Unknown Class";
        const instructorId = classData?.instructor_id
          ? String(classData.instructor_id)
          : null;
        let instructor = instructorId ? instructorMap.get(instructorId) : null;
        if (!instructor && instructorId) {
          for (const [k, v] of instructorMap.entries()) {
            if (
              String(k).toLowerCase() === String(instructorId).toLowerCase()
            ) {
              instructor = v;
              break;
            }
          }
        }
        const instructorNameField = instructorsFields.find(
          (f) =>
            f.name.toLowerCase().includes("name") &&
            !f.name.toLowerCase().includes("last")
        )?.name;
        const instructorLastNameField = instructorsFields.find(
          (f) =>
            f.name.toLowerCase().includes("last") &&
            f.name.toLowerCase().includes("name")
        )?.name;
        const firstName = instructor
          ? instructorNameField
            ? getFieldValue(instructor, instructorNameField, [
                "Name",
                "name",
                "instructor_name",
              ])
            : (instructor.Name ?? instructor.name ?? instructor.instructor_name)
          : null;
        const lastName = instructor
          ? instructorLastNameField
            ? getFieldValue(instructor, instructorLastNameField, [
                "Last Name",
                "last_name",
                "lastName",
              ])
            : (instructor["Last Name"] ??
              instructor.last_name ??
              instructor.lastName)
          : null;
        const instructorName =
          firstName != null && firstName !== ""
            ? lastName != null && lastName !== ""
              ? `${firstName} ${lastName}`.trim()
              : String(firstName)
            : (instructor?.instructor_name ?? instructor?.name ?? "Unknown");

        const occ = occupancyByClass.get(classId);
        const avgOccupancy =
          occ && occ.count > 0
            ? parseFloat((occ.totalOccupancy / occ.count).toFixed(2))
            : 0;

        // Format schedule - group days by time
        const scheduleMap = classSchedules.get(classId) || new Map();
        const scheduleParts: string[] = [];
        scheduleMap.forEach((days, time) => {
          const dayArray = Array.from(days);
          if (dayArray.length > 0) {
            const daysStr = dayArray.join(", ");
            scheduleParts.push(`${daysStr} • ${time}`);
          }
        });
        const schedule =
          scheduleParts.length > 0
            ? scheduleParts[0] // Show first schedule, could show more if needed
            : "No schedule";

        // Get initials for class icon
        const initials = className
          .split(" ")
          .map((word: string) => word[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);

        return {
          class_id: classId,
          class_name: className,
          initials,
          instructor_name: instructorName,
          schedule,
          occupancy: avgOccupancy,
          revenue: parseFloat(revenue.toFixed(2)),
          trend: "up" as "up" | "down", // Placeholder - would need historical data for real trend
        };
      })
      .sort((a, b) => {
        // Sort by revenue first, then by occupancy
        if (Math.abs(a.revenue - b.revenue) > 10) {
          return b.revenue - a.revenue;
        }
        return b.occupancy - a.occupancy;
      })
      .slice(0, 10);

    // Occupancy by Class Type
    const occupancyByType = new Map<
      string,
      { totalOccupancy: number; count: number }
    >();

    classOccurrences.forEach((occ, key) => {
      const classId = key.split("_")[0];
      const classData = classMap.get(classId);
      if (!classData) return;

      // Get class type from class_name or class_type field
      const classType =
        classData.class_type ||
        (classData.class_name ? classData.class_name.split(" ")[0] : "Other");

      const occupancy =
        occ.capacity > 0 ? (occ.filled / occ.capacity) * 100 : 0;

      if (!occupancyByType.has(classType)) {
        occupancyByType.set(classType, { totalOccupancy: 0, count: 0 });
      }

      const typeOcc = occupancyByType.get(classType)!;
      typeOcc.totalOccupancy += occupancy;
      typeOcc.count += 1;
    });

    const occupancyByTypeArray = Array.from(occupancyByType.entries())
      .map(([type, occ]) => ({
        class_type: type,
        occupancy:
          occ.count > 0
            ? parseFloat((occ.totalOccupancy / occ.count).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.occupancy - a.occupancy);

    // Hourly Utilization Rate (by weekday/weekend)
    const hourlyUtilizationWeekday = new Map<
      number,
      { filled: number; capacity: number }
    >();
    const hourlyUtilizationWeekend = new Map<
      number,
      { filled: number; capacity: number }
    >();

    bookingsInRange.forEach((b: any) => {
      const startAtStr = b.class_start_at || b.booking_time || b.date || null;
      const startAt = startAtStr ? new Date(startAtStr) : null;
      if (!startAt) return;

      const hour = startAt.getHours();
      const dayOfWeek = startAt.getDay(); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const classData = classMap.get(b.class_id);
      if (!classData) return;

      const capacity = classData.capacity || 0;
      const map = isWeekend
        ? hourlyUtilizationWeekend
        : hourlyUtilizationWeekday;

      if (!map.has(hour)) {
        map.set(hour, { filled: 0, capacity: 0 });
      }

      const hourData = map.get(hour)!;
      hourData.capacity += capacity;

      const status = (b.status || "").toLowerCase();
      if (status === "booked" || status === "attended") {
        hourData.filled += 1;
      }
    });

    // Generate hourly data for 6am to 10pm (6 to 22)
    const generateHourlyData = (
      map: Map<number, { filled: number; capacity: number }>
    ) => {
      const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6 to 22
      return hours.map((hour) => {
        const data = map.get(hour) || { filled: 0, capacity: 0 };
        const utilization =
          data.capacity > 0
            ? parseFloat(((data.filled / data.capacity) * 100).toFixed(2))
            : 0;
        return {
          hour: hour,
          hourLabel:
            hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm`,
          utilization,
        };
      });
    };

    const hourlyWeekday = generateHourlyData(hourlyUtilizationWeekday);
    const hourlyWeekend = generateHourlyData(hourlyUtilizationWeekend);

    // Calculate trends by comparing with previous period
    const periodDuration = toDateEnd.getTime() - fromDateStart.getTime();
    const prevToDate = new Date(fromDateStart);
    prevToDate.setHours(23, 59, 59, 999);
    const prevFromDate = new Date(prevToDate.getTime() - periodDuration);
    prevFromDate.setHours(0, 0, 0, 0);

    // KPI values and trends from unified kpi-calculations layer
    const fromDateStr = fromDateStart.toISOString().slice(0, 10);
    const toDateStr = toDateEnd.toISOString().slice(0, 10);
    const prevFromDateStr = prevFromDate.toISOString().slice(0, 10);
    const prevToDateStr = prevToDate.toISOString().slice(0, 10);

    const layerResults = await Promise.all([
      calculateAverageClassOccupancy(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateRevenuePerClass(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateCancellationRate(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateUtilizationRate(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateAverageClassSize(
        supabase,
        user!.id,
        fromDateStr,
        toDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateAverageClassOccupancy(
        supabase,
        user!.id,
        prevFromDateStr,
        prevToDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateRevenuePerClass(
        supabase,
        user!.id,
        prevFromDateStr,
        prevToDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateCancellationRate(
        supabase,
        user!.id,
        prevFromDateStr,
        prevToDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateUtilizationRate(
        supabase,
        user!.id,
        prevFromDateStr,
        prevToDateStr
      ).catch(() => ({ currentValue: 0 })),
      calculateAverageClassSize(
        supabase,
        user!.id,
        prevFromDateStr,
        prevToDateStr
      ).catch(() => ({ currentValue: 0 })),
    ]);

    const [
      currOcc,
      currRev,
      currCanc,
      currUtil,
      currSize,
      prevOcc,
      prevRev,
      prevCanc,
    ] = layerResults.map((r) => r.currentValue ?? 0).slice(0, 8);
    const trendPct = (curr: number, prev: number) =>
      prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;

    const layerKpis = {
      avgClassOccupancy: parseFloat(Number(currOcc).toFixed(2)),
      averageClassSize: parseFloat(Number(currSize).toFixed(2)),
      revenuePerClass: parseFloat(Number(currRev).toFixed(2)),
      cancellationRate: parseFloat(Number(currCanc).toFixed(2)),
      capacityUtilization: parseFloat(Number(currUtil).toFixed(2)),
    };
    const layerTrends = {
      avgClassOccupancy: parseFloat(
        trendPct(currOcc as number, prevOcc as number).toFixed(1)
      ),
      revenuePerClass: parseFloat(
        trendPct(currRev as number, prevRev as number).toFixed(1)
      ),
      cancellationRate: parseFloat(
        trendPct(currCanc as number, prevCanc as number).toFixed(1)
      ),
    };

    return jsonNoStore({
      kpis: { ...layerKpis, noShowRate: parseFloat(noShowRate.toFixed(2)) },
      trends: layerTrends,
      topPerformingClasses: topPerformingClasses,
      occupancyByType: occupancyByTypeArray,
      hourlyUtilization: {
        weekday: hourlyWeekday,
        weekend: hourlyWeekend,
      },
    });
  } catch (err) {
    console.error(
      "[api/analytics/fitness-studio/classes-utilization] Unexpected error:",
      err
    );
    return jsonNoStore({ kpis: {}, topClasses: [], bottomClasses: [] });
  }
}
