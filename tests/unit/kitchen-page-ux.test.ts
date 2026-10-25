import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { KITCHEN_HREF } from "@/lib/restaurant/navigation";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const KITCHEN_REACT = [
  "components/restaurant/kitchen/KitchenPageLive.tsx",
  "components/restaurant/kitchen/KitchenAttentionFeed.tsx",
  "components/restaurant/kitchen/KitchenHighlights.tsx",
  "components/restaurant/kitchen/KitchenHighlightsUpgrade.tsx",
  "components/restaurant/kitchen/KitchenSummaries.tsx",
  "components/restaurant/kitchen/KitchenExplore.tsx",
  "components/restaurant/kitchen/KitchenPageChrome.tsx",
  "components/restaurant/kitchen/KitchenPeriodAskButton.tsx",
  "app/dashboard/restaurant/kitchen/page.tsx",
];

const KITCHEN_COPY = [
  ...KITCHEN_REACT,
  "lib/restaurant/kitchen-insights.ts",
  "lib/restaurant/kitchen-page-data.ts",
];

function spanishSlots(src: string): string[] {
  const out: string[] = [];
  const re =
    /t\(\s*(?:lang|"es"|RESTAURANT_COCKPIT_DEFAULT_LANGUAGE)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(m[2]);
  }
  return out;
}

describe("Kitchen page IA (#148)", () => {
  it("keeps the Kitchen route and uses the Sales period shell", () => {
    expect(KITCHEN_HREF).toBe("/dashboard/restaurant/kitchen");
    const page = read("app/dashboard/restaurant/kitchen/page.tsx");
    const chrome = read("components/restaurant/kitchen/KitchenPageChrome.tsx");
    const loader = read("lib/restaurant/kitchen-page-data.ts");
    expect(page).toContain("KitchenPageLive");
    expect(page).toContain("<Suspense");
    expect(page).toContain("KitchenHighlightsUpgrade");
    expect(chrome).toContain("CockpitPeriodControl");
    expect(chrome).toContain("KitchenPeriodAskButton");
    expect(loader).toContain("loadCockpitExecutiveFast");
    expect(loader).toContain("parseCockpitPeriodPreset");
    expect(loader).toContain("resolveCockpitPeriod");
    expect(loader).toContain("fetchKitchenAttentionBundle");
    expect(loader).toContain("timeCockpitStep");
    expect(loader).toContain("buildKitchenInsights");
  });

  it("does not put KPI aggregation in React", () => {
    for (const file of KITCHEN_REACT) {
      const src = read(file);
      expect(src, file).not.toContain("buildKitchenInsights(");
      expect(src, file).not.toContain("extractKitchenItemName");
      expect(src, file).not.toContain("openLowStockReports");
      expect(src, file).not.toContain("kitchen_attention_feed");
    }
  });

  it("does not remove the old Cockpit tabs", () => {
    const cockpit = read("components/restaurant/ProfitabilityCockpit.tsx");
    expect(cockpit).toContain("CockpitTabs");
    const page = read("app/dashboard/restaurant/kitchen/page.tsx");
    expect(page).not.toContain("ProfitabilityCockpit");
  });

  it("does not touch vercel, CI, secrets or costs-import", () => {
    expect(read("lib/restaurant/kitchen-page-data.ts")).not.toContain(
      "cost-import"
    );
    expect(read("lib/restaurant/kitchen-insights.ts")).not.toContain(
      "cost-workbook"
    );
  });
});

describe("Spanish completeness and copy guards for Kitchen (#148)", () => {
  it("ships the required Spanish operator copy and one Ask Milton", () => {
    const page = read("app/dashboard/restaurant/kitchen/page.tsx");
    const chrome = read("components/restaurant/kitchen/KitchenPageChrome.tsx");
    const ask = read(
      "components/restaurant/kitchen/KitchenPeriodAskButton.tsx"
    );
    const feed = read("components/restaurant/kitchen/KitchenAttentionFeed.tsx");
    const highlights = read(
      "components/restaurant/kitchen/KitchenHighlights.tsx"
    );
    const live = read("components/restaurant/kitchen/KitchenPageLive.tsx");
    expect(chrome).toContain("Cocina");
    expect(ask).toContain("Preguntar a Milton");
    expect(ask).not.toContain("Pregúntale a Milton");
    expect(feed).toContain("Necesita atención hoy");
    expect(highlights).toContain("Lo que destaca");
    expect(highlights).not.toContain("openAskMilton");
    expect(highlights).not.toContain("Preguntar a Milton");
    expect(ask).toContain("kitchen-ask-milton");
    expect(page).not.toContain("KitchenPeriodAskButton");
    expect(
      read("components/restaurant/kitchen/KitchenSummaries.tsx")
    ).toContain("Pendiente de recetas");
    expect(read("lib/restaurant/kitchen-insights.ts")).toContain(
      "Pendiente de recetas"
    );
    expect(read("lib/restaurant/kitchen-insights.ts")).toContain(
      "Aún no disponible"
    );
    expect(read("lib/restaurant/kitchen-insights.ts")).toContain(
      "Nada necesita atención en la cocina ahora."
    );
    const askCount = (live.match(/Preguntar a Milton/g) ?? []).length;
    expect(askCount).toBe(0);
  });

  it("never names Telegram in the Kitchen UI", () => {
    for (const file of [
      ...KITCHEN_REACT,
      "components/restaurant/kitchen/KitchenQrCard.tsx",
      "components/restaurant/kitchen/KitchenStaffCard.tsx",
      "components/restaurant/kitchen/KitchenReportsCard.tsx",
      "components/restaurant/kitchen/KitchenRecipeDraftsCard.tsx",
    ]) {
      const src = read(file);
      const visible = src
        .split("\n")
        .filter(
          (line) =>
            !line.trim().startsWith("//") && !line.trim().startsWith("*")
        )
        .join("\n")
        // The one place that says where cook recipes come from (the card's
        // description, agreed copy): «por Telegram o que subes desde un archivo».
        .replace(/por Telegram o que subes/g, "");
      expect(visible, file).not.toMatch(/Telegram/i);
    }
  });

  it("does not put English chrome in t() Spanish slots", () => {
    const banned = [
      /\bOverview\b/,
      /Not available yet/,
      /What stands out/,
      /Ask Milton about/,
      /Needs attention today/,
      /Pending recipes/,
    ];
    for (const file of KITCHEN_COPY) {
      const src = read(file);
      for (const es of spanishSlots(src)) {
        for (const pattern of banned) {
          expect(es, `${file}: ${es}`).not.toMatch(pattern);
        }
      }
    }
  });
});
