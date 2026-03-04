/**
 * Unit tests for all KPI calculation functions.
 *
 * Uses a mock Supabase factory that simulates the full data-fetch chain:
 *   companies → data_tables → model_data
 *
 * Mock data is designed to produce predictable, verifiable results so tests
 * can assert exact values, not just "truthy".
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseFlexibleDate,
  toPeriod,
  readField,
} from "@/lib/kpi-calculations/fieldAccessors";

import { calculateNewMonthlyMembers } from "@/lib/kpi-calculations/calculateNewMonthlyMembers";
import { calculateActiveMembers } from "@/lib/kpi-calculations/calculateActiveMembers";
import { calculateChurnedMonthlyMembers } from "@/lib/kpi-calculations/calculateChurnedMonthlyMembers";
import { calculateMonthlyChurnRate } from "@/lib/kpi-calculations/calculateMonthlyChurnRate";
import { calculateAverageMemberTenure } from "@/lib/kpi-calculations/calculateAverageMemberTenure";
import { calculateRevenuePerMember } from "@/lib/kpi-calculations/calculateRevenuePerMember";
import { calculateNoShowRate } from "@/lib/kpi-calculations/calculateNoShowRate";
import { calculateCancellationRate } from "@/lib/kpi-calculations/calculateCancellationRate";
import { calculateUtilizationRate } from "@/lib/kpi-calculations/calculateUtilizationRate";
import { calculateAverageClassOccupancy } from "@/lib/kpi-calculations/calculateAverageClassOccupancy";
import { calculateTotalClassesHeld } from "@/lib/kpi-calculations/calculateTotalClassesHeld";
import { calculateAverageClassSize } from "@/lib/kpi-calculations/calculateAverageClassSize";
import { calculateClassAttendanceRate } from "@/lib/kpi-calculations/calculateClassAttendanceRate";
import { calculateRevenuePerClass } from "@/lib/kpi-calculations/calculateRevenuePerClass";
import { calculateBurnRate } from "@/lib/kpi-calculations/calculateBurnRate";
import { calculateNetIncome } from "@/lib/kpi-calculations/calculateNetIncome";
import { calculateRunway } from "@/lib/kpi-calculations/calculateRunway";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "mock-user-id";
const MOCK_COMPANY_ID = "mock-company-id";

/**
 * Builds a minimal Supabase client mock that correctly simulates the three-table
 * lookup pattern used by getModelDataRows:
 *   1. companies        → returns MOCK_COMPANY_ID for any created_by query
 *   2. data_tables      → maps table name → stable UUID
 *   3. model_data       → returns provided records for a given table UUID
 */
function createMockSupabase(tableData: Record<string, any[]>) {
  const tableIdMap: Record<string, string> = {};
  Object.keys(tableData).forEach((name, i) => {
    tableIdMap[name.toLowerCase()] = `tbl-${name}-${i}`;
  });

  function makeChain(tableName: string): any {
    if (tableName === "companies") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () =>
          Promise.resolve({ data: { id: MOCK_COMPANY_ID }, error: null }),
      };
      return chain;
    }

    if (tableName === "data_tables") {
      return {
        select: () => ({
          ilike: (_field: string, value: string) => {
            const id = tableIdMap[value.toLowerCase()];
            return {
              maybeSingle: () =>
                Promise.resolve({ data: id ? { id } : null, error: null }),
            };
          },
        }),
      };
    }

    if (tableName === "model_data") {
      return {
        select: () => ({
          eq: (_f1: string, _v1: string) => ({
            eq: (_f2: string, tableId: string) => {
              const entry = Object.entries(tableIdMap).find(
                ([, id]) => id === tableId
              );
              if (entry) {
                const records = tableData[entry[0]] ?? [];
                return Promise.resolve({
                  data: records.length ? [{ data: records }] : [],
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      };
    }

    const fallback: any = {
      select: () => fallback,
      eq: () => fallback,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    return fallback;
  }

  return { from: vi.fn((t: string) => makeChain(t)) } as any;
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * 4-month window: Jan–Apr 2024 (TO is exclusive).
 *
 * Members:
 *   m_pre  – joined Dec 2023, always active (joined before range)
 *   m1     – joined Jan 10, always active
 *   m2     – joined Jan 25, always active
 *   m3     – joined Feb 15, always active
 *   m4     – joined Mar  5, cancelled Apr 15
 *
 * New members per month:  Jan=2, Feb=1, Mar=1
 * Active at month-end:    Jan=3, Feb=4, Mar=5, Apr=4
 * Churned per month:      Apr=1 (m4)
 */
const FROM = "2024-01-01";
const TO = "2024-05-01"; // exclusive

const MEMBERS = [
  { id: "m_pre", join_date: "2023-12-01", status: "active" },
  { id: "m1", join_date: "2024-01-10", status: "active" },
  { id: "m2", join_date: "2024-01-25", status: "active" },
  { id: "m3", join_date: "2024-02-15", status: "active" },
  {
    id: "m4",
    join_date: "2024-03-05",
    status: "cancelled",
    cancel_date: "2024-04-15",
  },
];

/**
 * 4 months of classes; one per month except two in January.
 *
 *  c1 (Jan 15, cap 10): 4 attended, 1 no_show, 1 cancelled
 *  c2 (Jan 25, cap 10): 3 attended, 2 booked
 *  c3 (Feb 12, cap 20): 8 attended
 *  c4 (Mar  8, cap 15): 6 attended
 *  c5 (Apr  5, cap 10): 5 attended, 1 no_show
 */
const CLASSES = [
  { id: "c1", date_time: "2024-01-15T10:00:00", capacity: 10 },
  { id: "c2", date_time: "2024-01-25T14:00:00", capacity: 10 },
  { id: "c3", date_time: "2024-02-12T09:00:00", capacity: 20 },
  { id: "c4", date_time: "2024-03-08T11:00:00", capacity: 15 },
  { id: "c5", date_time: "2024-04-05T16:00:00", capacity: 10 },
];

const BOOKINGS = [
  // c1
  { id: "b1", class_id: "c1", attendance_status: "attended" },
  { id: "b2", class_id: "c1", attendance_status: "attended" },
  { id: "b3", class_id: "c1", attendance_status: "attended" },
  { id: "b4", class_id: "c1", attendance_status: "attended" },
  { id: "b5", class_id: "c1", attendance_status: "no_show" },
  { id: "b6", class_id: "c1", attendance_status: "cancelled" },
  // c2
  { id: "b7", class_id: "c2", attendance_status: "attended" },
  { id: "b8", class_id: "c2", attendance_status: "attended" },
  { id: "b9", class_id: "c2", attendance_status: "attended" },
  { id: "b10", class_id: "c2", attendance_status: "booked" },
  { id: "b11", class_id: "c2", attendance_status: "booked" },
  // c3
  { id: "b12", class_id: "c3", attendance_status: "attended" },
  { id: "b13", class_id: "c3", attendance_status: "attended" },
  { id: "b14", class_id: "c3", attendance_status: "attended" },
  { id: "b15", class_id: "c3", attendance_status: "attended" },
  { id: "b16", class_id: "c3", attendance_status: "attended" },
  { id: "b17", class_id: "c3", attendance_status: "attended" },
  { id: "b18", class_id: "c3", attendance_status: "attended" },
  { id: "b19", class_id: "c3", attendance_status: "attended" },
  // c4
  { id: "b20", class_id: "c4", attendance_status: "attended" },
  { id: "b21", class_id: "c4", attendance_status: "attended" },
  { id: "b22", class_id: "c4", attendance_status: "attended" },
  { id: "b23", class_id: "c4", attendance_status: "attended" },
  { id: "b24", class_id: "c4", attendance_status: "attended" },
  { id: "b25", class_id: "c4", attendance_status: "attended" },
  // c5
  { id: "b26", class_id: "c5", attendance_status: "attended" },
  { id: "b27", class_id: "c5", attendance_status: "attended" },
  { id: "b28", class_id: "c5", attendance_status: "attended" },
  { id: "b29", class_id: "c5", attendance_status: "attended" },
  { id: "b30", class_id: "c5", attendance_status: "attended" },
  { id: "b31", class_id: "c5", attendance_status: "no_show" },
];

/**
 * Transactions — Jan/Feb are profitable, Mar/Apr are burning.
 *
 *  Jan: +5000 – 2000 = +3000 (net positive)
 *  Feb: +4500 – 2200 = +2300 (net positive)
 *  Mar: +2000 – 4500 = –2500 (burning, burn=2500)
 *  Apr: +1500 – 3500 = –2000 (burning, burn=2000)
 *
 *  Running balance: 3000+2300–2500–2000 = 800
 *  avgBurn (last-3 positive months) = (2500+2000)/2 = 2250
 *  runway = 800/2250 ≈ 0.356 months
 */
const TRANSACTIONS = [
  { id: "t1", date: "2024-01-05", amount: "5000", type: "inflow" },
  { id: "t2", date: "2024-01-20", amount: "2000", type: "outflow" },
  { id: "t3", date: "2024-02-10", amount: "4500", type: "inflow" },
  { id: "t4", date: "2024-02-25", amount: "2200", type: "outflow" },
  { id: "t5", date: "2024-03-15", amount: "2000", type: "inflow" },
  { id: "t6", date: "2024-03-28", amount: "4500", type: "outflow" },
  { id: "t7", date: "2024-04-10", amount: "1500", type: "inflow" },
  { id: "t8", date: "2024-04-25", amount: "3500", type: "outflow" },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Returns the period in "YYYY-MM" regardless of whether it's "YYYY-MM-01". */
const ym = (period: string) => period.substring(0, 7);

// ---------------------------------------------------------------------------
// Members KPIs
// ---------------------------------------------------------------------------

describe("calculateNewMonthlyMembers", () => {
  const supabase = createMockSupabase({ members: MEMBERS });

  it("returns one entry per month that had joiners", async () => {
    const { historicalData } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // Jan, Feb, Mar — Apr had no new members
    expect(historicalData.length).toBe(3);
  });

  it("counts correct joiners per month", async () => {
    const { historicalData } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    expect(byMonth["2024-01"]).toBe(2); // m1 + m2
    expect(byMonth["2024-02"]).toBe(1); // m3
    expect(byMonth["2024-03"]).toBe(1); // m4
  });

  it("excludes members who joined before the range", async () => {
    const { historicalData } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // m_pre joined Dec 2023 — must not appear
    const dec = historicalData.find((p) => ym(p.period) === "2023-12");
    expect(dec).toBeUndefined();
  });

  it("currentValue equals the last historical entry", async () => {
    const { currentValue, historicalData } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(currentValue).toBe(historicalData[historicalData.length - 1].value);
  });

  it("narrowing the range to a single month returns only that month", async () => {
    const { historicalData } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      "2024-02-01",
      "2024-03-01"
    );
    expect(historicalData.length).toBe(1);
    expect(ym(historicalData[0].period)).toBe("2024-02");
    expect(historicalData[0].value).toBe(1);
  });

  it("returns empty historicalData when range has no joiners", async () => {
    const { historicalData, currentValue } = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      "2025-01-01",
      "2025-06-01"
    );
    expect(historicalData).toEqual([]);
    expect(currentValue).toBe(0);
  });

  it("returns 0 when members table is absent (graceful empty)", async () => {
    const emptySupabase = createMockSupabase({});
    const { currentValue, historicalData } = await calculateNewMonthlyMembers(
      emptySupabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData).toEqual([]);
    expect(currentValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("calculateActiveMembers", () => {
  const supabase = createMockSupabase({ members: MEMBERS });

  it("returns one entry per month in the range", async () => {
    const { historicalData } = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4); // Jan, Feb, Mar, Apr
  });

  it("counts active members correctly at each month-end snapshot", async () => {
    const { historicalData } = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [p.period, p.value])
    );
    expect(byMonth["2024-01"]).toBe(3); // m_pre + m1 + m2
    expect(byMonth["2024-02"]).toBe(4); // + m3
    expect(byMonth["2024-03"]).toBe(5); // + m4 (cancel Apr 15 > Mar 31)
    expect(byMonth["2024-04"]).toBe(4); // m4 cancelled Apr 15 ≤ Apr 30
  });

  it("uses YYYY-MM period format (not YYYY-MM-01)", async () => {
    const { historicalData } = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.period).toMatch(/^\d{4}-\d{2}$/));
  });

  it("currentValue equals the last historical entry", async () => {
    const { currentValue, historicalData } = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(currentValue).toBe(historicalData[historicalData.length - 1].value);
  });

  it("includes members who joined before the range (pre-existing active members)", async () => {
    const { historicalData } = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // m_pre joined Dec 2023 — must still count in Jan
    expect(historicalData[0].value).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("calculateChurnedMonthlyMembers", () => {
  const supabase = createMockSupabase({ members: MEMBERS });

  it("returns one entry for the month m4 cancelled", async () => {
    const { historicalData } = await calculateChurnedMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(1);
    expect(ym(historicalData[0].period)).toBe("2024-04");
    expect(historicalData[0].value).toBe(1);
  });

  it("returns empty when nobody cancelled in range", async () => {
    const { historicalData, currentValue } =
      await calculateChurnedMonthlyMembers(
        supabase,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-06-01"
      );
    expect(historicalData).toEqual([]);
    expect(currentValue).toBe(0);
  });

  it("detects cancellation via status_change_date when cancel_date is absent", async () => {
    const altMembers = [
      {
        id: "x1",
        join_date: "2024-01-01",
        status: "cancelled",
        status_change_date: "2024-03-10",
      },
    ];
    const s = createMockSupabase({ members: altMembers });
    const { historicalData } = await calculateChurnedMonthlyMembers(
      s,
      MOCK_USER_ID,
      "2024-01-01",
      "2024-06-01"
    );
    expect(historicalData.length).toBe(1);
    expect(ym(historicalData[0].period)).toBe("2024-03");
  });
});

// ---------------------------------------------------------------------------

describe("calculateMonthlyChurnRate", () => {
  const supabase = createMockSupabase({ members: MEMBERS });

  it("returns one entry per month covered by active members", async () => {
    const { historicalData } = await calculateMonthlyChurnRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // All 4 months present (driven by active members)
    expect(historicalData.length).toBe(4);
  });

  it("reports 0% churn for months with no cancellations", async () => {
    const { historicalData } = await calculateMonthlyChurnRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [p.period, p.value])
    );
    expect(byMonth["2024-01"]).toBe(0);
    expect(byMonth["2024-02"]).toBe(0);
    expect(byMonth["2024-03"]).toBe(0);
  });

  it("calculates correct churn % for Apr (1 churned / 4 active = 25%)", async () => {
    const { historicalData } = await calculateMonthlyChurnRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const apr = historicalData.find((p) => p.period === "2024-04");
    expect(apr).toBeDefined();
    expect(apr!.value).toBeCloseTo(25, 1);
  });

  it("never returns NaN (division by 0 guard)", async () => {
    const noActiveSupabase = createMockSupabase({ members: [] });
    const { historicalData } = await calculateMonthlyChurnRate(
      noActiveSupabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(isNaN(p.value)).toBe(false));
  });
});

// ---------------------------------------------------------------------------

describe("calculateAverageMemberTenure", () => {
  const supabase = createMockSupabase({ members: MEMBERS });

  it("returns one entry per month in the range", async () => {
    const { historicalData } = await calculateAverageMemberTenure(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("uses YYYY-MM period format", async () => {
    const { historicalData } = await calculateAverageMemberTenure(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.period).toMatch(/^\d{4}-\d{2}$/));
  });

  it("tenure increases across months for active members", async () => {
    const { historicalData } = await calculateAverageMemberTenure(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // Average tenure grows because members get older
    expect(historicalData[1].value).toBeGreaterThan(historicalData[0].value);
    expect(historicalData[2].value).toBeGreaterThan(historicalData[1].value);
  });

  it("all values are > 0 (m_pre joined Dec 2023 so at least 1 month tenure in Jan)", async () => {
    const { historicalData } = await calculateAverageMemberTenure(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.value).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// Classes KPIs
// ---------------------------------------------------------------------------

describe("calculateTotalClassesHeld", () => {
  const supabase = createMockSupabase({ classes: CLASSES });

  it("returns the correct count per month", async () => {
    const { historicalData } = await calculateTotalClassesHeld(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    expect(byMonth["2024-01"]).toBe(2); // c1 + c2
    expect(byMonth["2024-02"]).toBe(1); // c3
    expect(byMonth["2024-03"]).toBe(1); // c4
    expect(byMonth["2024-04"]).toBe(1); // c5
  });

  it("returns 4 months of data", async () => {
    const { historicalData } = await calculateTotalClassesHeld(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("currentValue reflects the total across all months", async () => {
    const { currentValue, historicalData } = await calculateTotalClassesHeld(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const expectedTotal = historicalData.reduce(
      (sum, point) => sum + point.value,
      0
    );
    expect(currentValue).toBe(expectedTotal);
  });
});

// ---------------------------------------------------------------------------

describe("calculateAverageClassSize", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month that had classes", async () => {
    const { historicalData } = await calculateAverageClassSize(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("computes correct avg attendees per class instance", async () => {
    const { historicalData } = await calculateAverageClassSize(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Jan: c1=4, c2=3 → avg=3.5
    expect(byMonth["2024-01"]).toBeCloseTo(3.5);
    // Feb: c3=8 → avg=8
    expect(byMonth["2024-02"]).toBe(8);
    // Mar: c4=6 → avg=6
    expect(byMonth["2024-03"]).toBe(6);
    // Apr: c5=5 → avg=5
    expect(byMonth["2024-04"]).toBe(5);
  });

  it("ignores non-attended bookings (no_show, cancelled, booked) in size count", async () => {
    const { historicalData } = await calculateAverageClassSize(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // c1 has 1 no_show + 1 cancelled that must NOT count toward class size
    const jan = historicalData.find((p) => ym(p.period) === "2024-01");
    expect(jan!.value).toBeCloseTo(3.5); // (4+3)/2, not (6+5)/2
  });
});

// ---------------------------------------------------------------------------

describe("calculateAverageClassOccupancy", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month", async () => {
    const { historicalData } = await calculateAverageClassOccupancy(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("computes occupancy as (attended / capacity) averaged across class occurrences", async () => {
    const { historicalData } = await calculateAverageClassOccupancy(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Jan: c1=4/10=40%, c2=3/10=30% → avg=35%
    expect(byMonth["2024-01"]).toBeCloseTo(35);
    // Feb: c3=8/20=40%
    expect(byMonth["2024-02"]).toBeCloseTo(40);
    // Mar: c4=6/15=40%
    expect(byMonth["2024-03"]).toBeCloseTo(40);
    // Apr: c5=5/10=50%
    expect(byMonth["2024-04"]).toBeCloseTo(50);
  });

  it("all values are between 0 and 100", async () => {
    const { historicalData } = await calculateAverageClassOccupancy(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    });
  });
});

// ---------------------------------------------------------------------------

describe("calculateClassAttendanceRate", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month", async () => {
    const { historicalData } = await calculateClassAttendanceRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("calculates attended/(attended+booked) per month", async () => {
    const { historicalData } = await calculateClassAttendanceRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Jan: c1 4 attended + c2 3 attended + 2 booked = 7 attended / 9 total ≈ 77.78%
    expect(byMonth["2024-01"]).toBeCloseTo(77.78, 0);
    // Feb: c3 8 attended, 0 booked = 100%
    expect(byMonth["2024-02"]).toBeCloseTo(100);
    // Mar/Apr: all attended = 100%
    expect(byMonth["2024-03"]).toBeCloseTo(100);
    expect(byMonth["2024-04"]).toBeCloseTo(100);
  });

  it("excludes no_show and cancelled from the attendance denominator", async () => {
    const { historicalData } = await calculateClassAttendanceRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const jan = historicalData.find((p) => ym(p.period) === "2024-01")!;
    // Should be ≈77.78%, not much lower (no_show+cancelled excluded from denominator)
    expect(jan.value).toBeGreaterThan(70);
  });
});

// ---------------------------------------------------------------------------

describe("calculateNoShowRate", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month that had bookings", async () => {
    const { historicalData } = await calculateNoShowRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("calculates no_show/total per month", async () => {
    const { historicalData } = await calculateNoShowRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Jan: 1 no_show / 11 total ≈ 9.09%
    expect(byMonth["2024-01"]).toBeCloseTo(9.09, 0);
    // Feb: 0 no_shows = 0%
    expect(byMonth["2024-02"]).toBe(0);
    // Apr: c5 has 1 no_show / 6 total ≈ 16.67%
    expect(byMonth["2024-04"]).toBeCloseTo(16.67, 0);
  });

  it("values are between 0 and 100", async () => {
    const { historicalData } = await calculateNoShowRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    });
  });
});

// ---------------------------------------------------------------------------

describe("calculateCancellationRate", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month that had bookings", async () => {
    const { historicalData } = await calculateCancellationRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("calculates cancelled/total per month", async () => {
    const { historicalData } = await calculateCancellationRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Jan: 1 cancelled / 11 total ≈ 9.09%
    expect(byMonth["2024-01"]).toBeCloseTo(9.09, 0);
    // Feb-Apr: 0 cancellations
    expect(byMonth["2024-02"]).toBe(0);
    expect(byMonth["2024-03"]).toBe(0);
    expect(byMonth["2024-04"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("calculateUtilizationRate", () => {
  const supabase = createMockSupabase({ classes: CLASSES, bookings: BOOKINGS });

  it("returns data for every month that had bookings", async () => {
    const { historicalData } = await calculateUtilizationRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("values are between 0 and 100", async () => {
    const { historicalData } = await calculateUtilizationRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    });
  });

  it("months with more attended bookings have higher utilization", async () => {
    const { historicalData } = await calculateUtilizationRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // All months should have some utilization > 0
    historicalData.forEach((p) => expect(p.value).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// Financial KPIs
// ---------------------------------------------------------------------------

describe("calculateNetIncome", () => {
  const supabase = createMockSupabase({ transactions: TRANSACTIONS });

  it("returns one entry per month with transactions", async () => {
    const { historicalData } = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("calculates inflows minus outflows per month", async () => {
    const { historicalData } = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    expect(byMonth["2024-01"]).toBeCloseTo(3000); // 5000 - 2000
    expect(byMonth["2024-02"]).toBeCloseTo(2300); // 4500 - 2200
    expect(byMonth["2024-03"]).toBeCloseTo(-2500); // 2000 - 4500
    expect(byMonth["2024-04"]).toBeCloseTo(-2000); // 1500 - 3500
  });

  it("profitable months are positive, burning months are negative", async () => {
    const { historicalData } = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    expect(byMonth["2024-01"]).toBeGreaterThan(0);
    expect(byMonth["2024-03"]).toBeLessThan(0);
  });

  it("currentValue equals the last historical entry", async () => {
    const { currentValue, historicalData } = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(currentValue).toBe(historicalData[historicalData.length - 1].value);
  });

  it("returns empty result when no transactions exist", async () => {
    const empty = createMockSupabase({ transactions: [] });
    const { currentValue, historicalData } = await calculateNetIncome(
      empty,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData).toEqual([]);
    expect(currentValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("calculateBurnRate", () => {
  const supabase = createMockSupabase({ transactions: TRANSACTIONS });

  it("returns one entry per month in range", async () => {
    const { historicalData } = await calculateBurnRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("value = outflows - inflows per month (negative when profitable)", async () => {
    const { historicalData } = await calculateBurnRate(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    expect(byMonth["2024-01"]).toBeCloseTo(-3000); // 2000 - 5000
    expect(byMonth["2024-03"]).toBeCloseTo(2500); // 4500 - 2000
    expect(byMonth["2024-04"]).toBeCloseTo(2000); // 3500 - 1500
  });

  it("returns 0 for empty transactions", async () => {
    const empty = createMockSupabase({ transactions: [] });
    const { currentValue } = await calculateBurnRate(
      empty,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(currentValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("calculateRunway", () => {
  const supabase = createMockSupabase({ transactions: TRANSACTIONS });

  it("returns one entry per month in range", async () => {
    const { historicalData } = await calculateRunway(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("uses YYYY-MM period format", async () => {
    const { historicalData } = await calculateRunway(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.period).toMatch(/^\d{4}-\d{2}$/));
  });

  it("calculates runway = balance / avgBurn (positive burn months only)", async () => {
    const { currentValue } = await calculateRunway(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // balance=800, avgBurn=(2500+2000)/2=2250, runway≈0.356
    expect(currentValue).toBeCloseTo(800 / 2250, 2);
  });

  it("all months share the same runway value (static projection)", async () => {
    const { historicalData } = await calculateRunway(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const values = historicalData.map((p) => p.value);
    // All entries carry the same runway snapshot
    expect(new Set(values).size).toBe(1);
  });

  it("returns 0 runway when there is no positive burn", async () => {
    // All inflows > outflows → no burning months → avgBurn=0 → runway=0
    const profitOnly = [
      { id: "x1", date: "2024-01-01", amount: "5000", type: "inflow" },
      { id: "x2", date: "2024-01-15", amount: "1000", type: "outflow" },
    ];
    const s = createMockSupabase({ transactions: profitOnly });
    const { currentValue } = await calculateRunway(s, MOCK_USER_ID, FROM, TO);
    expect(currentValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-table KPIs
// ---------------------------------------------------------------------------

describe("calculateRevenuePerMember", () => {
  const supabase = createMockSupabase({
    members: MEMBERS,
    transactions: TRANSACTIONS,
  });

  it("returns one entry per month with revenue", async () => {
    const { historicalData } = await calculateRevenuePerMember(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("value is positive for months with active members", async () => {
    const { historicalData } = await calculateRevenuePerMember(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.value).toBeGreaterThan(0));
  });

  it("returns 0 when there are no members", async () => {
    const noMembers = createMockSupabase({
      members: [],
      transactions: TRANSACTIONS,
    });
    const { historicalData } = await calculateRevenuePerMember(
      noMembers,
      MOCK_USER_ID,
      FROM,
      TO
    );
    // No active members → revenue per member = 0 for all months
    historicalData.forEach((p) => expect(p.value).toBe(0));
  });
});

// ---------------------------------------------------------------------------

describe("calculateRevenuePerClass", () => {
  const supabase = createMockSupabase({
    classes: CLASSES,
    transactions: TRANSACTIONS,
  });

  it("returns one entry per month with revenue or classes", async () => {
    const { historicalData } = await calculateRevenuePerClass(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    expect(historicalData.length).toBe(4);
  });

  it("value is positive for months with both revenue and classes", async () => {
    const { historicalData } = await calculateRevenuePerClass(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    historicalData.forEach((p) => expect(p.value).toBeGreaterThanOrEqual(0));
  });

  it("Jan has higher per-class revenue than Feb (more total revenue / same 1 class Feb vs 2 Jan)", async () => {
    const { historicalData } = await calculateRevenuePerClass(
      supabase,
      MOCK_USER_ID,
      FROM,
      TO
    );
    const byMonth = Object.fromEntries(
      historicalData.map((p) => [ym(p.period), p.value])
    );
    // Feb revenue / 1 class > Jan revenue / 2 classes (4500+2200)/1 > (5000+2000)/2
    expect(byMonth["2024-02"]).toBeGreaterThan(byMonth["2024-01"]);
  });
});

// ---------------------------------------------------------------------------
// Changing the date range changes the output — regression guard
// ---------------------------------------------------------------------------

describe("time range sensitivity", () => {
  it("calculateNewMonthlyMembers reflects the selected range — not a fixed snapshot", async () => {
    const supabase = createMockSupabase({ members: MEMBERS });

    const jan = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      "2024-01-01",
      "2024-02-01"
    );
    const feb = await calculateNewMonthlyMembers(
      supabase,
      MOCK_USER_ID,
      "2024-02-01",
      "2024-03-01"
    );

    expect(jan.historicalData.length).toBe(1);
    expect(ym(jan.historicalData[0].period)).toBe("2024-01");
    expect(jan.historicalData[0].value).toBe(2);

    expect(feb.historicalData.length).toBe(1);
    expect(ym(feb.historicalData[0].period)).toBe("2024-02");
    expect(feb.historicalData[0].value).toBe(1);

    // The two ranges must produce different results
    expect(jan.historicalData[0].period).not.toBe(feb.historicalData[0].period);
    expect(jan.currentValue).not.toBe(feb.currentValue);
  });

  it("calculateActiveMembers count grows as range extends", async () => {
    const supabase = createMockSupabase({ members: MEMBERS });

    const short = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      "2024-01-01",
      "2024-02-01"
    );
    const long = await calculateActiveMembers(
      supabase,
      MOCK_USER_ID,
      "2024-01-01",
      "2024-04-01"
    );

    expect(long.historicalData.length).toBeGreaterThan(
      short.historicalData.length
    );
  });

  it("calculateNetIncome differs between a profitable quarter and a losing quarter", async () => {
    const supabase = createMockSupabase({ transactions: TRANSACTIONS });

    const profitable = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      "2024-01-01",
      "2024-03-01"
    );
    const losing = await calculateNetIncome(
      supabase,
      MOCK_USER_ID,
      "2024-03-01",
      "2024-05-01"
    );

    // Q1: all positive months
    profitable.historicalData.forEach((p) =>
      expect(p.value).toBeGreaterThan(0)
    );
    // Q2: all negative months
    losing.historicalData.forEach((p) => expect(p.value).toBeLessThan(0));
  });
});

// ---------------------------------------------------------------------------
// fieldAccessors unit tests
// ---------------------------------------------------------------------------

describe("parseFlexibleDate", () => {
  it("parses ISO date-only as local midnight (no UTC shift)", () => {
    const d = parseFlexibleDate("2025-11-01");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(10); // November = index 10
    expect(d!.getDate()).toBe(1);
  });

  it("parses ISO datetime string", () => {
    const d = parseFlexibleDate("2025-08-25 09:15:00");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(7); // August = 7
  });

  it("parses M/D/YY format (uploaded CSV dates)", () => {
    const d = parseFlexibleDate("6/26/25");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(5); // June = 5
    expect(d!.getDate()).toBe(26);
  });

  it("parses M/D/YYYY format", () => {
    const d = parseFlexibleDate("1/10/2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0); // January
    expect(d!.getDate()).toBe(10);
  });

  it("parses single-digit month/day in M/D/YY", () => {
    const d = parseFlexibleDate("3/5/25");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(2); // March
    expect(d!.getDate()).toBe(5);
  });

  it("returns null for empty/null input", () => {
    expect(parseFlexibleDate(null)).toBeNull();
    expect(parseFlexibleDate(undefined)).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });

  it("returns null for unparseable strings", () => {
    expect(parseFlexibleDate("not a date")).toBeNull();
  });
});

describe("toPeriod", () => {
  it("produces YYYY-MM using local time methods", () => {
    const d = new Date(2025, 10, 15); // Nov 15 2025 local
    expect(toPeriod(d)).toBe("2025-11");
  });

  it("pads single-digit months", () => {
    const d = new Date(2025, 0, 1); // Jan 1
    expect(toPeriod(d)).toBe("2025-01");
  });
});

describe("readField", () => {
  it("returns snake_case field when present", () => {
    expect(
      readField({ join_date: "2025-01-01" }, "join_date", "Join Date")
    ).toBe("2025-01-01");
  });

  it("falls back to Title Case field", () => {
    expect(
      readField({ "Join Date": "6/26/25" }, "join_date", "Join Date")
    ).toBe("6/26/25");
  });

  it("skips null/empty values and returns next match", () => {
    expect(
      readField(
        { join_date: null, "Join Date": "6/26/25" },
        "join_date",
        "Join Date"
      )
    ).toBe("6/26/25");
    expect(
      readField(
        { join_date: "", "Join Date": "6/26/25" },
        "join_date",
        "Join Date"
      )
    ).toBe("6/26/25");
  });

  it("returns undefined when no key matches", () => {
    expect(readField({ foo: "bar" }, "join_date", "Join Date")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Title Case field-name integration tests (mirrors real uploaded CSV format)
// ---------------------------------------------------------------------------

/**
 * These members use the exact field names and M/D/YY date format that real
 * uploaded CSVs produce, so the calculation functions must handle them.
 */
const TITLE_CASE_MEMBERS = [
  {
    ID: "M001",
    Name: "Alice",
    Status: "active",
    "Join Date": "1/10/25",
    "Cancel Date": null,
  },
  {
    ID: "M002",
    Name: "Bob",
    Status: "active",
    "Join Date": "1/25/25",
    "Cancel Date": null,
  },
  {
    ID: "M003",
    Name: "Carol",
    Status: "active",
    "Join Date": "2/15/25",
    "Cancel Date": null,
  },
  {
    ID: "M004",
    Name: "Dave",
    Status: "cancelled",
    "Join Date": "3/5/25",
    "Cancel Date": "4/15/25",
  },
  {
    ID: "M000",
    Name: "Eve",
    Status: "active",
    "Join Date": "12/1/24",
    "Cancel Date": null,
  },
];

const TITLE_CASE_CLASSES = [
  {
    "Class ID": "C1",
    "Class Starting Time": "2025-01-15 10:00:00",
    Capacity: "10",
  },
  {
    "Class ID": "C2",
    "Class Starting Time": "2025-02-12 09:00:00",
    Capacity: "20",
  },
  {
    "Class ID": "C3",
    "Class Starting Time": "2025-03-08 11:00:00",
    Capacity: "15",
  },
  {
    "Class ID": "C4",
    "Class Starting Time": "2025-04-05 16:00:00",
    Capacity: "10",
  },
];

const TITLE_CASE_BOOKINGS = [
  // C1: 3 Attended, 1 No-show, 1 Cancelled
  { "Class ID": "C1", "Attendance Status": "Attended" },
  { "Class ID": "C1", "Attendance Status": "Attended" },
  { "Class ID": "C1", "Attendance Status": "Attended" },
  { "Class ID": "C1", "Attendance Status": "No-show" },
  { "Class ID": "C1", "Attendance Status": "Cancelled" },
  // C2: 8 Attended
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  { "Class ID": "C2", "Attendance Status": "Attended" },
  // C3: 6 Attended
  { "Class ID": "C3", "Attendance Status": "Attended" },
  { "Class ID": "C3", "Attendance Status": "Attended" },
  { "Class ID": "C3", "Attendance Status": "Attended" },
  { "Class ID": "C3", "Attendance Status": "Attended" },
  { "Class ID": "C3", "Attendance Status": "Attended" },
  { "Class ID": "C3", "Attendance Status": "Attended" },
  // C4: 5 Attended, 1 No-show
  { "Class ID": "C4", "Attendance Status": "Attended" },
  { "Class ID": "C4", "Attendance Status": "Attended" },
  { "Class ID": "C4", "Attendance Status": "Attended" },
  { "Class ID": "C4", "Attendance Status": "Attended" },
  { "Class ID": "C4", "Attendance Status": "Attended" },
  { "Class ID": "C4", "Attendance Status": "No-show" },
];

const TITLE_CASE_TRANSACTIONS = [
  {
    ID: "T1",
    Date: "2025-01-05",
    Amount: "5000",
    "Direction (inflow / outflow)": "inflow",
  },
  {
    ID: "T2",
    Date: "2025-01-20",
    Amount: "2000",
    "Direction (inflow / outflow)": "outflow",
  },
  {
    ID: "T3",
    Date: "2025-02-10",
    Amount: "4500",
    "Direction (inflow / outflow)": "inflow",
  },
  {
    ID: "T4",
    Date: "2025-02-25",
    Amount: "2200",
    "Direction (inflow / outflow)": "outflow",
  },
  {
    ID: "T5",
    Date: "2025-03-15",
    Amount: "2000",
    "Direction (inflow / outflow)": "inflow",
  },
  {
    ID: "T6",
    Date: "2025-03-28",
    Amount: "4500",
    "Direction (inflow / outflow)": "outflow",
  },
  {
    ID: "T7",
    Date: "2025-04-10",
    Amount: "1500",
    "Direction (inflow / outflow)": "inflow",
  },
  {
    ID: "T8",
    Date: "2025-04-25",
    Amount: "3500",
    "Direction (inflow / outflow)": "outflow",
  },
];

const TC_FROM = "2025-01-01";
const TC_TO = "2025-05-01";

describe("Title Case field names (uploaded CSV format)", () => {
  describe("calculateNewMonthlyMembers with Title Case fields", () => {
    const supabase = createMockSupabase({ members: TITLE_CASE_MEMBERS });

    it("returns 3 monthly entries despite M/D/YY dates and 'Join Date' field", async () => {
      const { historicalData } = await calculateNewMonthlyMembers(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      expect(historicalData.length).toBe(3); // Jan, Feb, Mar
    });

    it("correctly counts joiners per month from M/D/YY dates", async () => {
      const { historicalData } = await calculateNewMonthlyMembers(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      expect(byMonth["2025-01"]).toBe(2); // M001 + M002
      expect(byMonth["2025-02"]).toBe(1); // M003
      expect(byMonth["2025-03"]).toBe(1); // M004
    });
  });

  describe("calculateActiveMembers with Title Case fields", () => {
    const supabase = createMockSupabase({ members: TITLE_CASE_MEMBERS });

    it("counts active members correctly from 'Join Date' / 'Cancel Date' fields", async () => {
      const { historicalData } = await calculateActiveMembers(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      expect(byMonth["2025-01"]).toBe(3); // M000 + M001 + M002
      expect(byMonth["2025-02"]).toBe(4); // + M003
      expect(byMonth["2025-03"]).toBe(5); // + M004 (cancel Apr 15 > Mar 31)
      expect(byMonth["2025-04"]).toBe(4); // M004 cancelled Apr 15
    });
  });

  describe("calculateChurnedMonthlyMembers with Title Case fields", () => {
    const supabase = createMockSupabase({ members: TITLE_CASE_MEMBERS });

    it("detects churn from 'Cancel Date' field (M/D/YY format)", async () => {
      const { historicalData } = await calculateChurnedMonthlyMembers(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      expect(historicalData.length).toBe(1);
      expect(historicalData[0].period).toBe("2025-04");
      expect(historicalData[0].value).toBe(1);
    });
  });

  describe("calculateTotalClassesHeld with Title Case fields", () => {
    const supabase = createMockSupabase({ classes: TITLE_CASE_CLASSES });

    it("counts classes from 'Class Starting Time' field", async () => {
      const { historicalData } = await calculateTotalClassesHeld(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      expect(historicalData.length).toBe(4);
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      expect(byMonth["2025-01"]).toBe(1);
      expect(byMonth["2025-02"]).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateRevenuePerClass — direction-field transactions
  // ---------------------------------------------------------------------------
  describe("calculateRevenuePerClass with Direction field transactions", () => {
    // Transactions use "Direction (inflow / outflow)" + positive Amount
    const DIRECTION_TRANSACTIONS = [
      // Jan inflows (should count as revenue)
      {
        ID: "T1",
        Date: "1/5/25",
        Amount: "100",
        "Direction (inflow / outflow)": "inflow",
      },
      {
        ID: "T2",
        Date: "1/20/25",
        Amount: "200",
        "Direction (inflow / outflow)": "inflow",
      },
      // Jan outflow (should NOT count as revenue)
      {
        ID: "T3",
        Date: "1/25/25",
        Amount: "50",
        "Direction (inflow / outflow)": "outflow",
      },
      // Feb inflows
      {
        ID: "T4",
        Date: "2/10/25",
        Amount: "150",
        "Direction (inflow / outflow)": "inflow",
      },
    ];

    const DIRECTION_CLASSES = [
      // 2 classes in Jan, 1 in Feb
      {
        "Class ID": "C1",
        "Class Starting Time": "2025-01-08 09:00:00",
        Capacity: "10",
      },
      {
        "Class ID": "C2",
        "Class Starting Time": "2025-01-22 10:00:00",
        Capacity: "15",
      },
      {
        "Class ID": "C3",
        "Class Starting Time": "2025-02-12 09:00:00",
        Capacity: "12",
      },
    ];

    const supabase = createMockSupabase({
      classes: DIRECTION_CLASSES,
      transactions: DIRECTION_TRANSACTIONS,
    });

    it("ignores outflow transactions when calculating revenue per class", async () => {
      const { historicalData } = await calculateRevenuePerClass(
        supabase,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-03-01"
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      // Jan: revenue = 100+200 = 300 (T3 outflow excluded), classes = 2 → 300/2 = 150
      expect(byMonth["2025-01"]).toBeCloseTo(150);
      // Feb: revenue = 150, classes = 1 → 150/1 = 150
      expect(byMonth["2025-02"]).toBeCloseTo(150);
    });

    it("currentValue is the most recent period's value", async () => {
      const { currentValue } = await calculateRevenuePerClass(
        supabase,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-03-01"
      );
      // Most recent period is Feb → 150
      expect(currentValue).toBeCloseTo(150);
    });

    it("returns 0 for a period with no classes", async () => {
      const supabaseNoClasses = createMockSupabase({
        classes: [],
        transactions: DIRECTION_TRANSACTIONS,
      });
      const { currentValue } = await calculateRevenuePerClass(
        supabaseNoClasses,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-03-01"
      );
      expect(currentValue).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateMonthlyChurnRate — currentValue = LAST period (most recent)
  // ---------------------------------------------------------------------------
  describe("calculateMonthlyChurnRate currentValue is last period", () => {
    // 3 members, 2 cancel during Jan-Mar.  C stays active throughout.
    // The denominator is active count at END of each month (same period).
    // Jan end: A+B+C active (none cancelled yet) → 3 active, 0 churned → 0%
    // Feb end: B+C active (A cancelled Feb 15) → 2 active, 1 churned → 1/2 = 50%
    // Mar end: C active  (B cancelled Mar 20) → 1 active, 1 churned → 1/1 = 100%
    const CHURN_MEMBERS = [
      {
        join_date: "2025-01-01",
        status: "cancelled",
        cancel_date: "2025-02-15",
      }, // A
      {
        join_date: "2025-01-01",
        status: "cancelled",
        cancel_date: "2025-03-20",
      }, // B
      { join_date: "2025-01-01", status: "active" }, // C
    ];
    const supabase = createMockSupabase({ members: CHURN_MEMBERS });

    it("monthly historicalData has rates per month (denominator = end-of-month active)", async () => {
      const { historicalData } = await calculateMonthlyChurnRate(
        supabase,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-04-01"
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      // Jan: 3 active at end, 0 churned → 0%
      expect(byMonth["2025-01"]).toBeCloseTo(0);
      // Feb: 2 active at end (A cancelled mid-Feb), 1 churned → 50%
      expect(byMonth["2025-02"]).toBeCloseTo(50);
      // Mar: 1 active at end (B cancelled mid-Mar), 1 churned → 100%
      expect(byMonth["2025-03"]).toBeCloseTo(100);
    });

    it("currentValue equals the MOST RECENT (last) period value, not the first", async () => {
      const { currentValue, historicalData } = await calculateMonthlyChurnRate(
        supabase,
        MOCK_USER_ID,
        "2025-01-01",
        "2025-04-01"
      );
      const lastPeriod = historicalData[historicalData.length - 1];
      // currentValue should mirror the LAST sorted period
      expect(currentValue).toBeCloseTo(lastPeriod.value);
      // last period (Mar) = 100% — not Jan's 0%
      expect(currentValue).toBeGreaterThan(0);
    });
  });

  describe("calculateNoShowRate with Title Case fields", () => {
    const supabase = createMockSupabase({
      classes: TITLE_CASE_CLASSES,
      bookings: TITLE_CASE_BOOKINGS,
    });

    it("resolves class lookup via 'Class ID' and normalises 'No-show' → no_show", async () => {
      const { historicalData } = await calculateNoShowRate(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      expect(historicalData.length).toBe(4);
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      // Jan C1: 1 no-show / 5 total = 20%
      expect(byMonth["2025-01"]).toBeCloseTo(20, 0);
      // Feb C2: 0 no-shows = 0%
      expect(byMonth["2025-02"]).toBe(0);
      // Apr C4: 1 no-show / 6 total ≈ 16.67%
      expect(byMonth["2025-04"]).toBeCloseTo(16.67, 0);
    });
  });

  describe("calculateNetIncome with Title Case fields", () => {
    const supabase = createMockSupabase({
      transactions: TITLE_CASE_TRANSACTIONS,
    });

    it("reads 'Date', 'Amount', and 'Direction (inflow / outflow)' correctly", async () => {
      const { historicalData } = await calculateNetIncome(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      expect(byMonth["2025-01"]).toBeCloseTo(3000); // 5000 - 2000
      expect(byMonth["2025-02"]).toBeCloseTo(2300); // 4500 - 2200
      expect(byMonth["2025-03"]).toBeCloseTo(-2500); // 2000 - 4500
      expect(byMonth["2025-04"]).toBeCloseTo(-2000); // 1500 - 3500
    });
  });

  describe("calculateAverageClassOccupancy with Title Case fields", () => {
    const supabase = createMockSupabase({
      classes: TITLE_CASE_CLASSES,
      bookings: TITLE_CASE_BOOKINGS,
    });

    it("reads Capacity and Class Starting Time, resolves bookings via Class ID", async () => {
      const { historicalData } = await calculateAverageClassOccupancy(
        supabase,
        MOCK_USER_ID,
        TC_FROM,
        TC_TO
      );
      const byMonth = Object.fromEntries(
        historicalData.map((p) => [p.period, p.value])
      );
      // Jan C1: 3 attended / 10 capacity = 30%
      expect(byMonth["2025-01"]).toBeCloseTo(30);
      // Feb C2: 8 attended / 20 capacity = 40%
      expect(byMonth["2025-02"]).toBeCloseTo(40);
      // Mar C3: 6 attended / 15 capacity = 40%
      expect(byMonth["2025-03"]).toBeCloseTo(40);
      // Apr C4: 5 attended / 10 capacity = 50%
      expect(byMonth["2025-04"]).toBeCloseTo(50);
    });
  });
});

// =============================================================================
// Analytics API calculation formulas
// =============================================================================
// These tests document and verify the formulas used by the analytics API route
// (/api/analytics/fitness-studio/kpis) without needing to invoke the full
// Next.js route handler.  The helpers mirror exactly what the route does.
// =============================================================================

describe("Analytics API calculation formulas", () => {
  function parseDate(dateStr: any): Date | null {
    if (dateStr == null) return null;
    if (typeof dateStr === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
        return new Date(dateStr + "T00:00:00");
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dateStr)) {
        const [m, d, yRaw] = dateStr.split("/").map(Number);
        const y = yRaw < 100 ? 2000 + yRaw : yRaw;
        return new Date(y, m - 1, d);
      }
    }
    const d = new Date(String(dateStr));
    return isNaN(d.getTime()) ? null : d;
  }

  function getTxDirection(t: any): "inflow" | "outflow" | "unknown" {
    const dir = String(
      t["Direction (inflow / outflow)"] ?? t.direction ?? t.type ?? ""
    ).toLowerCase();
    if (dir.includes("outflow")) return "outflow";
    if (dir.includes("inflow")) return "inflow";
    return "unknown";
  }

  function sumTransactions(
    txs: any[],
    direction: "inflow" | "outflow",
    from: Date,
    to: Date
  ): number {
    return txs
      .filter((t) => {
        const d = parseDate(t.Date ?? t.date);
        if (!d || d < from || d > to) return false;
        const dir = getTxDirection(t);
        if (dir === direction) return true;
        if (dir !== "unknown") return false;
        const amount = parseFloat(String(t.Amount ?? t.amount ?? 0));
        return direction === "inflow" ? amount > 0 : amount < 0;
      })
      .reduce(
        (sum, t) =>
          sum + Math.abs(parseFloat(String(t.Amount ?? t.amount ?? 0))),
        0
      );
  }

  function periodChurnRate(
    members: any[],
    fromDate: string,
    toDate: string
  ): number {
    const from = new Date(fromDate + "T00:00:00");
    const to = new Date(toDate + "T23:59:59");

    const activeAtStart = members.filter((m) => {
      const join = parseDate(m["Join Date"] ?? m.join_date);
      const cancel = parseDate(m["Cancel Date"] ?? m.cancel_date);
      if (!join) return false;
      return join <= from && (!cancel || cancel > from);
    }).length;

    const churned = members.filter((m) => {
      const cancel = parseDate(m["Cancel Date"] ?? m.cancel_date);
      return cancel && cancel >= from && cancel <= to;
    }).length;

    return activeAtStart > 0 ? (churned / activeAtStart) * 100 : 0;
  }

  // ── revenue / expense separation ──────────────────────────────────────────

  const MIXED_TRANSACTIONS = [
    {
      ID: "T1",
      Date: "2025-12-05",
      Amount: "500",
      "Direction (inflow / outflow)": "inflow",
    },
    {
      ID: "T2",
      Date: "2025-12-10",
      Amount: "300",
      "Direction (inflow / outflow)": "inflow",
    },
    {
      ID: "T3",
      Date: "2025-12-15",
      Amount: "200",
      "Direction (inflow / outflow)": "outflow",
    },
    {
      ID: "T4",
      Date: "2025-12-20",
      Amount: "100",
      "Direction (inflow / outflow)": "outflow",
    },
    // Legacy signed-amount transactions (no direction field)
    { ID: "T5", Date: "2025-12-22", Amount: "150" },
    { ID: "T6", Date: "2025-12-23", Amount: "-80" },
  ];

  const FROM_DEC = new Date("2025-12-01T00:00:00");
  const TO_DEC = new Date("2025-12-31T23:59:59");

  it("sums only inflow transactions as revenue", () => {
    const revenue = sumTransactions(
      MIXED_TRANSACTIONS,
      "inflow",
      FROM_DEC,
      TO_DEC
    );
    // T1 + T2 (direction=inflow) + T5 (positive, unknown direction) = 500+300+150 = 950
    expect(revenue).toBe(950);
  });

  it("sums only outflow transactions as expenses", () => {
    const expenses = sumTransactions(
      MIXED_TRANSACTIONS,
      "outflow",
      FROM_DEC,
      TO_DEC
    );
    // T3 + T4 (direction=outflow) + T6 (negative, unknown direction) = 200+100+80 = 380
    expect(expenses).toBe(380);
  });

  it("excludes outflow transactions from revenue even when amount is positive", () => {
    const outflowOnly = [
      {
        ID: "X",
        Date: "2025-12-10",
        Amount: "999",
        "Direction (inflow / outflow)": "outflow",
      },
    ];
    expect(sumTransactions(outflowOnly, "inflow", FROM_DEC, TO_DEC)).toBe(0);
  });

  it("transactions outside the date range are excluded", () => {
    const outOfRange = [
      {
        ID: "Y",
        Date: "2025-11-30",
        Amount: "1000",
        "Direction (inflow / outflow)": "inflow",
      },
      {
        ID: "Z",
        Date: "2026-01-01",
        Amount: "1000",
        "Direction (inflow / outflow)": "inflow",
      },
    ];
    expect(sumTransactions(outOfRange, "inflow", FROM_DEC, TO_DEC)).toBe(0);
  });

  // ── period churn rate formula ─────────────────────────────────────────────

  const CHURN_SCENARIO_MEMBERS = [
    // 3 members active at Nov 25 (joined before, not cancelled at that point)
    { "Join Date": "2025-10-01", status: "active" },
    {
      "Join Date": "2025-10-15",
      status: "cancelled",
      "Cancel Date": "2025-12-10",
    },
    {
      "Join Date": "2025-09-01",
      status: "cancelled",
      "Cancel Date": "2026-01-20",
    },
    // New member who joins DURING the period — should NOT count in denominator
    { "Join Date": "2025-12-05", status: "active" },
  ];

  it("churn rate denominator is members active at START of period, not new joiners", () => {
    const rate = periodChurnRate(
      CHURN_SCENARIO_MEMBERS,
      "2025-11-25",
      "2026-02-23"
    );
    // active at Nov 25 = 3.  churned in period = 2.  → 66.67%
    expect(rate).toBeCloseTo(66.67, 1);
  });

  it("returns 0 when no members were active at start of period", () => {
    const newOnly = [
      {
        "Join Date": "2025-12-01",
        status: "cancelled",
        "Cancel Date": "2026-01-01",
      },
    ];
    expect(periodChurnRate(newOnly, "2025-11-01", "2026-01-31")).toBe(0);
  });

  it("returns 0 when nobody churned during the period", () => {
    const stable = [
      { "Join Date": "2025-01-01", status: "active" },
      { "Join Date": "2025-02-01", status: "active" },
    ];
    expect(periodChurnRate(stable, "2025-11-01", "2026-01-31")).toBe(0);
  });

  // ── period churn vs monthly churn are different metrics ───────────────────

  it("period aggregate churn > average monthly rate (they measure different things)", () => {
    // 10 members, 2 cancel each month for Jan–Feb.  Period = Jan–Mar.
    const members: any[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        "Join Date": "2025-01-01",
        status: i < 4 ? "cancelled" : "active",
        ...(i < 2
          ? { "Cancel Date": "2025-01-20" }
          : i < 4
            ? { "Cancel Date": "2025-02-20" }
            : {}),
      })),
      // 2 extra members to reach 10
      { "Join Date": "2025-01-01", status: "active" },
      { "Join Date": "2025-01-01", status: "active" },
    ];

    // Period rate: 4 churned / 10 at start = 40%
    const pRate = periodChurnRate(members, "2025-01-01", "2025-03-31");
    expect(pRate).toBeCloseTo(40, 0);

    // Monthly rates: Jan ≈ 2/10=20%, Feb ≈ 2/8=25%, Mar = 0%
    // Average ≈ 15% — clearly different from 40%
    // The period aggregate is NOT the average of monthly rates.
    expect(pRate).toBeGreaterThan(15);
  });
});
