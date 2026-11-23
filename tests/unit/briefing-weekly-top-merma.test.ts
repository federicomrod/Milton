// tests/unit/briefing-weekly-top-merma.test.ts
//
// Issue #532: weekly top 3 merma block in the daily briefing. Covers:
//   * Top 3 items by value lost (confirmed kitchen_waste_lines only)
//   * Last 7 days window in the company timezone
//   * Empty state (no confirmed waste => empty array, not fake zeros)
//   * Multi-company/location scoping (never mix restaurants)
//   * Ingredient/component name resolution

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildBriefingContext } from "@/lib/restaurant/briefing-context";
import { buildDeterministicBriefing } from "@/lib/restaurant/briefing-prompt";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)(
  "Briefing weekly top 3 merma (#532)",
  () => {
    it("ranks items by money lost descending and takes top 3", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      // Create test company and location
      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Merma Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      // Create a waste report
      const { data: report } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();
      expect(report).toBeTruthy();

      // Create 5 waste lines with different values (only 3 should appear)
      const lines = [
        { item_name: "Tomate", value: 150, report_date: "2026-11-20" },
        { item_name: "Aguacate", value: 300, report_date: "2026-11-20" },
        { item_name: "Cebolla", value: 50, report_date: "2026-11-20" },
        { item_name: "Pollo", value: 500, report_date: "2026-11-20" },
        { item_name: "Lechuga", value: 25, report_date: "2026-11-20" },
      ];

      for (const line of lines) {
        await supabase.from("kitchen_waste_lines").insert({
          company_id: company!.id,
          location_id: location!.id,
          report_id: report!.id,
          item_name: line.item_name,
          value: line.value,
          currency: "USD",
          status: "confirmed",
          report_date: line.report_date,
        });
      }

      // Build context (now = 2026-11-23, so last 7 days = 2026-11-16 to 2026-11-22)
      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toHaveLength(3);
      expect(ctx.top_merma_items![0].item_name).toBe("Pollo");
      expect(ctx.top_merma_items![0].value).toBe(500);
      expect(ctx.top_merma_items![1].item_name).toBe("Aguacate");
      expect(ctx.top_merma_items![1].value).toBe(300);
      expect(ctx.top_merma_items![2].item_name).toBe("Tomate");
      expect(ctx.top_merma_items![2].value).toBe(150);

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("only includes confirmed waste lines (never draft)", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Confirmed Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      const { data: report } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();
      expect(report).toBeTruthy();

      // Create draft and confirmed lines
      await supabase.from("kitchen_waste_lines").insert([
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report!.id,
          item_name: "Tomate draft",
          value: 500,
          currency: "USD",
          status: "draft",
          report_date: "2026-11-20",
        },
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report!.id,
          item_name: "Aguacate confirmed",
          value: 100,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-20",
        },
      ]);

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toHaveLength(1);
      expect(ctx.top_merma_items![0].item_name).toBe("Aguacate confirmed");

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("respects the 7-day window in the company timezone", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({
          name: "Test Timezone Co",
          preferred_language: "es",
          briefing_email_timezone: "America/El_Salvador",
        })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      const { data: report } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();
      expect(report).toBeTruthy();

      // Create lines: one within 7 days, one outside
      // now = 2026-11-23, so last 7 days = 2026-11-16 to 2026-11-22
      await supabase.from("kitchen_waste_lines").insert([
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report!.id,
          item_name: "Recent waste",
          value: 200,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-20", // within window
        },
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report!.id,
          item_name: "Old waste",
          value: 500,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-10", // outside window
        },
      ]);

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00-06:00") } // El Salvador time
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toHaveLength(1);
      expect(ctx.top_merma_items![0].item_name).toBe("Recent waste");

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("returns empty array when no confirmed waste exists", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Empty Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toEqual([]);

      // Cleanup
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("scopes to selected location in multi-restaurant setup", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Multi Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location1 } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Location 1",
          currency: "USD",
        })
        .select()
        .single();
      expect(location1).toBeTruthy();

      const { data: location2 } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Location 2",
          currency: "USD",
        })
        .select()
        .single();
      expect(location2).toBeTruthy();

      // Create reports for both locations
      const { data: report1 } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location1!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();

      const { data: report2 } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location2!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();

      // Create waste lines for both locations
      await supabase.from("kitchen_waste_lines").insert([
        {
          company_id: company!.id,
          location_id: location1!.id,
          report_id: report1!.id,
          item_name: "Location 1 waste",
          value: 200,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-20",
        },
        {
          company_id: company!.id,
          location_id: location2!.id,
          report_id: report2!.id,
          item_name: "Location 2 waste",
          value: 500,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-20",
        },
      ]);

      // Build context scoped to location 1
      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        { locationId: location1!.id, brandId: null },
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toHaveLength(1);
      expect(ctx.top_merma_items![0].item_name).toBe("Location 1 waste");
      expect(ctx.top_merma_items![0].value).toBe(200);

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("aggregates same item across multiple reports", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Aggregate Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      // Create two reports
      const { data: report1 } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();

      const { data: report2 } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-21",
          status: "confirmed",
        })
        .select()
        .single();

      // Same item appears in both reports
      await supabase.from("kitchen_waste_lines").insert([
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report1!.id,
          item_name: "Tomate",
          value: 100,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-20",
        },
        {
          company_id: company!.id,
          location_id: location!.id,
          report_id: report2!.id,
          item_name: "Tomate",
          value: 150,
          currency: "USD",
          status: "confirmed",
          report_date: "2026-11-21",
        },
      ]);

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      expect(ctx.top_merma_items).toBeDefined();
      expect(ctx.top_merma_items!).toHaveLength(1);
      expect(ctx.top_merma_items![0].item_name).toBe("Tomate");
      expect(ctx.top_merma_items![0].value).toBe(250); // 100 + 150

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("includes merma in deterministic briefing when data exists", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test Briefing Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      const { data: report } = await supabase
        .from("kitchen_reports")
        .insert({
          company_id: company!.id,
          location_id: location!.id,
          report_type: "waste",
          report_date: "2026-11-20",
          status: "confirmed",
        })
        .select()
        .single();

      await supabase.from("kitchen_waste_lines").insert({
        company_id: company!.id,
        location_id: location!.id,
        report_id: report!.id,
        item_name: "Aguacate",
        value: 300,
        currency: "USD",
        status: "confirmed",
        report_date: "2026-11-20",
      });

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      const briefing = buildDeterministicBriefing(ctx);

      // Should include merma in risks
      const hasWasteRisk = briefing.top_risks.some(
        (risk) => risk.includes("Aguacate") && risk.includes("merma")
      );
      expect(hasWasteRisk).toBe(true);

      // Cleanup
      await supabase
        .from("kitchen_waste_lines")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("kitchen_reports")
        .delete()
        .eq("company_id", company!.id);
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });

    it("omits merma section when no confirmed waste exists", async () => {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: company } = await supabase
        .from("companies")
        .insert({ name: "Test No Waste Co", preferred_language: "es" })
        .select()
        .single();
      expect(company).toBeTruthy();

      const { data: location } = await supabase
        .from("restaurant_locations")
        .insert({
          company_id: company!.id,
          name: "Test Location",
          currency: "USD",
        })
        .select()
        .single();
      expect(location).toBeTruthy();

      const ctx = await buildBriefingContext(
        supabase as never,
        company!.id,
        null,
        { now: new Date("2026-11-23T10:00:00Z") }
      );

      const briefing = buildDeterministicBriefing(ctx);

      // Should NOT mention waste
      const hasWasteRisk = briefing.top_risks.some(
        (risk) =>
          risk.toLowerCase().includes("merma") ||
          risk.toLowerCase().includes("waste")
      );
      expect(hasWasteRisk).toBe(false);

      // Cleanup
      await supabase
        .from("restaurant_locations")
        .delete()
        .eq("company_id", company!.id);
      await supabase.from("companies").delete().eq("id", company!.id);
    });
  }
);
