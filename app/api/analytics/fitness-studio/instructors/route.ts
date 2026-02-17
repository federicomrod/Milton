import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonNoStore(data: Record<string, unknown>) {
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return jsonNoStore({ error: "Unauthorized" });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return jsonNoStore({ error: "Company not found" });
    }

    const searchParams = req.nextUrl.searchParams;
    const fromDateStr = searchParams.get("from_date");
    const toDateStr = searchParams.get("to_date");

    if (!fromDateStr || !toDateStr) {
      return jsonNoStore({ error: "Missing date parameters" });
    }

    const fromDateStart = new Date(fromDateStr);
    fromDateStart.setHours(0, 0, 0, 0);
    const toDateEnd = new Date(toDateStr);
    toDateEnd.setHours(23, 59, 59, 999);

    // Fetch all model_data with pagination
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
        console.error("[instructors] Error fetching model_data:", result.error);
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
    const transactionsData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "transactions"
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

    // Get field names from data_tables definitions
    const bookingsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "bookings"
    );
    const classesTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "classes"
    );
    const instructorsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "instructors"
    );

    const bookingsFields = bookingsTableId
      ? tableFieldsMap[bookingsTableId]?.fields || []
      : [];
    const classesFields = classesTableId
      ? tableFieldsMap[classesTableId]?.fields || []
      : [];
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

    // Find field names for bookings
    const bookingClassIdField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("class") &&
        f.name.toLowerCase().includes("id")
    )?.name;
    const bookingPriceField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("price") ||
        f.name.toLowerCase().includes("amount")
    )?.name;
    const bookingInstructorIdField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("instructor") &&
        f.name.toLowerCase().includes("id")
    )?.name;
    const bookingStatusField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("status") ||
        f.name.toLowerCase().includes("attendance")
    )?.name;

    // Find field names for classes
    const classIdField = classesFields.find(
      (f) =>
        f.name.toLowerCase().includes("class") &&
        (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
    )?.name;
    const classNameField = classesFields.find(
      (f) =>
        f.name.toLowerCase().includes("name") ||
        f.name.toLowerCase().includes("type")
    )?.name;
    const classInstructorIdField = classesFields.find(
      (f) =>
        f.name.toLowerCase().includes("instructor") &&
        f.name.toLowerCase().includes("id")
    )?.name;
    const classCapacityField = classesFields.find((f) =>
      f.name.toLowerCase().includes("capacity")
    )?.name;
    const classDateField = classesFields.find(
      (f) =>
        f.name.toLowerCase().includes("time") ||
        f.name.toLowerCase().includes("date") ||
        f.name.toLowerCase().includes("starting")
    )?.name;

    // Find field names for instructors
    const instructorIdField = instructorsFields.find(
      (f) =>
        f.name.toLowerCase().includes("instructor") &&
        (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
    )?.name;
    const instructorNameField = instructorsFields.find((f) =>
      f.name.toLowerCase().includes("name")
    )?.name;

    // Helper function to parse dates
    const parseDate = (dateStr: any): Date | null => {
      if (!dateStr) return null;
      if (dateStr instanceof Date) return dateStr;
      if (typeof dateStr === "number") return new Date(dateStr);
      const str = String(dateStr).trim();
      if (!str) return null;

      // Try YYYY-MM-DD HH:mm:ss format (with space separator)
      if (str.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
        return new Date(str.replace(" ", "T"));
      }

      // Try YYYY-MM-DD format (date only)
      if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return new Date(str + "T00:00:00");
      }

      // Try YYYY-MM-DD format (with other characters after)
      if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
        return new Date(str.split(" ")[0] + "T00:00:00");
      }

      // Try MM/DD/YY format first
      const mmddyyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (mmddyyMatch) {
        const [, month, day, year] = mmddyyMatch;
        const fullYear =
          parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
        return new Date(fullYear, parseInt(month) - 1, parseInt(day));
      }

      // Try YYYY-MM-DD format
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return new Date(str);
      }

      // Try other formats
      const parsed = new Date(str);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    // Normalize instructors
    const instructorMap = new Map();
    instructors.forEach((i: any) => {
      const instructorId =
        i.instructor_id ||
        i.id ||
        i["Instructor ID"] ||
        i.instructorId ||
        i["ID"];
      if (instructorId) {
        const normalized = {
          instructor_id: instructorId,
          name:
            i.name ||
            i.instructor_name ||
            i["Instructor Name"] ||
            i["Name"] ||
            "Unknown",
          email: i.email || i["Email"] || "",
          specialization:
            i.specialization ||
            i["Specialization"] ||
            i.type ||
            i["Type"] ||
            "",
          hourly_rate:
            typeof i.hourly_rate === "string"
              ? parseFloat(i.hourly_rate)
              : i.hourly_rate ||
                (typeof i["Hourly Rate"] === "string"
                  ? parseFloat(i["Hourly Rate"])
                  : i["Hourly Rate"]) ||
                0,
          _original: i,
        };
        instructorMap.set(instructorId, normalized);
      }
    });

    // Normalize classes - use actual field names from data_tables
    const classMap = new Map();
    classes.forEach((c: any) => {
      const classId = classIdField
        ? getFieldValue(c, classIdField, ["id", "class_id", "Class ID"])
        : c.id || c.class_id || c["Class ID"] || c.classId;
      if (classId) {
        const className = classNameField
          ? getFieldValue(c, classNameField, [
              "class_name",
              "Class Name",
              "name",
              "type",
            ]) || "Unknown"
          : c.class_name ||
            c["Class Name"] ||
            c.className ||
            c.name ||
            c.Name ||
            "Unknown";

        const instructorId = classInstructorIdField
          ? getFieldValue(c, classInstructorIdField, [
              "instructor_id",
              "Instructor ID",
              "instructor",
            ]) || ""
          : c.instructor_id ||
            c["Instructor ID"] ||
            c.instructorId ||
            c.instructor ||
            c["Instructor"] ||
            "";

        const capacity = classCapacityField
          ? getFieldValue(c, classCapacityField, ["capacity", "Capacity"]) || 0
          : c.capacity || c.Capacity || c["Capacity"] || 0;

        const date = classDateField
          ? getFieldValue(c, classDateField, [
              "Class Starting Time",
              "class_start_at",
              "Date & Time",
              "date_time",
              "date",
            ]) || ""
          : c.class_start_at ||
            c.date_time ||
            c.date ||
            c["Class Date"] ||
            c["Date"] ||
            c["Date & Time"] ||
            c.start_date ||
            c["Start Date"] ||
            "";

        const normalized = {
          class_id: classId,
          class_name: className,
          instructor_id: instructorId,
          capacity,
          date,
          _original: c,
        };
        classMap.set(classId, normalized);
      }
    });

    // Normalize bookings - use actual field names from data_tables
    const normalizedBookings = bookings.map((b: any) => {
      const classId = bookingClassIdField
        ? getFieldValue(b, bookingClassIdField, ["class_id", "Class ID"])
        : b.class_id || b["Class ID"] || b.classId || b.class || b["Class"];
      const classData = classId ? classMap.get(classId) : null;

      // Try multiple field names for price
      const pricePaidRaw = bookingPriceField
        ? getFieldValue(b, bookingPriceField, [
            "price_paid",
            "Price Paid",
            "price",
            "Price",
          ])
        : b.price_paid || b["Price Paid"] || b.price || b["Price"] || 0;
      const price_paid =
        typeof pricePaidRaw === "string"
          ? parseFloat(pricePaidRaw)
          : pricePaidRaw || 0;

      const statusRaw = bookingStatusField
        ? getFieldValue(b, bookingStatusField, [
            "status",
            "Status",
            "Attendance Status",
          ]) || ""
        : b.status ||
          b["Status"] ||
          b.attendance_status ||
          b["Attendance Status"] ||
          "";

      const bookingDateField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") ||
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("&")
      )?.name;
      const classStartAt = bookingDateField
        ? getFieldValue(b, bookingDateField, [
            "Date & Time",
            "date_time",
            "class_start_at",
            "booking_time",
            "date",
          ]) || (classData ? classData.date : null)
        : b.class_start_at ||
          b.booking_time ||
          b.date ||
          b["Class Date"] ||
          b["Date"] ||
          b["Date & Time"] ||
          (classData ? classData.date : null);

      return {
        booking_id: b.id || b.booking_id || b["Booking ID"] || b.bookingId,
        class_id: classId,
        member_id:
          b.member_id ||
          b["Member ID"] ||
          b.memberId ||
          b.member ||
          b["Member"],
        status: String(statusRaw).toLowerCase().trim(),
        price_paid,
        class_start_at: classStartAt,
        _original: b,
      };
    });

    // Filter bookings by date range
    const bookingsInRange = normalizedBookings.filter((b: any) => {
      if (!b.class_start_at) return false;
      const startAt = parseDate(b.class_start_at);
      if (!startAt) return false;
      return startAt >= fromDateStart && startAt <= toDateEnd;
    });

    // Calculate instructor metrics
    const instructorMetrics = new Map<
      string,
      {
        instructor_id: string;
        name: string;
        revenue: number;
        classesTaught: number;
        totalBookings: number;
        attendedBookings: number;
        cancelledBookings: number;
        totalCapacity: number;
        totalFilled: number;
      }
    >();

    // Initialize all instructors
    instructorMap.forEach((instructor, instructorId) => {
      instructorMetrics.set(instructorId, {
        instructor_id: instructorId,
        name: instructor.name,
        revenue: 0,
        classesTaught: 0,
        totalBookings: 0,
        attendedBookings: 0,
        cancelledBookings: 0,
        totalCapacity: 0,
        totalFilled: 0,
      });
    });

    // Process bookings to calculate metrics
    const classOccurrencesByInstructor = new Map<
      string,
      Map<string, { filled: number; capacity: number }>
    >();

    let bookingsWithoutInstructor = 0;
    let bookingsWithRevenue = 0;
    let totalRevenueFound = 0;

    bookingsInRange.forEach((b: any) => {
      const classData = classMap.get(b.class_id);
      if (!classData) return;

      // Check for instructor_id in booking first, then fall back to class
      const instructorId =
        b.instructor_id ||
        b["Instructor ID"] ||
        b.instructorId ||
        b["Instructor"] ||
        classData.instructor_id;

      if (!instructorId || !instructorMap.has(instructorId)) {
        bookingsWithoutInstructor++;
        return;
      }

      const metrics = instructorMetrics.get(instructorId)!;

      // Count bookings
      metrics.totalBookings += 1;
      if (b.status === "attended" || b.status === "booked") {
        metrics.attendedBookings += 1;
        // Add revenue - check multiple sources
        let revenue = b.price_paid || 0;

        // If no price in normalized booking, check original booking data
        if (revenue === 0 && b._original) {
          const orig = b._original;
          revenue =
            (typeof orig.price_paid === "string"
              ? parseFloat(orig.price_paid)
              : orig.price_paid) ||
            (typeof orig["Price Paid"] === "string"
              ? parseFloat(orig["Price Paid"])
              : orig["Price Paid"]) ||
            (typeof orig.price === "string"
              ? parseFloat(orig.price)
              : orig.price) ||
            (typeof orig["Price"] === "string"
              ? parseFloat(orig["Price"])
              : orig["Price"]) ||
            0;
        }

        // If still no price, try to get it from the class
        if (revenue === 0 && classData._original) {
          const classPrice =
            classData._original.price ||
            classData._original["Price"] ||
            classData._original.class_price ||
            classData._original["Class Price"] ||
            classData._original.amount ||
            classData._original["Amount"] ||
            0;
          if (typeof classPrice === "string") {
            revenue = parseFloat(classPrice) || 0;
          } else {
            revenue = classPrice || 0;
          }
        }

        metrics.revenue += revenue;
        if (revenue > 0) {
          bookingsWithRevenue++;
          totalRevenueFound += revenue;
        }
      } else if (b.status === "cancelled") {
        metrics.cancelledBookings += 1;
      }

      // Track class occurrences for occupancy
      const startAtStr = b.class_start_at;
      if (!startAtStr) return;

      if (!classOccurrencesByInstructor.has(instructorId)) {
        classOccurrencesByInstructor.set(instructorId, new Map());
      }
      const occurrences = classOccurrencesByInstructor.get(instructorId)!;
      const key = `${b.class_id}_${startAtStr}`;

      if (!occurrences.has(key)) {
        occurrences.set(key, {
          filled: 0,
          capacity: classData.capacity || 0,
        });
        metrics.classesTaught += 1;
        metrics.totalCapacity += classData.capacity || 0;
      }

      const occurrence = occurrences.get(key)!;
      if (b.status === "attended" || b.status === "booked") {
        occurrence.filled += 1;
        metrics.totalFilled += 1;
      }
    });

    console.log(`[instructors] Revenue calculation summary:`, {
      totalBookingsInRange: bookingsInRange.length,
      bookingsWithoutInstructor,
      bookingsWithRevenue,
      totalRevenueFound,
      sampleBooking: bookingsInRange[0]
        ? {
            class_id: bookingsInRange[0].class_id,
            price_paid: bookingsInRange[0].price_paid,
            status: bookingsInRange[0].status,
            originalKeys: Object.keys(bookingsInRange[0]._original || {}),
            originalPriceFields: bookingsInRange[0]._original
              ? {
                  price_paid: bookingsInRange[0]._original.price_paid,
                  "Price Paid": bookingsInRange[0]._original["Price Paid"],
                  price: bookingsInRange[0]._original.price,
                  Price: bookingsInRange[0]._original["Price"],
                }
              : null,
            classPrice: classMap.get(bookingsInRange[0].class_id)?._original
              ? {
                  price: classMap.get(bookingsInRange[0].class_id)?._original
                    .price,
                  Price: classMap.get(bookingsInRange[0].class_id)?._original[
                    "Price"
                  ],
                }
              : null,
          }
        : null,
    });

    // Check if we have revenue data from bookings
    const hasRevenueData = totalRevenueFound > 0;

    // If no revenue from bookings, try to attribute from transactions
    // This is a fallback - we'll use attendance as primary metric if revenue is missing
    if (!hasRevenueData) {
      console.log(
        `[instructors] No revenue found in bookings, checking transactions...`
      );
      transactions.forEach((tx: any) => {
        const amount =
          typeof tx.amount === "string"
            ? parseFloat(tx.amount)
            : tx.amount || 0;
        if (amount > 0) {
          // Try to match transaction to instructor via description or other fields
          // This is a simplified approach - in reality, you'd need better attribution
          const description = (
            tx.description ||
            tx["Description"] ||
            ""
          ).toLowerCase();
          // For now, we'll skip transaction attribution and rely on booking revenue
        }
      });
    }

    // Calculate KPIs for each instructor
    const instructorRankings = Array.from(instructorMetrics.values())
      .map((metrics) => {
        const avgOccupancy =
          metrics.totalCapacity > 0
            ? (metrics.totalFilled / metrics.totalCapacity) * 100
            : 0;

        const cancellationRate =
          metrics.totalBookings > 0
            ? (metrics.cancelledBookings / metrics.totalBookings) * 100
            : 0;

        // If no revenue, use attendance as fallback metric
        const revenueMetric = hasRevenueData
          ? metrics.revenue
          : metrics.attendedBookings;

        return {
          instructor_id: metrics.instructor_id,
          name: metrics.name,
          revenue: parseFloat(metrics.revenue.toFixed(2)),
          revenueMetric: parseFloat(revenueMetric.toFixed(2)),
          classesTaught: metrics.classesTaught,
          avgOccupancy: parseFloat(avgOccupancy.toFixed(2)),
          cancellationRate: parseFloat(cancellationRate.toFixed(2)),
          totalBookings: metrics.totalBookings,
          attendedBookings: metrics.attendedBookings,
          hasRevenueData,
        };
      })
      .filter((i) => i.classesTaught > 0) // Only show instructors who taught classes
      .sort((a, b) => {
        // Sort by revenue (or attendance if no revenue) first, then by occupancy
        if (Math.abs(a.revenueMetric - b.revenueMetric) > 10) {
          return b.revenueMetric - a.revenueMetric;
        }
        return b.avgOccupancy - a.avgOccupancy;
      });

    // Calculate aggregate KPIs
    const totalInstructors = instructorRankings.length;
    const totalRevenue = instructorRankings.reduce(
      (sum, i) => sum + i.revenue,
      0
    );
    const totalClassesTaught = instructorRankings.reduce(
      (sum, i) => sum + i.classesTaught,
      0
    );
    const totalBookings = instructorRankings.reduce(
      (sum, i) => sum + i.totalBookings,
      0
    );
    const totalCancelled = instructorRankings.reduce(
      (sum, i) => sum + (i.totalBookings - i.attendedBookings),
      0
    );

    const avgRevenuePerInstructor =
      totalInstructors > 0 ? totalRevenue / totalInstructors : 0;

    const totalOccupancySum = instructorRankings.reduce(
      (sum, i) => sum + i.avgOccupancy,
      0
    );
    const avgClassOccupancy =
      totalInstructors > 0 ? totalOccupancySum / totalInstructors : 0;

    const avgCancellationRate =
      totalBookings > 0 ? (totalCancelled / totalBookings) * 100 : 0;

    // Prepare chart data (top 5 and bottom 5 by classes taught)
    const sortedByClasses = [...instructorRankings].sort(
      (a, b) => b.classesTaught - a.classesTaught
    );
    const top5 = sortedByClasses.slice(0, 5);
    const bottom5 = sortedByClasses.slice(-5).reverse();

    const chartData = [
      ...top5.map((i) => ({
        name: i.name,
        classes: i.classesTaught,
        type: "Top 5",
      })),
      ...bottom5.map((i) => ({
        name: i.name,
        classes: i.classesTaught,
        type: "Bottom 5",
      })),
    ];

    return jsonNoStore({
      kpis: {
        revenuePerInstructor: parseFloat(avgRevenuePerInstructor.toFixed(2)),
        avgClassOccupancy: parseFloat(avgClassOccupancy.toFixed(2)),
        classesTaught: totalClassesTaught,
        cancellationRate: parseFloat(avgCancellationRate.toFixed(2)),
      },
      rankings: instructorRankings,
      chartData,
      hasRevenueData,
    });
  } catch (error) {
    console.error("[instructors] Error:", error);
    return jsonNoStore({
      error: "Failed to fetch instructors analytics",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
