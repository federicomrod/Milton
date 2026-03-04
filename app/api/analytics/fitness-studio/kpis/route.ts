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
    const invoicesData = allModelData.filter(
      (row) => idToNameMap[row.model_table_id] === "invoices"
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

    const invoices: any[] = [];
    if (invoicesData) {
      for (const row of invoicesData) {
        const d = row.data as unknown;
        if (Array.isArray(d)) {
          invoices.push(...d);
        } else if (d && typeof d === "object") {
          invoices.push(d);
        }
      }
    }

    // Calculate KPIs using JavaScript (since we can't run raw SQL)
    // This is a simplified version - in production, you'd want to use RPC functions
    // or execute the SQL queries directly via Supabase

    // Helper function to parse dates in various formats (MM/DD/YY, YYYY-MM-DD, etc.)
    const parseDate = (dateStr: any): Date | null => {
      if (dateStr == null) return null;
      if (dateStr instanceof Date)
        return isNaN(dateStr.getTime()) ? null : dateStr;
      if (typeof dateStr === "number") {
        // Unix timestamp (ms) or Excel serial (days since 1899-12-30)
        if (dateStr > 1e12) return new Date(dateStr); // ms
        if (dateStr > 1000) return new Date((dateStr - 25569) * 86400 * 1000); // Excel serial
        return null;
      }
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
    // Handle both lowercase and capitalized field names
    const activeMembers = members.filter((m: any) => {
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    }).length;

    // KPI 2: New monthly members
    const newMembers = members.filter((m: any) => {
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
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
      // Handle both lowercase and capitalized field names
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );

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
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );
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
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );
      if (!joinDate || isNaN(joinDate.getTime())) return false;
      return (
        joinDate <= periodEnd &&
        (!cancelDate || isNaN(cancelDate.getTime()) || cancelDate > periodEnd)
      );
    }).length;

    // Per KPI definition: "members that left as % of members at the beginning of the window"
    const churnRate =
      activeMembersAtStart > 0
        ? (churnedMembers / activeMembersAtStart) * 100
        : activeMembersAtEnd > 0
          ? (churnedMembers / activeMembersAtEnd) * 100
          : 0;

    // KPI 5: Average Member Tenure (Months) - simplified
    const activeMembersWithTenure = members.filter((m: any) => {
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );
      if (!joinDate) return false;
      const now = new Date();
      return joinDate <= now && (!cancelDate || cancelDate > now);
    });

    const now = new Date();
    const avgTenure =
      activeMembersWithTenure.length > 0
        ? activeMembersWithTenure.reduce((sum: number, m: any) => {
            const joinDate = parseDate(
              m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
            );
            const cancelDate = parseDate(
              m.cancel_date ||
                m.cancelDate ||
                m["Cancel Date"] ||
                m["cancel_date"]
            );
            const endDate = cancelDate || now;
            if (!joinDate) return sum;
            const months =
              (endDate.getTime() - joinDate.getTime()) /
              (1000 * 60 * 60 * 24 * 30);
            return sum + months;
          }, 0) / activeMembersWithTenure.length
        : 0;

    // KPI 6: Revenue per Member (ARPM) – use data_tables field names for transactions
    const transactionsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "transactions"
    );
    const transactionsFields = transactionsTableId
      ? tableFieldsMap[transactionsTableId]?.fields || []
      : [];
    const getTxVal = (
      t: any,
      fieldName: string,
      fallbacks: string[] = []
    ): any => {
      if (t[fieldName] !== undefined) return t[fieldName];
      const lower = fieldName.toLowerCase();
      for (const k in t) {
        if (k.toLowerCase() === lower) return t[k];
      }
      for (const f of fallbacks) {
        if (t[f] !== undefined) return t[f];
      }
      return undefined;
    };
    const txDateField = transactionsFields.find((f) =>
      f.name.toLowerCase().includes("date")
    )?.name;
    const txAmountField = transactionsFields.find(
      (f) =>
        f.name.toLowerCase().includes("amount") ||
        f.name.toLowerCase().includes("value") ||
        f.name.toLowerCase().includes("price")
    )?.name;
    const txCategoryField = transactionsFields.find(
      (f) =>
        f.name.toLowerCase().includes("category") ||
        f.name.toLowerCase().includes("type")
    )?.name;

    // Find the direction field (e.g. "Direction (inflow / outflow)")
    const txDirectionField = transactionsFields.find(
      (f) =>
        f.name.toLowerCase().includes("direction") ||
        f.name.toLowerCase() === "flow"
    )?.name;

    /**
     * Returns the direction of a transaction.
     * Handles uploaded data with an explicit direction field (e.g. "Direction (inflow / outflow)")
     * as well as legacy data that uses negative amounts for outflows.
     */
    const getTxDirection = (t: any): "inflow" | "outflow" | "unknown" => {
      const dirRaw = txDirectionField
        ? getTxVal(t, txDirectionField, [
            "direction",
            "Direction (inflow / outflow)",
          ])
        : (t["Direction (inflow / outflow)"] ?? t.direction ?? t.type ?? "");
      const dir = String(dirRaw || "").toLowerCase();
      if (
        dir.includes("outflow") ||
        dir === "out" ||
        dir === "expense" ||
        dir === "debit"
      )
        return "outflow";
      if (
        dir.includes("inflow") ||
        dir === "in" ||
        dir === "revenue" ||
        dir === "credit"
      )
        return "inflow";
      return "unknown";
    };

    const revenueTransactions = transactions.filter((t: any) => {
      const amountRaw = txAmountField
        ? getTxVal(t, txAmountField, ["amount", "Amount", "value", "Value"])
        : (t.amount ?? t.Amount ?? t.value ?? t.Value ?? 0);
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw)
          : Number(amountRaw) || 0;
      if (amount <= 0) return false;
      const dateRaw = txDateField
        ? getTxVal(t, txDateField, ["date", "Date", "payment_date"])
        : (t.date ?? t.Date ?? t.payment_date);
      const date = dateRaw ? parseDate(dateRaw) : null;
      if (!date || isNaN(date.getTime())) return false;
      const from = new Date(fromDate + "T00:00:00");
      const to = new Date(toDate + "T23:59:59");
      if (date < from || date > to) return false;
      const direction = getTxDirection(t);
      if (direction === "outflow") return false;
      // When direction is explicit, all inflows count as revenue.
      // When direction is unknown (legacy signed-amount data), require category.
      if (direction === "inflow") return true;
      const categoryRaw = txCategoryField
        ? getTxVal(t, txCategoryField, ["category", "Category", "type", "Type"])
        : (t.category ?? t.Category ?? "");
      const category = String(categoryRaw || "").toLowerCase();
      return (
        category.includes("membership") ||
        category.includes("drop-in") ||
        category.includes("class pack") ||
        category.includes("revenue")
      );
    });

    const totalRevenue = revenueTransactions.reduce((sum: number, t: any) => {
      const amountRaw = txAmountField
        ? getTxVal(t, txAmountField, ["amount", "Amount", "value", "Value"])
        : (t.amount ?? t.Amount ?? 0);
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw)
          : Number(amountRaw) || 0;
      return sum + amount;
    }, 0);

    const revenuePerMember =
      activeMembers > 0 ? totalRevenue / activeMembers : 0;

    // KPI 7: Utilization Rate (%)
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

    // Normalize class data - use actual field names from data_tables
    const normalizeClass = (c: any) => {
      const classIdField = classesFields.find(
        (f) =>
          f.name.toLowerCase().includes("class") &&
          (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
      )?.name;
      const classId = classIdField
        ? getFieldValue(c, classIdField, ["id", "class_id", "Class ID"])
        : c.id || c.class_id || c["Class ID"];

      const capacityField = classesFields.find((f) =>
        f.name.toLowerCase().includes("capacity")
      )?.name;
      const capacity = capacityField
        ? getFieldValue(c, capacityField, ["capacity", "Capacity"]) || 0
        : c.capacity || c.Capacity || c["Capacity"] || 0;

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
      const classIdField = bookingsFields.find(
        (f) =>
          f.name.toLowerCase().includes("class") &&
          (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
      )?.name;
      const classId = classIdField
        ? getFieldValue(b, classIdField, ["class_id", "Class ID"])
        : b.class_id || b["Class ID"];

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

      return { classId, status };
    };

    // Create a map of class_id -> class data (including date/time and capacity)
    const classMap = new Map();
    let classesWithDates = 0;
    classes.forEach((c: any) => {
      const normalized = normalizeClass(c);
      if (!normalized.classId) return;

      // Use parseDate to handle various date formats
      const classStartAt = normalized.classStartAt
        ? parseDate(normalized.classStartAt)
        : null;

      // Store class data even if no date (we'll get date from bookings)
      if (classStartAt && !isNaN(classStartAt.getTime())) {
        classesWithDates++;
        classMap.set(String(normalized.classId), {
          capacity: normalized.capacity,
          startAt: classStartAt,
          date: normalized.classStartAt, // Keep original for fallback
        });
      } else {
        // Still store class for capacity lookup
        classMap.set(String(normalized.classId), {
          capacity: normalized.capacity,
          startAt: null,
          date: normalized.classStartAt,
        });
      }
    });

    console.log(
      `[kpis] Created classMap with ${classMap.size} classes (${classesWithDates} with dates)`
    );
    if (classes.length > 0 && classesWithDates === 0) {
      console.log(`[kpis] Sample class keys:`, Object.keys(classes[0]));
      console.log(`[kpis] Sample class date fields:`, {
        "Class Starting Time": classes[0]["Class Starting Time"],
        class_start_at: classes[0].class_start_at,
        "Date & Time": classes[0]["Date & Time"],
        date_time: classes[0].date_time,
        "Class Date": classes[0]["Class Date"],
        allKeys: Object.keys(classes[0]),
      });
      console.log(
        `[kpis] Classes fields from data_tables:`,
        classesFields.map((f) => f.name)
      );
      const sampleNormalized = normalizeClass(classes[0]);
      console.log(`[kpis] Sample normalized class:`, {
        classId: sampleNormalized.classId,
        classStartAt: sampleNormalized.classStartAt,
        parsed: parseDate(sampleNormalized.classStartAt),
      });
    }

    // Get date field from bookings
    const bookingDateField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("time") ||
        f.name.toLowerCase().includes("date") ||
        f.name.toLowerCase().includes("&")
    )?.name;

    // Filter bookings and get their class date/time (from booking first, then class)
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

      if (bookingDateField) {
        const bookingDate = getFieldValue(b, bookingDateField, [
          "Date & Time",
          "date_time",
          "class_start_at",
          "booking_time",
        ]);
        if (bookingDate) {
          startAt = parseDate(bookingDate);
        }
      }

      // If booking doesn't have date, try class date
      if (!startAt && classData.date) {
        startAt = parseDate(classData.date);
      }

      // If still no date, use classData.startAt (already parsed)
      if (!startAt && classData.startAt) {
        startAt = classData.startAt;
      }

      if (!startAt || isNaN(startAt.getTime())) return false;

      const from = new Date(fromDate + "T00:00:00");
      const to = new Date(toDate + "T23:59:59");
      return startAt >= from && startAt <= to;
    });

    console.log(
      `[kpis] Bookings in range: ${bookingsInRange.length} out of ${bookings.length} total bookings`
    );

    const bookedSpots = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase();
      return status === "booked" || status === "attended";
    }).length;

    // Total capacity: sum capacity of every class occurrence (row) with startAt in range.
    // (Multiple rows can share the same Class ID; each row is one occurrence.)
    const from = new Date(fromDate + "T00:00:00");
    const to = new Date(toDate + "T23:59:59");
    let totalCapacity = 0;
    classes.forEach((c: any) => {
      const normalized = normalizeClass(c);
      const cap = Number(normalized.capacity) || 0;
      if (!normalized.classId || cap <= 0) return;
      const startAt = normalized.classStartAt
        ? parseDate(normalized.classStartAt)
        : null;
      if (
        !startAt ||
        isNaN(startAt.getTime()) ||
        startAt < from ||
        startAt > to
      )
        return;
      totalCapacity += cap;
    });

    // Fallback: when no class rows have dates in range (e.g. Excel date format, or wrong period),
    // derive capacity from bookings in range (unique class occurrence × capacity from classMap).
    if (totalCapacity === 0 && bookingsInRange.length > 0) {
      const seenKey = new Set<string>();
      bookingsInRange.forEach((b: any) => {
        const normalized = normalizeBooking(b);
        const bookingDate =
          bookingDateField &&
          getFieldValue(b, bookingDateField, [
            "Date & Time",
            "date_time",
            "class_start_at",
            "booking_time",
          ]);
        const startAt = parseDate(bookingDate);
        if (!startAt || !normalized.classId) return;
        const classIdStr = String(normalized.classId);
        let classData = classMap.get(classIdStr);
        if (!classData) {
          for (const [k, v] of classMap.entries()) {
            if (String(k).toLowerCase() === classIdStr.toLowerCase()) {
              classData = v;
              break;
            }
          }
        }
        if (!classData) return;
        const cap = Number(classData.capacity) || 0;
        if (cap <= 0) return;
        const key = `${classIdStr}|${startAt.getTime()}`;
        if (seenKey.has(key)) return;
        seenKey.add(key);
        totalCapacity += cap;
      });
    }

    const utilizationRate =
      totalCapacity > 0 ? (bookedSpots / totalCapacity) * 100 : 0;

    // KPI 8: Cancellation Rate (%)
    const finalBookings = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase().trim();
      return (
        status === "attended" ||
        status === "no_show" ||
        status === "no-show" ||
        status === "noshow" ||
        status === "cancelled" ||
        status === "canceled" ||
        status === "booked"
      );
    });
    const cancelled = bookingsInRange.filter((b: any) => {
      const normalized = normalizeBooking(b);
      const status = normalized.status.toLowerCase().trim();
      return status === "cancelled" || status === "canceled";
    }).length;

    console.log(`[kpis] Cancellation rate calculation:`, {
      totalBookingsInRange: bookingsInRange.length,
      finalBookings: finalBookings.length,
      cancelled,
      sampleStatuses: bookingsInRange.slice(0, 10).map((b: any) => {
        const normalized = normalizeBooking(b);
        return normalized.status;
      }),
    });

    const cancellationRate =
      finalBookings.length > 0 ? (cancelled / finalBookings.length) * 100 : 0;

    // Calculate total expenses from transactions using direction field (outflows),
    // falling back to negative amounts for legacy data without a direction field.
    const expenseTransactions = transactions.filter((t: any) => {
      const amountRaw = txAmountField
        ? getTxVal(t, txAmountField, ["amount", "Amount", "value", "Value"])
        : (t.amount ?? t.Amount ?? 0);
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw)
          : Number(amountRaw) || 0;
      if (amount === 0) return false;
      const dateRaw = txDateField
        ? getTxVal(t, txDateField, ["date", "Date", "payment_date"])
        : (t.date ?? t.Date ?? t.payment_date);
      const date = dateRaw ? parseDate(dateRaw) : null;
      if (!date || isNaN(date.getTime())) return false;
      const from = new Date(fromDate + "T00:00:00");
      const to = new Date(toDate + "T23:59:59");
      if (date < from || date > to) return false;
      const direction = getTxDirection(t);
      if (direction === "outflow") return true;
      if (direction === "inflow") return false;
      // Legacy signed-amount data: outflow = negative amount
      return amount < 0;
    });

    const totalExpenses = expenseTransactions.reduce((sum: number, t: any) => {
      const amountRaw = txAmountField
        ? getTxVal(t, txAmountField, ["amount", "Amount", "value", "Value"])
        : (t.amount ?? t.Amount ?? 0);
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw)
          : Number(amountRaw) || 0;
      return sum + Math.abs(amount);
    }, 0);

    const netIncome = totalRevenue - totalExpenses;
    // Burn Rate: total outflows (expenses) for the period
    const burnRate = totalExpenses;

    // Net Cash Flow: total inflows - total outflows.
    // Also count paid invoices as inflows (users may store revenue in an invoices table
    // rather than as transaction inflows).
    const invoicesTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "invoices"
    );
    const invoicesFields = invoicesTableId
      ? tableFieldsMap[invoicesTableId]?.fields || []
      : [];

    const getInvVal = (
      inv: any,
      fieldName: string,
      fallbacks: string[] = []
    ): any => {
      if (inv[fieldName] !== undefined) return inv[fieldName];
      const lower = fieldName.toLowerCase();
      for (const k in inv) {
        if (k.toLowerCase() === lower) return inv[k];
      }
      for (const f of fallbacks) {
        if (inv[f] !== undefined) return inv[f];
      }
      return undefined;
    };

    const invDateField = invoicesFields.find((f) =>
      f.name.toLowerCase().includes("date")
    )?.name;
    const invAmountField = invoicesFields.find(
      (f) =>
        f.name.toLowerCase().includes("amount") ||
        f.name.toLowerCase().includes("total") ||
        f.name.toLowerCase().includes("value")
    )?.name;
    const invStatusField = invoicesFields.find((f) =>
      f.name.toLowerCase().includes("status")
    )?.name;

    const paidInvoicesTotal = invoices.reduce((sum: number, inv: any) => {
      const status = String(
        invStatusField
          ? getInvVal(inv, invStatusField, ["status", "Status"])
          : (inv.status ?? inv.Status ?? "")
      ).toLowerCase();
      if (status !== "paid") return sum;

      const dateRaw = invDateField
        ? getInvVal(inv, invDateField, ["date", "Date", "invoice_date"])
        : (inv.date ?? inv.Date ?? inv.invoice_date);
      const date = dateRaw ? parseDate(dateRaw) : null;
      if (!date || isNaN(date.getTime()) || date < from || date > to)
        return sum;

      const amountRaw = invAmountField
        ? getInvVal(inv, invAmountField, ["amount", "Amount", "total", "Total"])
        : (inv.amount ??
          inv.Amount ??
          inv.total ??
          inv.Total ??
          inv["Total Amount"] ??
          0);
      const amount =
        typeof amountRaw === "string"
          ? parseFloat(amountRaw)
          : Number(amountRaw) || 0;
      return sum + Math.abs(amount);
    }, 0);

    // Use paid invoices as inflows if they exist; otherwise fall back to transaction inflows.
    // This avoids double-counting when revenue is stored in one place only.
    const totalInflows =
      paidInvoicesTotal > 0 ? paidInvoicesTotal : totalRevenue;
    const netCashFlow = totalInflows - totalExpenses;

    // Revenue per class: total revenue ÷ number of class occurrences in the period
    const classesInRange = classes.filter((c: any) => {
      const { classStartAt } = normalizeClass(c);
      const startAt = classStartAt ? parseDate(classStartAt) : null;
      return (
        startAt && !isNaN(startAt.getTime()) && startAt >= from && startAt <= to
      );
    });
    const revenuePerClass =
      classesInRange.length > 0 ? totalRevenue / classesInRange.length : 0;

    // Total Classes Held: distinct (class_id, class_start_at) occurrences in the period
    const seenClassOccurrences = new Set<string>();
    classesInRange.forEach((c: any) => {
      const { classId, classStartAt } = normalizeClass(c);
      if (!classId) return;
      const startAt = classStartAt ? parseDate(classStartAt) : null;
      const key = `${classId}|${startAt ? startAt.getTime() : classStartAt}`;
      seenClassOccurrences.add(key);
    });
    const totalClassesHeld = seenClassOccurrences.size;

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
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCosts: parseFloat(totalExpenses.toFixed(2)),
        netIncome: parseFloat(netIncome.toFixed(2)),
        netCashFlow: parseFloat(netCashFlow.toFixed(2)),
        burnRate: parseFloat(burnRate.toFixed(2)),
        revenuePerClass: parseFloat(revenuePerClass.toFixed(2)),
        totalClassesHeld,
      },
    });
  } catch (err) {
    console.error("[api/analytics/fitness-studio/kpis] Unexpected error:", err);
    return jsonNoStore({ kpis: {} });
  }
}
