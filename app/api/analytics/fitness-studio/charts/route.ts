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

function generateDays(fromDate: Date, toDate: Date): string[] {
  const days: string[] = [];
  const current = new Date(fromDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    days.push(current.toISOString().split("T")[0]); // YYYY-MM-DD
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function isSingleMonth(fromDate: Date, toDate: Date): boolean {
  const fromMonth = fromDate.getMonth();
  const fromYear = fromDate.getFullYear();
  const toMonth = toDate.getMonth();
  const toYear = toDate.getFullYear();

  // Check if both dates are in the same month
  return fromYear === toYear && fromMonth === toMonth;
}

function parseDate(dateStr: any): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  if (typeof dateStr !== "string") return null;

  // Try YYYY-MM-DD HH:mm:ss format (with space separator)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
    // Convert space to T for ISO format
    return new Date(dateStr.replace(" ", "T"));
  }

  // Try YYYY-MM-DD format (date only)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateStr + "T00:00:00");
  }

  // Try YYYY-MM-DD format (with other characters after)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    // Try parsing as-is first (might have time)
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    // Fallback to date only
    return new Date(dateStr.split(" ")[0] + "T00:00:00");
  }

  // Try MM/DD/YY or MM/DD/YYYY format
  if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const month = parseInt(parts[0]) - 1;
      const day = parseInt(parts[1]);
      let year = parseInt(parts[2]);

      // Handle 2-digit years
      if (year < 50) {
        year += 2000; // 00-49 -> 2000-2049
      } else if (year < 100) {
        year += 1900; // 50-99 -> 1950-1999
      }
      // If year is already 4 digits, use as-is

      const parsed = new Date(year, month, day);
      // Validate the date was parsed correctly
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
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
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

          // Handle both lowercase and capitalized field names
          const active = members.filter((m: any) => {
            const joinDateStr =
              m.join_date || m.joinDate || m["Join Date"] || m["join_date"];
            const cancelDateStr =
              m.cancel_date ||
              m.cancelDate ||
              m["Cancel Date"] ||
              m["cancel_date"];
            const joinDate = joinDateStr ? parseDate(joinDateStr) : null;
            const cancelDate = cancelDateStr ? parseDate(cancelDateStr) : null;
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
        // Chart 2: New vs Churned Members
        // Use daily data if single month, otherwise monthly
        const useDaily = isSingleMonth(from, to);
        const periods = useDaily
          ? generateDays(from, to)
          : generateMonths(from, to);

        chartData = periods.map((period) => {
          let periodStart: Date;
          let periodEnd: Date;

          if (useDaily) {
            periodStart = new Date(period);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd = new Date(period);
            periodEnd.setHours(23, 59, 59, 999);
          } else {
            periodStart = new Date(period + "-01");
            periodEnd = new Date(period + "-01");
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          // Handle both lowercase and capitalized field names
          const newMembers = members.filter((m: any) => {
            const joinDateStr =
              m.join_date || m.joinDate || m["Join Date"] || m["join_date"];
            const joinDate = joinDateStr ? parseDate(joinDateStr) : null;
            if (!joinDate) return false;
            return joinDate >= periodStart && joinDate <= periodEnd;
          }).length;

          const churned = members.filter((m: any) => {
            const cancelDateStr =
              m.cancel_date ||
              m.cancelDate ||
              m["Cancel Date"] ||
              m["cancel_date"];
            const cancelDate = cancelDateStr ? parseDate(cancelDateStr) : null;
            if (!cancelDate) return false;
            return cancelDate >= periodStart && cancelDate <= periodEnd;
          }).length;

          return {
            period: period,
            new_members: newMembers,
            churned_members: churned,
          };
        });
        break;
      }

      case "revenue-per-member": {
        // Chart 4: Revenue per Member Trend (ARPM)
        // Use daily data if single month, otherwise monthly
        const useDaily = isSingleMonth(from, to);
        const periods = useDaily
          ? generateDays(from, to)
          : generateMonths(from, to);

        chartData = periods.map((period) => {
          let periodStart: Date;
          let periodEnd: Date;
          let periodEndForMembers: Date;

          if (useDaily) {
            periodStart = new Date(period);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd = new Date(period);
            periodEnd.setHours(23, 59, 59, 999);
            periodEndForMembers = new Date(periodEnd);
          } else {
            periodStart = new Date(period + "-01");
            periodEnd = new Date(period + "-01");
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            periodEndForMembers = new Date(periodEnd);
            periodEndForMembers.setDate(0);
            periodEndForMembers.setHours(23, 59, 59, 999);
          }

          // Active members at end of period
          // Handle both lowercase and capitalized field names
          const activeMembers = members.filter((m: any) => {
            const joinDateStr =
              m.join_date || m.joinDate || m["Join Date"] || m["join_date"];
            const cancelDateStr =
              m.cancel_date ||
              m.cancelDate ||
              m["Cancel Date"] ||
              m["cancel_date"];
            const joinDate = joinDateStr ? parseDate(joinDateStr) : null;
            const cancelDate = cancelDateStr ? parseDate(cancelDateStr) : null;
            if (!joinDate) return false;
            return (
              joinDate <= periodEndForMembers &&
              (!cancelDate || cancelDate > periodEndForMembers)
            );
          }).length;

          // Revenue in period
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
                date >= periodStart &&
                date <= periodEnd
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
            period: period,
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
        // Get field names from data_tables definitions
        const classesTableId = Object.keys(idToNameMap).find(
          (id) => idToNameMap[id] === "classes"
        );
        const bookingsTableId = Object.keys(idToNameMap).find(
          (id) => idToNameMap[id] === "bookings"
        );

        const classesFields = classesTableId
          ? tableFieldsMap[classesTableId]?.fields || []
          : [];
        const bookingsFields = bookingsTableId
          ? tableFieldsMap[bookingsTableId]?.fields || []
          : [];

        console.log(
          `[utilization-heatmap] Classes fields:`,
          classesFields.map((f) => f.name)
        );
        console.log(
          `[utilization-heatmap] Bookings fields:`,
          bookingsFields.map((f) => f.name)
        );

        // Helper to get field value with fallback
        const getFieldValue = (
          obj: any,
          fieldName: string,
          fallbacks: string[] = []
        ): any => {
          // Try exact match first
          if (obj[fieldName] !== undefined) return obj[fieldName];
          // Try case-insensitive match
          const lowerFieldName = fieldName.toLowerCase();
          for (const key in obj) {
            if (key.toLowerCase() === lowerFieldName) {
              return obj[key];
            }
          }
          // Try fallbacks
          for (const fallback of fallbacks) {
            if (obj[fallback] !== undefined) return obj[fallback];
          }
          return undefined;
        };

        // Normalize class data - use actual field names from data_tables
        const normalizeClass = (c: any) => {
          // Find class_id field
          const classIdField = classesFields.find(
            (f) =>
              f.name.toLowerCase().includes("class") &&
              (f.name.toLowerCase().includes("id") ||
                f.name.toLowerCase() === "id")
          )?.name;
          const classId = classIdField
            ? getFieldValue(c, classIdField, ["id", "class_id", "Class ID"])
            : c.id || c.class_id || c["Class ID"];

          // Find capacity field
          const capacityField = classesFields.find((f) =>
            f.name.toLowerCase().includes("capacity")
          )?.name;
          const capacity = capacityField
            ? getFieldValue(c, capacityField, ["capacity", "Capacity"]) || 0
            : c.capacity || c.Capacity || c["Capacity"] || 0;

          // Find date/time field - look for date, time, or datetime fields
          const dateTimeField = classesFields.find(
            (f) =>
              f.name.toLowerCase().includes("time") ||
              f.name.toLowerCase().includes("date") ||
              f.name.toLowerCase().includes("starting")
          )?.name;
          const classStartAt = dateTimeField
            ? getFieldValue(c, dateTimeField, [
                "class_start_at",
                "Class Starting Time",
                "Date & Time",
                "date_time",
              ])
            : c["Class Starting Time"] ||
              c.class_start_at ||
              c["Date & Time"] ||
              c.date_time;

          return { classId, capacity, classStartAt };
        };

        // Normalize booking data - use actual field names from data_tables
        const normalizeBooking = (b: any) => {
          // Find class_id field
          const classIdField = bookingsFields.find(
            (f) =>
              f.name.toLowerCase().includes("class") &&
              (f.name.toLowerCase().includes("id") ||
                f.name.toLowerCase() === "id")
          )?.name;
          const classId = classIdField
            ? getFieldValue(b, classIdField, ["class_id", "Class ID"])
            : b.class_id || b["Class ID"];

          // Find status field
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
            : b.status || b["Status"] || b["Attendance Status"] || "";

          // Find date/time field
          const dateTimeField = bookingsFields.find(
            (f) =>
              f.name.toLowerCase().includes("time") ||
              f.name.toLowerCase().includes("date") ||
              f.name.toLowerCase().includes("&")
          )?.name;
          const bookingDate = dateTimeField
            ? getFieldValue(b, dateTimeField, [
                "Date & Time",
                "date_time",
                "class_start_at",
                "booking_time",
              ])
            : b["Date & Time"] ||
              b.date_time ||
              b.class_start_at ||
              b.booking_time;

          return { classId, status, bookingDate };
        };

        // Create a map of class_id -> class data (including date/time and capacity)
        const classMap = new Map();
        classes.forEach((c: any) => {
          const normalized = normalizeClass(c);
          if (!normalized.classId) return;

          // Use parseDate to handle various date formats
          const classStartAt = normalized.classStartAt
            ? parseDate(normalized.classStartAt)
            : null;

          // Store class data even if no date (we'll get date from bookings)
          classMap.set(String(normalized.classId), {
            capacity: normalized.capacity,
            startAt: classStartAt,
            date: normalized.classStartAt, // Keep original date string for fallback
          });
        });

        console.log(
          `[utilization-heatmap] Created classMap with ${classMap.size} classes (${Array.from(classMap.values()).filter((c) => c.startAt).length} with dates)`
        );

        // Debug: show sample class structure
        if (classes.length > 0) {
          console.log(
            `[utilization-heatmap] Sample class keys:`,
            Object.keys(classes[0])
          );
          console.log(`[utilization-heatmap] Sample class:`, {
            id: classes[0].id || classes[0].class_id || classes[0]["Class ID"],
            dateFields: {
              class_start_at: classes[0].class_start_at,
              date_time: classes[0].date_time,
              date: classes[0].date,
              "Class Date": classes[0]["Class Date"],
              "Class Starting Time": classes[0]["Class Starting Time"],
              "Date & Time": classes[0]["Date & Time"],
            },
          });
        }

        // Debug: show sample booking structure
        if (bookings.length > 0) {
          console.log(
            `[utilization-heatmap] Sample booking keys:`,
            Object.keys(bookings[0])
          );
          console.log(`[utilization-heatmap] Sample booking:`, {
            class_id: bookings[0].class_id || bookings[0]["Class ID"],
            dateFields: {
              class_start_at: bookings[0].class_start_at,
              booking_time: bookings[0].booking_time,
              date: bookings[0].date,
              "Class Date": bookings[0]["Class Date"],
              "Booking Time": bookings[0]["Booking Time"],
              Date: bookings[0]["Date"],
              "Date & Time": bookings[0]["Date & Time"],
            },
          });
        }

        // Filter bookings and get their class date/time (from booking first, then class)
        const bookingsInRange = bookings.filter((b: any) => {
          const normalized = normalizeBooking(b) as {
            classId: any;
            status: any;
            bookingDate?: any;
          };
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
            // Use parseDate to handle various date formats
            const classStartAt = normalizedMatching.classStartAt
              ? parseDate(normalizedMatching.classStartAt)
              : null;

            classData = {
              capacity: normalizedMatching.capacity,
              startAt: classStartAt,
              date: normalizedMatching.classStartAt,
            };
            classMap.set(String(normalizedMatching.classId), classData);
          }

          // Try to get date from booking first, then from class
          let startAt: Date | null = null;

          if (normalized.bookingDate) {
            startAt = parseDate(normalized.bookingDate);
          }

          // If booking doesn't have date, try class date
          if (!startAt && classData.date) {
            startAt = parseDate(classData.date);
          }

          // If still no date, use classData.startAt (already parsed)
          if (!startAt && classData.startAt) {
            startAt = classData.startAt;
          }

          if (!startAt || isNaN(startAt.getTime())) {
            if (bookingsInRange.length < 3) {
              console.log(
                `[utilization-heatmap] Booking date parsing failed:`,
                {
                  bookingDate: normalized.bookingDate,
                  classDate: classData.date,
                  classStartAt: classData.startAt,
                }
              );
            }
            return false;
          }

          const from = new Date(fromDate + "T00:00:00");
          from.setHours(0, 0, 0, 0);
          const to = new Date(toDate + "T23:59:59");
          to.setHours(23, 59, 59, 999);

          const inRange = startAt >= from && startAt <= to;
          return inRange;
        });

        console.log(
          `[utilization-heatmap] Found ${bookingsInRange.length} bookings in range (from ${fromDate} to ${toDate})`
        );

        // First, group bookings by class occurrence (class_id + date/time)
        // This ensures we count capacity only once per class occurrence
        const classOccurrences = new Map<
          string,
          { filled: number; capacity: number; weekday: number; hour: number }
        >();

        bookingsInRange.forEach((b: any) => {
          const normalized = normalizeBooking(b) as {
            classId: any;
            status: any;
            bookingDate?: any;
          };
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

          if (!classData) return;

          // Get date from booking first, then class
          let startAt: Date | null = null;

          if (normalized.bookingDate) {
            startAt = parseDate(normalized.bookingDate);
          }

          if (!startAt && classData.date) {
            startAt = parseDate(classData.date);
          }

          if (!startAt && classData.startAt) {
            startAt = classData.startAt;
          }

          if (!startAt || isNaN(startAt.getTime())) return;

          // JavaScript getDay() returns 0 (Sun) to 6 (Sat)
          // SQL ISODOW returns 1 (Mon) to 7 (Sun)
          // Convert: 0 (Sun) -> 7, 1 (Mon) -> 1, ..., 6 (Sat) -> 6
          const jsDay = startAt.getDay();
          const weekday = jsDay === 0 ? 7 : jsDay;
          const hour = startAt.getHours();

          // Create a unique key for this class occurrence (class_id + date/time)
          const occurrenceKey = `${normalized.classId}_${startAt.toISOString()}`;

          if (!classOccurrences.has(occurrenceKey)) {
            classOccurrences.set(occurrenceKey, {
              filled: 0,
              capacity: classData.capacity || 0,
              weekday,
              hour,
            });
          }

          const occurrence = classOccurrences.get(occurrenceKey)!;
          const bookingStatus = normalized.status.toLowerCase();
          if (bookingStatus === "booked" || bookingStatus === "attended") {
            occurrence.filled += 1;
          }
        });

        // Now aggregate by weekday and hour
        const heatmapData: Record<
          string,
          { booked: number; capacity: number; occurrences: number }
        > = {};

        classOccurrences.forEach((occurrence) => {
          const key = `${occurrence.weekday}-${occurrence.hour}`;

          if (!heatmapData[key]) {
            heatmapData[key] = { booked: 0, capacity: 0, occurrences: 0 };
          }

          // Sum up filled spots and capacity across all occurrences
          heatmapData[key].booked += occurrence.filled;
          heatmapData[key].capacity += occurrence.capacity;
          heatmapData[key].occurrences += 1;
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

        console.log(
          `[utilization-heatmap] Generated ${chartData.length} heatmap data points`
        );
        if (chartData.length === 0) {
          console.log(
            `[utilization-heatmap] No heatmap data - classes: ${classes.length}, bookings: ${bookings.length}, bookingsInRange: ${bookingsInRange.length}, classMap size: ${classMap.size}`
          );
        }
        break;
      }

      case "occupancy-trend": {
        // Chart: Occupancy Trend (Average Class Occupancy over time)
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

        // Use daily data if single month, otherwise monthly
        const useDaily = isSingleMonth(from, to);
        const periods = useDaily
          ? generateDays(from, to)
          : generateMonths(from, to);

        chartData = periods.map((period) => {
          let periodStart: Date;
          let periodEnd: Date;

          if (useDaily) {
            periodStart = new Date(period);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd = new Date(period);
            periodEnd.setHours(23, 59, 59, 999);
          } else {
            periodStart = new Date(period + "-01");
            periodEnd = new Date(period + "-01");
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          // Get classes in this period
          const classesInPeriod = classes.filter((c: any) => {
            const normalized = normalizeClass(c);
            if (!normalized.classStartAt) return false;
            const classDate = new Date(normalized.classStartAt);
            return classDate >= periodStart && classDate <= periodEnd;
          });

          // Get bookings for these classes
          const classOccurrences = new Map<
            string,
            { filled: number; capacity: number }
          >();

          bookings.forEach((b: any) => {
            const normalized = normalizeBooking(b);
            if (!normalized.classId) return;

            // Find matching class
            const matchingClass = classesInPeriod.find((c: any) => {
              const normalizedClass = normalizeClass(c);
              return (
                normalizedClass.classId &&
                String(normalizedClass.classId).toLowerCase() ===
                  String(normalized.classId).toLowerCase()
              );
            });

            if (!matchingClass) return;

            const normalizedClass = normalizeClass(matchingClass);
            if (!normalizedClass.classStartAt) return;

            const classKey = `${normalized.classId}_${normalizedClass.classStartAt}`;

            if (!classOccurrences.has(classKey)) {
              classOccurrences.set(classKey, {
                filled: 0,
                capacity: normalizedClass.capacity || 0,
              });
            }

            const occurrence = classOccurrences.get(classKey)!;
            const status = (normalized.status || "").toLowerCase();
            if (status === "booked" || status === "attended") {
              occurrence.filled += 1;
            }
          });

          // Calculate average occupancy for this period
          let totalOccupancy = 0;
          let occurrenceCount = 0;

          classOccurrences.forEach((occ) => {
            if (occ.capacity > 0) {
              const occupancy = (occ.filled / occ.capacity) * 100;
              totalOccupancy += occupancy;
              occurrenceCount += 1;
            }
          });

          const avgOccupancy =
            occurrenceCount > 0
              ? parseFloat((totalOccupancy / occurrenceCount).toFixed(2))
              : 0;

          return {
            period: period,
            value: avgOccupancy,
            occupancy: avgOccupancy,
          };
        });
        break;
      }

      case "class-outcomes": {
        // Chart: Class Outcomes (stacked bar showing booked, attended, cancelled, no_show)
        // Normalize booking data
        const normalizeBooking = (b: any) => {
          const status =
            b.status ||
            b.attendance_status ||
            b["Attendance Status"] ||
            b["Status"] ||
            "";
          return { status: status.toLowerCase() };
        };

        // Count bookings by status
        const outcomes = {
          booked: 0,
          attended: 0,
          cancelled: 0,
          no_show: 0,
          noShow: 0,
        };

        bookings.forEach((b: any) => {
          const normalized = normalizeBooking(b);
          const status = normalized.status;

          if (status === "booked") {
            outcomes.booked += 1;
          } else if (status === "attended") {
            outcomes.attended += 1;
          } else if (status === "cancelled" || status === "canceled") {
            outcomes.cancelled += 1;
          } else if (
            status === "no_show" ||
            status === "no-show" ||
            status === "noshow"
          ) {
            outcomes.no_show += 1;
            outcomes.noShow += 1;
          }
        });

        chartData = [
          {
            status: "Booked",
            value: outcomes.booked,
          },
          {
            status: "Attended",
            value: outcomes.attended,
          },
          {
            status: "Cancelled",
            value: outcomes.cancelled,
          },
          {
            status: "No Show",
            value: outcomes.no_show + outcomes.noShow,
          },
        ];
        break;
      }

      case "top10-classes-occupancy": {
        // Chart: Top 10 Classes by Occupancy (horizontal bar)
        // Normalize class and booking data
        const normalizeClass = (c: any) => {
          const classId =
            c.id ||
            c.class_id ||
            c.classId ||
            c.class_ID ||
            c["Class ID"] ||
            c["classId"];
          const className =
            c.class_name ||
            c.name ||
            c["Class Name"] ||
            c["Name"] ||
            "Unknown Class";
          const capacity = c.capacity || c.Capacity || 0;
          return { classId, className, capacity };
        };

        const normalizeBooking = (b: any) => {
          const classId =
            b.class_id ||
            b.classId ||
            b.class_ID ||
            b.class ||
            b["Class ID"] ||
            "";
          const status =
            b.status ||
            b.attendance_status ||
            b["Attendance Status"] ||
            b["Status"] ||
            "";
          return { classId: String(classId), status: status.toLowerCase() };
        };

        // Calculate occupancy by class
        const classOccurrences = new Map<
          string,
          { filled: number; capacity: number; className: string }
        >();

        // First, build class map
        const classMap = new Map<
          string,
          { className: string; capacity: number }
        >();
        classes.forEach((c: any) => {
          const normalized = normalizeClass(c);
          if (normalized.classId) {
            classMap.set(String(normalized.classId), {
              className: normalized.className,
              capacity: normalized.capacity,
            });
          }
        });

        // Process bookings
        bookings.forEach((b: any) => {
          const normalized = normalizeBooking(b);
          if (!normalized.classId) return;

          const classData = classMap.get(normalized.classId);
          if (!classData) return;

          if (!classOccurrences.has(normalized.classId)) {
            classOccurrences.set(normalized.classId, {
              filled: 0,
              capacity: 0,
              className: classData.className,
            });
          }

          const occ = classOccurrences.get(normalized.classId)!;
          occ.capacity += classData.capacity;

          if (
            normalized.status === "booked" ||
            normalized.status === "attended"
          ) {
            occ.filled += 1;
          }
        });

        // Calculate occupancy and sort
        const classesWithOccupancy = Array.from(classOccurrences.entries())
          .map(([classId, occ]) => {
            const occupancy =
              occ.capacity > 0 ? (occ.filled / occ.capacity) * 100 : 0;
            return {
              class_id: classId,
              class_name: occ.className,
              occupancy: parseFloat(occupancy.toFixed(2)),
            };
          })
          .sort((a, b) => b.occupancy - a.occupancy)
          .slice(0, 10);

        chartData = classesWithOccupancy;
        break;
      }

      case "top10-classes-revenue": {
        // Chart: Top 10 Classes by Revenue (horizontal bar)
        // Normalize class and booking data
        const normalizeClass = (c: any) => {
          const classId =
            c.id ||
            c.class_id ||
            c.classId ||
            c.class_ID ||
            c["Class ID"] ||
            c["classId"];
          const className =
            c.class_name ||
            c.name ||
            c["Class Name"] ||
            c["Name"] ||
            "Unknown Class";
          return { classId, className };
        };

        const normalizeBooking = (b: any) => {
          const classId =
            b.class_id ||
            b.classId ||
            b.class_ID ||
            b.class ||
            b["Class ID"] ||
            "";
          const status =
            b.status ||
            b.attendance_status ||
            b["Attendance Status"] ||
            b["Status"] ||
            "";
          const pricePaid =
            typeof b.price_paid === "string"
              ? parseFloat(b.price_paid)
              : b.price_paid ||
                (typeof b.price === "string" ? parseFloat(b.price) : b.price) ||
                0;
          return {
            classId: String(classId),
            status: status.toLowerCase(),
            pricePaid,
          };
        };

        // Calculate revenue by class
        const revenueByClass = new Map<
          string,
          { revenue: number; className: string }
        >();

        // Build class map
        const classMap = new Map<string, string>();
        classes.forEach((c: any) => {
          const normalized = normalizeClass(c);
          if (normalized.classId) {
            classMap.set(String(normalized.classId), normalized.className);
          }
        });

        // Process bookings
        bookings.forEach((b: any) => {
          const normalized = normalizeBooking(b);
          if (!normalized.classId) return;

          const className = classMap.get(normalized.classId) || "Unknown Class";

          if (
            normalized.status === "booked" ||
            normalized.status === "attended"
          ) {
            if (!revenueByClass.has(normalized.classId)) {
              revenueByClass.set(normalized.classId, {
                revenue: 0,
                className,
              });
            }

            const classRev = revenueByClass.get(normalized.classId)!;
            classRev.revenue += normalized.pricePaid;
          }
        });

        // Sort by revenue and take top 10
        const topClasses = Array.from(revenueByClass.entries())
          .map(([classId, data]) => ({
            class_id: classId,
            class_name: data.className,
            revenue: parseFloat(data.revenue.toFixed(2)),
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10);

        chartData = topClasses;
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
