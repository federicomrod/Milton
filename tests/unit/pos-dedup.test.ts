// tests/unit/pos-dedup.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteSalesForReplace } from "@/lib/restaurant/pos-dedup";
import type { PosSalesItemInsert } from "@/lib/restaurant/pos-import";

describe("deleteSalesForReplace", () => {
  let mockSupabase: any;
  let mockDeleteQuery: any;

  beforeEach(() => {
    mockDeleteQuery = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
    };

    mockSupabase = {
      from: vi.fn(() => ({
        delete: vi.fn(() => mockDeleteQuery),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      })),
    };
  });

  it("deletes only mapped location_ids in date range for multi-location company", async () => {
    const companyId = "company-123";
    const inserts: PosSalesItemInsert[] = [
      {
        company_id: companyId,
        sale_date: "2026-01-15",
        location_id: "loc-1",
        order_id: "1001",
        raw_item_name: "Item A",
        quantity: 1,
        gross_revenue: 10,
        net_revenue: 10,
        currency: "MXN",
        source_type: "csv",
      },
      {
        company_id: companyId,
        sale_date: "2026-01-16",
        location_id: "loc-2",
        order_id: "1002",
        raw_item_name: "Item B",
        quantity: 1,
        gross_revenue: 20,
        net_revenue: 20,
        currency: "MXN",
        source_type: "csv",
      },
    ];
    const mappedLocationIds = new Set(["loc-1", "loc-2"]);

    // Mock successful delete
    mockDeleteQuery.in = vi.fn().mockResolvedValue({ error: null, count: 15 });

    const result = await deleteSalesForReplace(
      mockSupabase as any,
      companyId,
      inserts,
      mappedLocationIds
    );

    expect(result.deletedCount).toBe(15);
    expect(result.error).toBeUndefined();

    // Verify delete query construction
    expect(mockSupabase.from).toHaveBeenCalledWith("pos_sales_items");
    expect(mockDeleteQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(mockDeleteQuery.gte).toHaveBeenCalledWith("sale_date", "2026-01-15");
    expect(mockDeleteQuery.lte).toHaveBeenCalledWith("sale_date", "2026-01-16");
    expect(mockDeleteQuery.in).toHaveBeenCalledWith("location_id", ["loc-1", "loc-2"]);
  });

  it("refuses unmapped multi-location company with no delete call", async () => {
    const companyId = "company-456";
    const inserts: PosSalesItemInsert[] = [
      {
        company_id: companyId,
        sale_date: "2026-01-15",
        location_id: null,
        order_id: "1001",
        raw_item_name: "Item A",
        quantity: 1,
        gross_revenue: 10,
        net_revenue: 10,
        currency: "MXN",
        source_type: "csv",
      },
    ];
    const mappedLocationIds = new Set<string>(); // No location mapped

    // Mock company with 2 locations
    mockSupabase.from = vi.fn((table: string) => {
      if (table === "restaurant_locations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "loc-a" }, { id: "loc-b" }],
            error: null,
          }),
        };
      }
      return {
        delete: vi.fn(() => mockDeleteQuery),
      };
    });

    const result = await deleteSalesForReplace(
      mockSupabase as any,
      companyId,
      inserts,
      mappedLocationIds
    );

    expect(result.deletedCount).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("multi_location_unmapped");
    expect(result.error!.message).toContain("varios locales");

    // Verify no delete was attempted
    expect(mockDeleteQuery.eq).not.toHaveBeenCalled();
  });

  it("scopes delete to single location for unmapped single-location company", async () => {
    const companyId = "company-789";
    const inserts: PosSalesItemInsert[] = [
      {
        company_id: companyId,
        sale_date: "2026-01-15",
        location_id: null,
        order_id: "1001",
        raw_item_name: "Item A",
        quantity: 1,
        gross_revenue: 10,
        net_revenue: 10,
        currency: "MXN",
        source_type: "csv",
      },
    ];
    const mappedLocationIds = new Set<string>(); // No location mapped

    // Mock company with 1 location
    const mockSelectQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: "loc-only" }],
        error: null,
      }),
    };

    mockSupabase.from = vi.fn((table: string) => {
      if (table === "restaurant_locations") {
        return mockSelectQuery;
      }
      return {
        delete: vi.fn(() => mockDeleteQuery),
      };
    });

    mockDeleteQuery.eq = vi.fn().mockReturnThis();
    mockDeleteQuery.gte = vi.fn().mockReturnThis();
    mockDeleteQuery.lte = vi.fn().mockReturnThis();
    // Final eq call returns promise
    const finalEqSpy = vi.fn().mockResolvedValue({ error: null, count: 5 });
    mockDeleteQuery.eq = vi.fn((field: string, value: any) => {
      if (field === "location_id") {
        return { error: null, count: 5 };
      }
      return mockDeleteQuery;
    });

    // Need to properly chain the calls
    let callCount = 0;
    mockDeleteQuery.eq = vi.fn((field: string, value: any) => {
      callCount++;
      if (field === "location_id" && value === "loc-only") {
        // This is the final call
        return Promise.resolve({ error: null, count: 5 });
      }
      return mockDeleteQuery;
    });

    const result = await deleteSalesForReplace(
      mockSupabase as any,
      companyId,
      inserts,
      mappedLocationIds
    );

    expect(result.deletedCount).toBe(5);
    expect(result.error).toBeUndefined();

    // Verify location was scoped
    expect(mockDeleteQuery.eq).toHaveBeenCalledWith("location_id", "loc-only");
  });

  it("does not touch sales outside date range", async () => {
    const companyId = "company-999";
    const inserts: PosSalesItemInsert[] = [
      {
        company_id: companyId,
        sale_date: "2026-01-15",
        location_id: "loc-1",
        order_id: "1001",
        raw_item_name: "Item A",
        quantity: 1,
        gross_revenue: 10,
        net_revenue: 10,
        currency: "MXN",
        source_type: "csv",
      },
      {
        company_id: companyId,
        sale_date: "2026-01-20",
        location_id: "loc-1",
        order_id: "1002",
        raw_item_name: "Item B",
        quantity: 1,
        gross_revenue: 20,
        net_revenue: 20,
        currency: "MXN",
        source_type: "csv",
      },
    ];
    const mappedLocationIds = new Set(["loc-1"]);

    mockDeleteQuery.in = vi.fn().mockResolvedValue({ error: null, count: 3 });

    const result = await deleteSalesForReplace(
      mockSupabase as any,
      companyId,
      inserts,
      mappedLocationIds
    );

    // Verify date range is correctly bounded
    expect(mockDeleteQuery.gte).toHaveBeenCalledWith("sale_date", "2026-01-15");
    expect(mockDeleteQuery.lte).toHaveBeenCalledWith("sale_date", "2026-01-20");

    // Sales outside this range (e.g. 2026-01-14 or 2026-01-21) won't be deleted
    // because they're filtered out by the gte/lte constraints
    expect(result.deletedCount).toBe(3);
  });

  it("returns 0 when no inserts provided", async () => {
    const result = await deleteSalesForReplace(
      mockSupabase as any,
      "company-empty",
      [],
      new Set()
    );

    expect(result.deletedCount).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("returns 0 when inserts have no dates", async () => {
    const inserts: PosSalesItemInsert[] = [
      {
        company_id: "company-no-date",
        sale_date: null as any,
        location_id: "loc-1",
        order_id: "1001",
        raw_item_name: "Item A",
        quantity: 1,
        gross_revenue: 10,
        net_revenue: 10,
        currency: "MXN",
        source_type: "csv",
      },
    ];

    const result = await deleteSalesForReplace(
      mockSupabase as any,
      "company-no-date",
      inserts,
      new Set(["loc-1"])
    );

    expect(result.deletedCount).toBe(0);
    expect(result.error).toBeUndefined();
  });
});
