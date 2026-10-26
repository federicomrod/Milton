import { describe, expect, it } from "vitest";
import {
  buildKitchenInsights,
  countText,
  extractKitchenItemName,
  kitchenExploreCaption,
  resolveKitchenItemLabel,
  type KitchenEventBundle,
  type KitchenReportEvent,
} from "@/lib/restaurant/kitchen-insights";

const TODAY = "2026-07-31";
const PERIOD = { from: "2026-07-25", to: "2026-07-31" };
const report = (
  id: string,
  text: string,
  type: KitchenReportEvent["report_type"] = "running_out"
): KitchenReportEvent => ({
  id,
  location_id: "loc",
  staff_id: "cook-1",
  staff_name: "Ana",
  report_type: type,
  text,
  media_kind: null,
  created_at: `${TODAY}T16:00:00.000Z`,
  resolved_at: null,
  local_date: TODAY,
  local_hour: 11,
  local_minute: 0,
});
const bundle = (
  reports: KitchenReportEvent[],
  ingredients?: KitchenEventBundle["ingredients"]
): KitchenEventBundle => ({
  reports,
  drafts: [],
  staff: [{ id: "cook-1", display_name: "Ana", is_active: true }],
  ingredients,
});
const build = (b: KitchenEventBundle, lang: "es" | "en" = "es") =>
  buildKitchenInsights(b, lang, { period: PERIOD, todayKey: TODAY });

const RAW = "harina y ahora está a un dólar con 90 el kilogra";

describe("what a report is about (label order: ingredient → product → raw)", () => {
  const ings = [
    { id: "i1", name: "Harina de trigo" },
    { id: "i2", name: "Tomate" },
  ];
  it("the product name is pulled out of the cook's sentence", () => {
    expect(extractKitchenItemName(RAW)).toBe("harina");
    expect(
      extractKitchenItemName("se acabó el aguacate y ahora está a 3.50")
    ).toBe("aguacate");
    expect(extractKitchenItemName("se acabó la harina")).toBe("harina");
  });
  it("1. a matched ingredient shows ITS name", () => {
    expect(
      resolveKitchenItemLabel("harina de trigo y ahora está a 1.90", ings)
    ).toBe("Harina de trigo");
    expect(resolveKitchenItemLabel("se acabó el jitomate", ings)).toBe(
      "Tomate"
    );
  });
  it("2. no ingredient: the extracted product name (never the whole sentence)", () => {
    expect(resolveKitchenItemLabel(RAW, [])).toBe("harina");
    expect(resolveKitchenItemLabel(RAW, undefined)).toBe("harina");
    expect(resolveKitchenItemLabel("se acabó el aguacate", ings)).toBe(
      "aguacate"
    );
  });
  it("3. neither: the raw text, truncated to 48", () => {
    const long = "x".repeat(80);
    const label = resolveKitchenItemLabel(`   ${long}`, []);
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.startsWith("x")).toBe(true);
    expect(resolveKitchenItemLabel("   ", ings)).toBe("");
    expect(resolveKitchenItemLabel(null, ings)).toBe("");
  });
  it("the Cocina feed, summary hint and Explorar › Se agota show the product, not the sentence", () => {
    const said = "harina de trigo y ahora está a un dólar con 90 el kilogra";
    const insights = build(
      bundle([report("r1", said)], [{ id: "i1", name: "Harina de trigo" }])
    );
    expect(insights.feed[0].title).toBe("Harina de trigo");
    expect(insights.summaries[0].hint).toBe("Harina de trigo");
    expect(insights.explore.running_out[0].label).toBe("Harina de trigo");
    expect(insights.explore.history[0].label).toBe("Harina de trigo");
    // «harina» alone is NOT «Harina de trigo» (exact / synonym only): the
    // extracted product name is shown, still never the whole sentence.
    const none = build(
      bundle([report("r1", RAW)], [{ id: "i1", name: "Harina de trigo" }])
    );
    expect(none.feed[0].title).toBe("harina");
    expect(JSON.stringify(none)).not.toContain("kilogra");
  });
});

describe("plurals on the Cocina cards and header", () => {
  it("countText", () => {
    expect(countText(0, "producto", "productos")).toBe("0 productos");
    expect(countText(1, "producto", "productos")).toBe("1 producto");
    expect(countText(2, "producto", "productos")).toBe("2 productos");
  });
  it.each([
    [0, "0 productos"],
    [1, "1 producto"],
    [2, "2 productos"],
  ])("Se agota card: %i products → «%s»", (n, text) => {
    const names = ["aguacate", "tomate", "cebolla"].slice(0, n);
    const insights = build(
      bundle(names.map((p, i) => report(`r${i}`, `se acabó el ${p}`)))
    );
    const card = insights.summaries.find((s) => s.id === "running_out")!;
    expect(card.value).toBe(text);
    expect(card.value).not.toMatch(/^1 productos/);
  });
  it.each([
    [0, "0 reportes hoy"],
    [1, "1 reporte hoy"],
    [2, "2 reportes hoy"],
  ])("Merma card: %i reports → «%s»", (n, text) => {
    const insights = build(
      bundle(
        Array.from({ length: n }, (_, i) =>
          report(`w${i}`, `tiramos aguacate ${i}`, "waste")
        )
      )
    );
    expect(insights.summaries.find((s) => s.id === "waste")!.value).toBe(text);
  });
  it("the header line and the Explorar captions: 1 / 2 / 0", () => {
    const one = build(bundle([report("r1", "se acabó el aguacate")]));
    expect(one.headline).toContain("1 producto por agotarse");
    expect(one.headline).toContain("0 reportes de merma");
    expect(kitchenExploreCaption("running_out", one, "es")).toBe(
      "1 producto por agotarse"
    );
    const two = build(
      bundle([
        report("r1", "se acabó el aguacate"),
        report("r2", "se acabó el tomate"),
      ])
    );
    expect(two.headline).toContain("2 productos por agotarse");
    expect(kitchenExploreCaption("running_out", two, "es")).toBe(
      "2 productos por agotarse"
    );
    const zero = build(bundle([]));
    expect(kitchenExploreCaption("running_out", zero, "es")).toBe(
      "0 productos por agotarse"
    );
    expect(kitchenExploreCaption("drafts", zero, "es")).toContain(
      "0 borradores por confirmar"
    );
  });
  it("drafts caption: 1 borrador / 2 borradores", () => {
    const base = build(bundle([]));
    expect(
      kitchenExploreCaption("drafts", { ...base, pending_drafts: 1 }, "es")
    ).toBe("1 borrador por confirmar · aún no cuenta en costos");
    expect(
      kitchenExploreCaption("drafts", { ...base, pending_drafts: 2 }, "es")
    ).toBe("2 borradores por confirmar · aún no cuentan en costos");
  });
  it("English follows the same rule", () => {
    const en = build(bundle([report("r1", "se acabó el aguacate")]), "en");
    expect(en.summaries[0].value).toBe("1 item");
  });
});
