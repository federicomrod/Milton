// GET /api/analytics/fitness-studio/members?from_date=...&to_date=...
// Returns KPIs and chart data for members analytics. Member KPIs from unified kpi-calculations layer.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calculateActiveMembers,
  calculateNewMonthlyMembers,
  calculateChurnedMonthlyMembers,
  calculateAverageMemberTenure,
} from "@/lib/kpi-calculations";

function jsonNoStore(data: Record<string, unknown>) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function parseDate(dateStr: any): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
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

      // Handle 2-digit years
      if (year < 50) {
        year += 2000; // 00-49 -> 2000-2049
      } else if (year < 100) {
        year += 1900; // 50-99 -> 1950-1999
      }

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
      return jsonNoStore({ kpis: {}, charts: {} });
    }

    const fromDate =
      req.nextUrl.searchParams.get("from_date") ||
      new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
    const toDate =
      req.nextUrl.searchParams.get("to_date") ||
      new Date().toISOString().split("T")[0];

    // Member KPIs from unified layer (used below for activeMembers, newMembers, churnedMembers, avgTenure)
    const [activeRes, newRes, churnedRes, tenureRes] = await Promise.all([
      calculateActiveMembers(supabase, user.id, fromDate, toDate).catch(() => ({
        currentValue: 0,
      })),
      calculateNewMonthlyMembers(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0 })
      ),
      calculateChurnedMonthlyMembers(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0 })
      ),
      calculateAverageMemberTenure(supabase, user.id, fromDate, toDate).catch(
        () => ({ currentValue: 0 })
      ),
    ]);
    const layerActiveMembers = activeRes.currentValue ?? 0;
    const layerNewMembers = newRes.currentValue ?? 0;
    const layerChurnedMembers = churnedRes.currentValue ?? 0;
    const layerAvgTenure = tenureRes.currentValue ?? 0;

    console.log("[members-analytics] Date range:", { fromDate, toDate });

    // Fetch all model_data for the company
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
        console.error("[members] Error fetching model_data:", result.error);
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

    // Parse members data
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

    // Parse bookings data
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

    // Parse classes data (needed for booking dates)
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

    // Get field names from data_tables definitions
    const membersTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "members"
    );
    const bookingsTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "bookings"
    );
    const classesTableId = Object.keys(idToNameMap).find(
      (id) => idToNameMap[id] === "classes"
    );

    const membersFields = membersTableId
      ? tableFieldsMap[membersTableId]?.fields || []
      : [];
    const bookingsFields = bookingsTableId
      ? tableFieldsMap[bookingsTableId]?.fields || []
      : [];
    const classesFields = classesTableId
      ? tableFieldsMap[classesTableId]?.fields || []
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

    // Create a map of class_id -> date_time for quick lookup
    const classDateMap = new Map<string, Date>();
    classes.forEach((c: any) => {
      const classIdField = classesFields.find(
        (f) =>
          f.name.toLowerCase().includes("class") &&
          (f.name.toLowerCase().includes("id") || f.name.toLowerCase() === "id")
      )?.name;
      const classId = classIdField
        ? getFieldValue(c, classIdField, ["id", "class_id", "Class ID"])
        : c.id || c.class_id || c["Class ID"] || c["class_id"];

      const dateTimeField = classesFields.find(
        (f) =>
          f.name.toLowerCase().includes("time") ||
          f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("starting")
      )?.name;
      const dateTimeStr = dateTimeField
        ? getFieldValue(c, dateTimeField, [
            "Class Starting Time",
            "date_time",
            "Date & Time",
            "class_start_at",
          ])
        : c.date_time ||
          c.dateTime ||
          c["Date Time"] ||
          c["date_time"] ||
          c.class_date_time ||
          c.class_start_at ||
          c["Class Starting Time"] ||
          c["Date & Time"];

      const dateTime = parseDate(dateTimeStr);
      if (classId && dateTime) {
        classDateMap.set(String(classId), dateTime);
      }
    });

    const now = new Date();
    // For active members calculation, use "now" instead of periodEnd
    // This ensures we count members who are currently active, not just active during the period
    const activeMembersPeriodEnd = now;
    const periodEnd = new Date(toDate + "T23:59:59");

    // Debug: Log sample member data to understand structure
    if (members.length > 0) {
      const sample = members[0];
      console.log(
        "[members-analytics] Sample member fields:",
        Object.keys(sample)
      );
      console.log("[members-analytics] Sample member data:", {
        joinDateRaw: sample.join_date || sample.joinDate || sample["Join Date"],
        cancelDateRaw:
          sample.cancel_date || sample.cancelDate || sample["Cancel Date"],
        status: sample.status || sample.Status,
        parsedJoinDate: parseDate(
          sample.join_date || sample.joinDate || sample["Join Date"]
        )?.toISOString(),
        parsedCancelDate: parseDate(
          sample.cancel_date || sample.cancelDate || sample["Cancel Date"]
        )?.toISOString(),
        periodEnd: periodEnd.toISOString(),
        now: now.toISOString(),
      });
    }

    // KPI 1: Total Members
    const totalMembers = members.length;

    // KPI 2: Active vs Inactive
    // Use actual field names from data_tables
    // Active = joined before or on now AND (not cancelled OR cancelled after now)
    const joinDateField = membersFields.find(
      (f) =>
        f.name.toLowerCase().includes("join") &&
        (f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("time"))
    )?.name;
    const cancelDateField = membersFields.find(
      (f) =>
        f.name.toLowerCase().includes("cancel") &&
        (f.name.toLowerCase().includes("date") ||
          f.name.toLowerCase().includes("time"))
    )?.name;

    const activeMembers = layerActiveMembers;

    console.log("[members-analytics] Active members (from layer):", {
      totalMembers,
      activeMembers,
    });

    const inactiveMembers = totalMembers - activeMembers;

    // KPI 3: Average Age
    // Use actual field names from data_tables
    const ageField = membersFields.find(
      (f) => f.name.toLowerCase() === "age"
    )?.name;
    const birthDateField = membersFields.find(
      (f) =>
        f.name.toLowerCase().includes("birth") ||
        f.name.toLowerCase().includes("date_of_birth")
    )?.name;

    const membersWithAge = members.filter((m: any) => {
      const age = ageField
        ? getFieldValue(m, ageField, ["age", "Age"])
        : m.age || m.Age || m["Age"];
      const birthDateStr = birthDateField
        ? getFieldValue(m, birthDateField, [
            "birth_date",
            "birthDate",
            "Birth Date",
            "date_of_birth",
          ])
        : m.birth_date ||
          m.birthDate ||
          m.date_of_birth ||
          m["Birth Date"] ||
          m["Date of Birth"] ||
          m["birth_date"];
      const birthDate = parseDate(birthDateStr);
      return (
        (age !== undefined && age !== null && age > 0) || birthDate !== null
      );
    });

    let avgAge = 0;
    if (membersWithAge.length > 0) {
      const ages: number[] = [];
      membersWithAge.forEach((m: any) => {
        const age = ageField
          ? getFieldValue(m, ageField, ["age", "Age"])
          : m.age || m.Age || m["Age"];
        const birthDateStr = birthDateField
          ? getFieldValue(m, birthDateField, [
              "birth_date",
              "birthDate",
              "Birth Date",
              "date_of_birth",
            ])
          : m.birth_date ||
            m.birthDate ||
            m.date_of_birth ||
            m["Birth Date"] ||
            m["Date of Birth"] ||
            m["birth_date"];
        const birthDate = parseDate(birthDateStr);

        if (age !== undefined && age !== null && age > 0) {
          ages.push(typeof age === "string" ? parseFloat(age) : age);
        } else if (birthDate) {
          const calculatedAge =
            (now.getTime() - birthDate.getTime()) /
            (1000 * 60 * 60 * 24 * 365.25);
          ages.push(calculatedAge);
        }
      });

      if (ages.length > 0) {
        avgAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;
      }
    }

    // Log if no age data found
    if (avgAge === 0 && members.length > 0) {
      const sampleMember = members[0];
      const sampleFields = Object.keys(sampleMember);
      console.log(
        "[members-analytics] No age data found. Sample member fields:",
        sampleFields
      );
    }

    // KPI 4: Average Bookings per Month
    const periodFrom = new Date(fromDate + "T00:00:00");
    const periodTo = new Date(toDate + "T23:59:59");
    const periodDurationMonths =
      (periodTo.getTime() - periodFrom.getTime()) / (1000 * 60 * 60 * 24 * 30);

    // Count bookings for active members in the period
    // Get date from classes table by matching class_id
    const memberBookings = new Map<string, number>();
    let bookingsWithoutDate = 0;
    let bookingsWithoutClass = 0;

    const memberIdField = bookingsFields.find(
      (f) =>
        (f.name.toLowerCase().includes("member") ||
          f.name.toLowerCase().includes("customer")) &&
        f.name.toLowerCase().includes("id")
    )?.name;
    const bookingClassIdField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("class") &&
        f.name.toLowerCase().includes("id")
    )?.name;
    const bookingDateField = bookingsFields.find(
      (f) =>
        f.name.toLowerCase().includes("time") ||
        f.name.toLowerCase().includes("date") ||
        f.name.toLowerCase().includes("&")
    )?.name;

    bookings.forEach((b: any) => {
      const memberId = memberIdField
        ? getFieldValue(b, memberIdField, [
            "member_id",
            "Member ID",
            "customer_id",
          ])
        : b.member_id ||
          b.memberId ||
          b.member ||
          b["Member ID"] ||
          b["member_id"];
      if (!memberId) return;

      // Try to get date from booking first
      const bookingDateStr = bookingDateField
        ? getFieldValue(b, bookingDateField, [
            "Date & Time",
            "date_time",
            "class_start_at",
            "booking_time",
            "date",
          ])
        : b.booking_date ||
          b.date ||
          b.class_start_at ||
          b.booking_time ||
          b["Booking Date"] ||
          b["Date"] ||
          b["Date & Time"];
      let bookingDate = parseDate(bookingDateStr);

      // If no date in booking, get it from classes table via class_id
      if (!bookingDate) {
        const classId = bookingClassIdField
          ? getFieldValue(b, bookingClassIdField, ["class_id", "Class ID"])
          : b.class_id || b.classId || b["Class ID"] || b["class_id"];
        if (classId) {
          bookingDate = classDateMap.get(String(classId)) || null;
          if (!bookingDate) {
            bookingsWithoutClass++;
          }
        } else {
          bookingsWithoutDate++;
        }
      }

      if (!bookingDate) return;

      if (bookingDate >= periodFrom && bookingDate <= periodTo) {
        const key = String(memberId);
        memberBookings.set(key, (memberBookings.get(key) || 0) + 1);
      }
    });

    // Calculate average bookings per active member per month
    let avgBookingsPerMonth = 0;
    if (activeMembers > 0 && periodDurationMonths > 0) {
      const totalBookings = Array.from(memberBookings.values()).reduce(
        (sum, count) => sum + count,
        0
      );
      avgBookingsPerMonth =
        totalBookings / activeMembers / periodDurationMonths;
    }

    // Log if bookings are missing dates
    if (bookingsWithoutDate > 0 || bookingsWithoutClass > 0) {
      console.log(
        `[members-analytics] Bookings missing dates: ${bookingsWithoutDate} without date field, ${bookingsWithoutClass} without matching class. Total bookings: ${bookings.length}, Classes: ${classes.length}`
      );
    }

    // KPI 5: Net Growth (New - Churn) — newMembers, churnedMembers from layer
    const newMembers = layerNewMembers;
    const churnedMembers = layerChurnedMembers;
    const netGrowth = newMembers - churnedMembers;

    // KPI 6: Average Tenure (Months) — from layer
    const avgTenure = layerAvgTenure;

    // Chart 1: Tenure Distribution
    const tenureDistribution = {
      "< 1 Mo": 0,
      "1-3 Mos": 0,
      "3-6 Mos": 0,
      "6-12 Mos": 0,
      "1-2 Yrs": 0,
      "2+ Yrs": 0,
    };

    members.forEach((m: any) => {
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      const cancelDate = parseDate(
        m.cancel_date || m.cancelDate || m["Cancel Date"] || m["cancel_date"]
      );
      if (!joinDate) return;

      const endDate = cancelDate || now;
      const months =
        (endDate.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

      if (months < 1) {
        tenureDistribution["< 1 Mo"] += 1;
      } else if (months < 3) {
        tenureDistribution["1-3 Mos"] += 1;
      } else if (months < 6) {
        tenureDistribution["3-6 Mos"] += 1;
      } else if (months < 12) {
        tenureDistribution["6-12 Mos"] += 1;
      } else if (months < 24) {
        tenureDistribution["1-2 Yrs"] += 1;
      } else {
        tenureDistribution["2+ Yrs"] += 1;
      }
    });

    // Chart 2: Gender Split
    const genderSplit: Record<string, number> = {};
    members.forEach((m: any) => {
      const gender = m.gender || m.sex || "Other";
      const normalized = String(gender).toLowerCase();

      let key = "Other";
      if (
        normalized.includes("female") ||
        normalized.includes("f") ||
        normalized === "f"
      ) {
        key = "Female";
      } else if (
        normalized.includes("male") ||
        normalized.includes("m") ||
        normalized === "m"
      ) {
        key = "Male";
      } else if (gender && gender !== "Other") {
        key = String(gender);
      }

      genderSplit[key] = (genderSplit[key] || 0) + 1;
    });

    // Chart 3: Subscription Type
    const subscriptionField = membersFields.find(
      (f) =>
        f.name.toLowerCase().includes("subscription") ||
        f.name.toLowerCase().includes("plan") ||
        f.name.toLowerCase().includes("type")
    )?.name;
    const subscriptionCounts: Record<string, number> = {};
    members.forEach((m: any) => {
      const subscriptionType = subscriptionField
        ? getFieldValue(m, subscriptionField, [
            "subscription_type",
            "Subscription Type",
            "plan",
            "Plan",
          ]) || "Unknown"
        : m.subscription_type ||
          m.subscriptionType ||
          m.type ||
          m.membership_type ||
          "Unknown";
      const normalized = String(subscriptionType).toLowerCase();

      // Normalize common variations
      let key = "Other";
      if (normalized.includes("monthly") || normalized.includes("month")) {
        key = "Monthly";
      } else if (
        normalized.includes("yearly") ||
        normalized.includes("year") ||
        normalized.includes("annual")
      ) {
        key = "Yearly";
      } else if (
        normalized.includes("drop") ||
        normalized.includes("drop-in") ||
        normalized.includes("drop_in")
      ) {
        key = "Drop-in";
      } else if (
        normalized.includes("class pack") ||
        normalized.includes("classpack") ||
        normalized.includes("pack")
      ) {
        key = "Class Pack";
      } else if (subscriptionType && subscriptionType !== "Unknown") {
        // Use original value if it's a known value
        key = String(subscriptionType);
      }

      subscriptionCounts[key] = (subscriptionCounts[key] || 0) + 1;
    });

    const subscriptionTypeData = Object.entries(subscriptionCounts).map(
      ([type, count]) => ({
        type,
        count,
        value: count,
      })
    );

    // Chart 4: Cohort Churn
    // Group members by join month (cohort)
    const cohorts: Record<string, any[]> = {};
    members.forEach((m: any) => {
      const joinDate = parseDate(
        m.join_date || m.joinDate || m["Join Date"] || m["join_date"]
      );
      if (!joinDate) return;
      const cohortKey = joinDate.toISOString().substring(0, 7); // YYYY-MM
      if (!cohorts[cohortKey]) {
        cohorts[cohortKey] = [];
      }
      cohorts[cohortKey].push(m);
    });

    // Calculate churn for each cohort
    // Show all cohorts that have members, not just last 12 months
    // Only count members as churned if their cancel_date is in the past (before now)
    // Note: 'now' is already defined earlier in the function
    const cohortChurnData = Object.entries(cohorts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohortMonth, cohortMembers]) => {
        const totalInCohort = cohortMembers.length;
        const churned = cohortMembers.filter((m: any) => {
          const cancelDate = parseDate(
            m.cancel_date ||
              m.cancelDate ||
              m["Cancel Date"] ||
              m["cancel_date"]
          );
          // Only count as churned if cancel_date exists AND is in the past
          // Members with future cancel dates are still active
          return (
            cancelDate !== null &&
            !isNaN(cancelDate.getTime()) &&
            cancelDate <= now
          );
        }).length;
        const churnRate =
          totalInCohort > 0 ? (churned / totalInCohort) * 100 : 0;

        return {
          cohort: cohortMonth,
          total: totalInCohort,
          churned,
          churnRate: parseFloat(churnRate.toFixed(2)),
        };
      })
      .filter((cohort) => cohort.total > 0) // Only show cohorts with members
      .slice(-12); // Show last 12 cohorts (if more than 12 exist)

    // Debug logging
    console.log("[members-analytics] Cohort churn calculation:", {
      totalCohorts: Object.keys(cohorts).length,
      cohortChurnDataLength: cohortChurnData.length,
      now: now.toISOString(),
      sampleCohorts: Object.keys(cohorts).slice(0, 3),
      sampleData: cohortChurnData.slice(0, 3),
    });

    return jsonNoStore({
      kpis: {
        totalMembers,
        activeMembers,
        inactiveMembers,
        avgAge: parseFloat(avgAge.toFixed(1)),
        avgBookingsPerMonth: parseFloat(avgBookingsPerMonth.toFixed(1)),
        netGrowth,
        avgTenure: parseFloat(avgTenure.toFixed(1)),
      },
      charts: {
        tenureDistribution: Object.entries(tenureDistribution).map(
          ([label, value]) => ({
            label,
            value,
          })
        ),
        genderSplit: Object.entries(genderSplit).map(([label, value]) => ({
          label,
          value,
        })),
        subscriptionType: subscriptionTypeData,
        cohortChurn: cohortChurnData,
      },
    });
  } catch (err) {
    console.error(
      "[api/analytics/fitness-studio/members] Unexpected error:",
      err
    );
    return jsonNoStore({ kpis: {}, charts: {} });
  }
}
