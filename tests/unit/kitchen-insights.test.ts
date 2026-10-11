import { describe, it, expect } from "vitest";
import {
  buildKitchenInsights,
  extractKitchenItemName,
  filterFeed,
  kitchenItemKey,
  openLowStockReports,
  pendingRecipesLabel,
  type KitchenDraftEvent,
  type KitchenEventBundle,
  type KitchenReportEvent,
  type KitchenStaffRow,
} from "@/lib/restaurant/kitchen-insights";

const TODAY = "2026-07-31";
const PERIOD = { from: "2026-07-25", to: "2026-07-31" };

function report(
  partial: Partial<KitchenReportEvent> &
    Pick<KitchenReportEvent, "id" | "report_type" | "text">
): KitchenReportEvent {
  return {
    location_id: "loc-a",
    staff_id: "cook-1",
    staff_name: "Cocina",
    media_kind: null,
    created_at: `${partial.local_date ?? TODAY}T16:00:00.000Z`,
    resolved_at: null,
    local_date: TODAY,
    local_hour: 11,
    local_minute: 42,
    ...partial,
  };
}

function draft(
  partial: Partial<KitchenDraftEvent> & Pick<KitchenDraftEvent, "id">
): KitchenDraftEvent {
  return {
    dish_name: "Salsa ranchera",
    portions: 24,
    status: "draft",
    staff_name: "Cocinero",
    created_at: `${TODAY}T15:30:00.000Z`,
    local_date: TODAY,
    local_hour: 9,
    local_minute: 30,
    has_photo: true,
    ...partial,
  };
}

function staff(id: string, name: string, is_active = true): KitchenStaffRow {
  return { id, display_name: name, is_active };
}

function bundle(over: Partial<KitchenEventBundle> = {}): KitchenEventBundle {
  return {
    reports: [
      report({
        id: "r1",
        report_type: "running_out",
        text: "Se está acabando costilla de res",
      }),
      report({
        id: "r2",
        report_type: "running_out",
        text: "se está acabando tortillas de maíz",
        local_hour: 10,
        local_minute: 15,
        created_at: `${TODAY}T16:15:00.000Z`,
      }),
      report({
        id: "r2b",
        report_type: "running_out",
        text: "tortillas de maíz quedan poco",
        staff_id: "cook-2",
        staff_name: "Ana",
        local_hour: 10,
        created_at: `${TODAY}T16:10:00.000Z`,
      }),
      report({
        id: "r3",
        report_type: "waste",
        text: "Merma de aguacate",
        local_date: "2026-07-30",
        created_at: "2026-07-30T18:20:00.000Z",
      }),
      report({
        id: "r4",
        report_type: "waste",
        text: "aguacate tiramos",
        local_date: "2026-07-30",
        staff_id: "cook-2",
        created_at: "2026-07-30T16:00:00.000Z",
      }),
      report({
        id: "r5",
        report_type: "waste",
        text: "Merma de aguacate",
        local_date: "2026-07-29",
        created_at: "2026-07-29T12:00:00.000Z",
      }),
      report({
        id: "r6",
        report_type: "waste",
        text: "Merma de aguacate",
        local_date: TODAY,
        local_hour: 11,
        created_at: `${TODAY}T17:00:00.000Z`,
      }),
    ],
    drafts: [draft({ id: "d1" })],
    staff: [
      staff("cook-1", "Cocina"),
      staff("cook-2", "Ana"),
      staff("cook-3", "Luis"),
    ],
    ...over,
  };
}

describe("extractKitchenItemName", () => {
  it("strips Spanish report prefixes and never invents a name", () => {
    expect(extractKitchenItemName("Se está acabando costilla de res")).toBe(
      "costilla de res"
    );
    expect(extractKitchenItemName("Merma de aguacate")).toBe("aguacate");
    expect(extractKitchenItemName("86 salmón")).toBe("salmón");
    expect(extractKitchenItemName("")).toBe("");
    expect(extractKitchenItemName(null)).toBe("");
  });

  it("groups the same product regardless of accents or prefix", () => {
    expect(kitchenItemKey("Se está acabando tortillas de maíz")).toBe(
      kitchenItemKey("tortillas de maiz quedan poco")
    );
  });
});

describe("buildKitchenInsights contract", () => {
  it("counts match the underlying kitchen events", () => {
    const insights = buildKitchenInsights(bundle(), "es", {
      period: PERIOD,
      todayKey: TODAY,
    });
    expect(insights.today_running_out).toBe(2);
    expect(insights.today_waste).toBe(1);
    expect(insights.pending_drafts).toBe(1);
    expect(insights.counts.running_out).toBe(2);
    expect(insights.counts.waste).toBe(1);
    expect(insights.counts.drafts).toBe(1);
    expect(insights.counts.all).toBe(4);
    expect(insights.headline).toContain("2 productos por agotarse");
    expect(insights.headline).toContain("1 reporte de merma");
    expect(insights.headline).toContain("1 borrador de receta por revisar");
  });

  it("never invents a waste value — always Pendiente de recetas", () => {
    const insights = buildKitchenInsights(bundle(), "es", {
      period: PERIOD,
      todayKey: TODAY,
    });
    const waste = insights.summaries.find((s) => s.id === "waste");
    expect(waste?.pending_value).toBe(true);
    expect(insights.pending_recipes_label).toBe("Pendiente de recetas");
    expect(pendingRecipesLabel("es")).toBe("Pendiente de recetas");
    expect(
      insights.explore.waste.every(
        (row) =>
          row.pending_value && row.estimated_value === "Pendiente de recetas"
      )
    ).toBe(true);
    const json = JSON.stringify(insights);
    expect(json).not.toMatch(/\$\d/);
    expect(json).not.toMatch(/valor estimado"?\s*:\s*\d/i);
  });

  it("marks recipe drafts as not counting in costs", () => {
    const insights = buildKitchenInsights(bundle(), "es", {
      period: PERIOD,
      todayKey: TODAY,
    });
    const drafts = insights.summaries.find((s) => s.id === "drafts");
    expect(drafts?.hint).toMatch(/Nada cuenta en costos/);
    expect(insights.feed.some((item) => item.kind === "drafts")).toBe(true);
    expect(
      insights.feed.find((item) => item.kind === "drafts")?.detail
    ).toMatch(/falta tu confirmación/);
  });

  it("computes 3 facts from the reports — AI is not involved here", () => {
    const insights = buildKitchenInsights(bundle(), "es", {
      period: PERIOD,
      todayKey: TODAY,
    });
    expect(insights.highlights).toHaveLength(3);
    expect(insights.highlights.map((h) => h.id)).toEqual([
      "most_reported",
      "peak_hour",
      "staff_active",
    ]);
    const top = insights.highlights.find((h) => h.id === "most_reported");
    expect(top?.value).toMatch(/Aguacate/i);
    expect(top?.value).toContain("4 reportes de merma");
    expect(insights.insightFacts).toHaveLength(3);
    expect(
      insights.insightFacts.every((f) => f.kind.startsWith("kitchen_"))
    ).toBe(true);
  });

  it("scopes waste to the selected period and keeps unresolved low-stock", () => {
    const extra: KitchenReportEvent = report({
      id: "old-open",
      report_type: "running_out",
      text: "Se está acabando crema",
      local_date: "2026-07-01",
      created_at: "2026-07-01T12:00:00.000Z",
    });
    const outsideWaste = report({
      id: "old-waste",
      report_type: "waste",
      text: "Merma de lechuga",
      local_date: "2026-06-01",
      created_at: "2026-06-01T12:00:00.000Z",
    });
    const insights = buildKitchenInsights(
      bundle({ reports: [...bundle().reports, extra, outsideWaste] }),
      "es",
      { period: PERIOD, todayKey: TODAY }
    );
    expect(insights.today_running_out).toBe(3);
    expect(
      insights.explore.waste.some((row) => /lechuga/i.test(row.label))
    ).toBe(false);
    expect(openLowStockReports([extra, outsideWaste])).toHaveLength(1);
  });

  it("fails closed across companies by only using the provided bundle", () => {
    const other = report({
      id: "other",
      location_id: "loc-b",
      report_type: "waste",
      text: "Merma de pollo",
    });
    const scoped = bundle();
    const mixed = buildKitchenInsights(
      { ...scoped, reports: [...scoped.reports, other] },
      "es",
      { period: PERIOD, todayKey: TODAY }
    );
    const onlyA = buildKitchenInsights(scoped, "es", {
      period: PERIOD,
      todayKey: TODAY,
    });
    expect(mixed.counts.waste).toBe(onlyA.counts.waste + 1);
    expect(onlyA.explore.waste.some((row) => /pollo/i.test(row.label))).toBe(
      false
    );
  });

  it("returns a Spanish empty state when nothing needs attention", () => {
    const insights = buildKitchenInsights(
      { reports: [], drafts: [], staff: [] },
      "es",
      { period: PERIOD, todayKey: TODAY }
    );
    expect(insights.availability).toBe("empty");
    expect(insights.empty_feed).toBe(
      "Nada necesita atención en la cocina ahora."
    );
    expect(insights.highlights).toEqual([]);
    expect(filterFeed(insights.feed, "all")).toEqual([]);
  });

  it("does not treat resolved low-stock as open", () => {
    const insights = buildKitchenInsights(
      bundle({
        reports: [
          report({
            id: "done",
            report_type: "running_out",
            text: "Se está acabando crema",
            resolved_at: `${TODAY}T18:00:00.000Z`,
          }),
        ],
        drafts: [],
      }),
      "es",
      { period: PERIOD, todayKey: TODAY }
    );
    expect(insights.today_running_out).toBe(0);
    expect(insights.counts.running_out).toBe(0);
  });
});
