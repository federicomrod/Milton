import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeActiveMembersSeries,
  isActiveMembersKpi,
  isActiveMemberAt,
  parseDatePoint,
  type MemberRecord,
} from "@/lib/kpi-series";

// ---------------------------------------------------------------------------
// isActiveMemberAt — Title Case field names (real uploaded CSV format)
// ---------------------------------------------------------------------------

describe("isActiveMemberAt — Title Case field names", () => {
  // End of Jan 2025
  const janEndMs = new Date(2025, 1, 0, 23, 59, 59, 999).getTime();
  // End of Apr 2025
  const aprEndMs = new Date(2025, 4, 0, 23, 59, 59, 999).getTime();

  it("counts an active member with 'Join Date' (M/D/YY) as active", () => {
    const m = { "Join Date": "1/10/25", Status: "active" };
    expect(isActiveMemberAt(m, janEndMs)).toBe(true);
  });

  it("excludes a member who joins after the date point", () => {
    const m = { "Join Date": "3/5/25", Status: "active" };
    expect(isActiveMemberAt(m, janEndMs)).toBe(false); // not yet joined in Jan
  });

  it("counts a cancelled member as active when Cancel Date is after date point", () => {
    // Cancelled Apr 15, checking at Mar 31 → still active
    const m = {
      "Join Date": "3/5/25",
      Status: "cancelled",
      "Cancel Date": "4/15/25",
    };
    const marEndMs = new Date(2025, 3, 0, 23, 59, 59, 999).getTime();
    expect(isActiveMemberAt(m, marEndMs)).toBe(true);
  });

  it("excludes a cancelled member when Cancel Date is before or on the date point", () => {
    // Cancelled Apr 15, checking at Apr 30 → no longer active
    const m = {
      "Join Date": "3/5/25",
      Status: "cancelled",
      "Cancel Date": "4/15/25",
    };
    expect(isActiveMemberAt(m, aprEndMs)).toBe(false);
  });

  it("handles members who joined before the range (pre-existing active members)", () => {
    const m = { "Join Date": "12/1/24", Status: "active" };
    expect(isActiveMemberAt(m, janEndMs)).toBe(true);
  });

  it("returns false when Join Date is missing", () => {
    const m = { Status: "active" };
    expect(isActiveMemberAt(m as MemberRecord, janEndMs)).toBe(false);
  });

  it("computeActiveMembersSeries works end-to-end with Title Case data", () => {
    const members: MemberRecord[] = [
      { "Join Date": "12/1/24", Status: "active" } as any,
      { "Join Date": "1/10/25", Status: "active" } as any,
      { "Join Date": "1/25/25", Status: "active" } as any,
      { "Join Date": "2/15/25", Status: "active" } as any,
      {
        "Join Date": "3/5/25",
        Status: "cancelled",
        "Cancel Date": "4/15/25",
      } as any,
    ];

    const result = computeActiveMembersSeries(members, {
      periods: ["2025-01", "2025-02", "2025-03", "2025-04"],
    });

    expect(result).toHaveLength(4);
    expect(result[0].value).toBe(3); // Dec + Jan×2 active in Jan
    expect(result[1].value).toBe(4); // + Feb
    expect(result[2].value).toBe(5); // + Mar (M004 cancel Apr 15 > Mar 31)
    expect(result[3].value).toBe(4); // M004 cancelled Apr 15 ≤ Apr 30
  });
});

// ---------------------------------------------------------------------------
// parseDatePoint
// ---------------------------------------------------------------------------

describe("parseDatePoint", () => {
  it("parses ISO date strings", () => {
    const ms = parseDatePoint("2024-06-15");
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getFullYear()).toBe(2024);
    expect(new Date(ms!).getMonth()).toBe(5); // June = 5
  });

  it("parses Excel serial numbers", () => {
    // Excel serial 45057 = 2023-05-01
    const ms = parseDatePoint(45057);
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getFullYear()).toBe(2023);
  });

  it("returns null for undefined/null", () => {
    expect(parseDatePoint(undefined)).toBeNull();
    expect(parseDatePoint(null)).toBeNull();
    expect(parseDatePoint("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isActiveMembersKpi
// ---------------------------------------------------------------------------

describe("isActiveMembersKpi", () => {
  it("detects by name", () => {
    expect(isActiveMembersKpi("Active Members (End of Month)", null)).toBe(
      true
    );
    expect(isActiveMembersKpi("active members", null)).toBe(true);
  });

  it("detects by formula", () => {
    expect(
      isActiveMembersKpi(
        "My KPI",
        "COUNT(members WHERE join_date <= :date_point)"
      )
    ).toBe(true);
  });

  it("rejects unrelated KPIs", () => {
    expect(isActiveMembersKpi("New Members", null)).toBe(false);
    expect(isActiveMembersKpi("Churn Rate", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeActiveMembersSeries — core series logic
// ---------------------------------------------------------------------------

describe("computeActiveMembersSeries", () => {
  const members: MemberRecord[] = [
    { id: "1", join_date: "2024-01-15", status: "active" },
    { id: "2", join_date: "2024-02-01", status: "active" },
    {
      id: "3",
      join_date: "2024-01-01",
      status: "cancelled",
      status_change_date: "2024-03-01",
    },
  ];

  it("returns one point per requested period", () => {
    const result = computeActiveMembersSeries(members, {
      periods: ["2024-01", "2024-02", "2024-03"],
    });
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.period)).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
    ]);
  });

  it("counts active members correctly at each month-end", () => {
    const result = computeActiveMembersSeries(members, {
      periods: ["2024-01", "2024-02", "2024-03", "2024-04"],
    });

    // Jan: member 1 (joined Jan 15, active) + member 3 (joined Jan 1, cancelled Mar 1 > Jan end) = 2
    expect(result[0].value).toBe(2);
    // Feb: member 1 + member 2 (joined Feb 1) + member 3 (cancelled Mar 1 > Feb end) = 3
    expect(result[1].value).toBe(3);
    // Mar: member 1 + member 2 (member 3 cancelled Mar 1 = not active at Mar end) = 2
    expect(result[2].value).toBe(2);
    // Apr: member 1 + member 2 = 2
    expect(result[3].value).toBe(2);
  });

  it("respects the selected date range (only requested periods appear)", () => {
    const result = computeActiveMembersSeries(members, {
      periods: ["2024-06", "2024-07"],
    });
    expect(result).toHaveLength(2);
    // Both members 1 and 2 are active, member 3 cancelled before June
    expect(result[0].value).toBe(2);
  });

  it("returns 0 members when none have joined yet", () => {
    const result = computeActiveMembersSeries(members, {
      periods: ["2023-12"],
    });
    expect(result[0].value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Date range filtering — calculateNewMonthlyMembers logic (pure, no Supabase)
// ---------------------------------------------------------------------------

describe("new members date range filtering", () => {
  /** Reproduces the core logic of calculateNewMonthlyMembers without Supabase. */
  function countNewMembersByMonth(
    members: { join_date: string }[],
    fromDate: string,
    toDate: string
  ) {
    const monthlyStats: Record<string, number> = {};
    members.forEach((m) => {
      const joinDate = new Date(m.join_date);
      if (joinDate >= new Date(fromDate) && joinDate < new Date(toDate)) {
        const period = joinDate.toISOString().substring(0, 7);
        monthlyStats[period] = (monthlyStats[period] ?? 0) + 1;
      }
    });
    return Object.entries(monthlyStats)
      .map(([period, value]) => ({ period: `${period}-01`, value }))
      .sort(
        (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
      );
  }

  const members = [
    { join_date: "2024-01-10" },
    { join_date: "2024-02-05" },
    { join_date: "2024-02-20" },
    { join_date: "2024-06-01" },
    { join_date: "2023-11-15" }, // before range
  ];

  it("returns all months within range", () => {
    const result = countNewMembersByMonth(members, "2024-01-01", "2024-07-01");
    expect(result.map((p) => p.period)).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-06-01",
    ]);
    expect(result[0].value).toBe(1); // Jan: 1
    expect(result[1].value).toBe(2); // Feb: 2
    expect(result[2].value).toBe(1); // Jun: 1
  });

  it("excludes members outside the selected range", () => {
    const result = countNewMembersByMonth(members, "2024-02-01", "2024-03-01");
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(2);
  });

  it("returns empty array for a range with no joins", () => {
    const result = countNewMembersByMonth(members, "2025-01-01", "2025-06-01");
    expect(result).toHaveLength(0);
  });

  it("changing the date range changes the output", () => {
    const jan = countNewMembersByMonth(members, "2024-01-01", "2024-02-01");
    const jun = countNewMembersByMonth(members, "2024-06-01", "2024-07-01");
    expect(jan[0].value).toBe(1);
    expect(jun[0].value).toBe(1);
    expect(jan[0].period).not.toBe(jun[0].period);
  });
});

// ---------------------------------------------------------------------------
// Period label formatting — mirrors kpis-grid.tsx formatPeriodLabel
// ---------------------------------------------------------------------------

describe("formatPeriodLabel", () => {
  const MONTH_ABBR = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  /** Inline copy of the logic from kpis-grid.tsx */
  function formatPeriodLabel(period: string): string {
    const match = period.match(/^(\d{4})-(\d{2})/);
    if (match) {
      const [, year, month] = match;
      return `${MONTH_ABBR[Number(month) - 1]} '${year.slice(2)}`;
    }
    return period;
  }

  it('formats "2024-01" as "Jan \'24"', () => {
    expect(formatPeriodLabel("2024-01")).toBe("Jan '24");
  });

  it('formats "2025-12" as "Dec \'25"', () => {
    expect(formatPeriodLabel("2025-12")).toBe("Dec '25");
  });

  it("passes through non-date strings unchanged", () => {
    expect(formatPeriodLabel("Current")).toBe("Current");
  });

  it('formats "YYYY-MM-01" (from calculation functions)', () => {
    expect(formatPeriodLabel("2024-07-01")).toBe("Jul '24");
  });

  it('formats "YYYY-MM-31" (full date, month-end)', () => {
    expect(formatPeriodLabel("2025-07-31")).toBe("Jul '25");
  });

  it("produces different labels for different months", () => {
    expect(formatPeriodLabel("2024-01")).not.toBe(formatPeriodLabel("2024-02"));
    expect(formatPeriodLabel("2024-01-01")).not.toBe(
      formatPeriodLabel("2024-02-01")
    );
  });
});

// ---------------------------------------------------------------------------
// getModelDataRows helper — verifies it resolves table IDs correctly
// ---------------------------------------------------------------------------

describe("getModelDataRows", () => {
  it("returns empty array when table not found in data_tables", async () => {
    const { getModelDataRows } =
      await import("@/lib/kpi-calculations/getModelDataRows");

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        eq: vi.fn().mockReturnThis(),
      }),
    } as any;

    const result = await getModelDataRows(supabase, "company-123", "members");
    expect(result).toEqual([]);
  });

  it("fetches rows using model_table_id (not model_table_name)", async () => {
    const { getModelDataRows } =
      await import("@/lib/kpi-calculations/getModelDataRows");

    const fakeTableId = "table-uuid-abc";
    const fakeRows = [
      { data: { id: "m1", join_date: "2024-01-01", status: "active" } },
      { data: [{ id: "m2", join_date: "2024-02-01", status: "active" }] },
    ];

    let eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: fakeTableId }, error: null }),
      eq: vi.fn().mockImplementation((...args: any[]) => {
        eqCalls.push(`${args[0]}=${args[1]}`);
        // Last call resolves with rows
        if (eqCalls.length >= 2) {
          return { data: fakeRows, error: null };
        }
        return mockChain;
      }),
    };

    const supabase = { from: vi.fn().mockReturnValue(mockChain) } as any;

    const result = await getModelDataRows(supabase, "company-123", "members");

    // Must use model_table_id, never model_table_name
    expect(eqCalls.some((c) => c.startsWith("model_table_id="))).toBe(true);
    expect(eqCalls.every((c) => !c.startsWith("model_table_name="))).toBe(true);

    // Should flatten both single-object and array rows
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("m1");
    expect(result[1].id).toBe("m2");
  });

  it("tries fallback table names in order", async () => {
    const { getModelDataRows } =
      await import("@/lib/kpi-calculations/getModelDataRows");

    let callCount = 0;
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        // First table name (members) not found, second (customers) found
        maybeSingle: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1)
            return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { id: "t-id-99" }, error: null });
        }),
        eq: vi.fn().mockReturnThis(),
        // Final rows fetch
        then: vi.fn(),
      }),
    } as any;

    // Override eq to return rows on 2nd call
    let eqCount = 0;
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: { id: "t-id-99" }, error: null });
      }),
      eq: vi.fn().mockImplementation(() => {
        eqCount++;
        if (eqCount >= 2) return Promise.resolve({ data: [], error: null });
        return chain;
      }),
    };
    supabase.from.mockReturnValue(chain);

    await getModelDataRows(supabase, "company-xyz", "members", "customers");
    // Should have tried at least 2 table lookups
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
