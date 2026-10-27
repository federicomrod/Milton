// Legacy CFO write routes had no live callers after the restaurant
// shell stopped wrapping every page. They are gone. Synthetic data only.
import { existsSync } from "fs";
import { describe, expect, it } from "vitest";

describe("deleted routes", () => {
  it("legacy CFO routes with no live callers are gone", () => {
    const gone = [
      "app/api/data/upload/route.ts",
      "app/api/kpis/select/route.ts",
      "app/api/kpis/calculate/route.ts",
      "app/api/kpis/selected/route.ts",
      "app/api/kpis/series/route.ts",
      "app/api/data/status/route.ts",
      "app/api/data/delete-model-table/route.ts",
      "app/api/data/normalize-values/route.ts",
      "app/api/data/parse/route.ts",
      "app/api/data/sources/route.ts",
      "app/api/data/table-names/route.ts",
      "app/api/data/table-preview/route.ts",
      "app/api/data/upload-model-table/route.ts",
      "app/api/business-type/route.ts",
      "app/api/chat/route.ts",
      "app/api/model-data/tables/route.ts",
      "app/api/onboarding/kpi-preferences/route.ts",
      "app/api/onboarding/rank-kpis/route.ts",
      "app/api/report-data/route.ts",
      "app/api/scenarios/route.ts",
      "app/api/scenarios/[id]/route.ts",
      "app/api/analytics/financial-metrics/route.ts",
    ];
    for (const f of gone) expect(existsSync(f), f).toBe(false);
  });
});
