// components/restaurant/cockpit/MenuProfitabilityTab.tsx
//
// Existing Menu tab body. Shared by the cockpit and the Menu area.

import {
  DataQualityChecklistSection,
  MarginRiskSection,
  ProfitabilityKpisSection,
} from "@/components/restaurant/ProfitabilityCockpit";
import { MenuProfitabilityTable } from "@/components/restaurant/cockpit/MenuProfitabilityTable";
import type { ProfitabilityData } from "@/lib/restaurant/profitability-server";

export function MenuProfitabilityTab({
  profitability,
}: {
  profitability: ProfitabilityData;
}) {
  return (
    <div className="space-y-6">
      {/* TODO(step 2, #123): category mix + popularity vs margin dish matrix
          once recipe costs exist. Left out of step 1 so this PR stays to
          revenue definition + Sales hero. */}
      <ProfitabilityKpisSection data={profitability} />
      <section>
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-base font-semibold">
            Menu profitability{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({profitability.marginRows.length})
            </span>
          </h2>
        </div>
        <MenuProfitabilityTable
          rows={profitability.marginRows}
          currency={profitability.kpis.currency}
        />
      </section>
      <MarginRiskSection data={profitability} />
      <details className="rounded-md border border-border bg-background">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-muted/30">
          Costing setup checklist
        </summary>
        <div className="px-4 pb-4 pt-2">
          <DataQualityChecklistSection data={profitability} />
        </div>
      </details>
    </div>
  );
}
