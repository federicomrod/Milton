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
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export function MenuProfitabilityTab({
  profitability,
  lang = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
}: {
  profitability: ProfitabilityData;
  lang?: PreferredLanguage;
}) {
  return (
    <div className="space-y-6">
      {/* TODO(step 2, #123): category mix + popularity vs margin dish matrix
          once recipe costs exist. Left out of step 1 so this PR stays to
          revenue definition + Sales hero. */}
      <ProfitabilityKpisSection data={profitability} lang={lang} />
      <section>
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-base font-semibold">
            {t(lang, "Menu profitability", "Rentabilidad del menú")}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({profitability.marginRows.length})
            </span>
          </h2>
        </div>
        <MenuProfitabilityTable
          rows={profitability.marginRows}
          currency={profitability.kpis.currency}
          lang={lang}
        />
      </section>
      <MarginRiskSection data={profitability} lang={lang} />
      <details className="rounded-md border border-border bg-background">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-muted/30">
          {t(lang, "Costing setup checklist", "Lista de costeo")}
        </summary>
        <div className="px-4 pb-4 pt-2">
          <DataQualityChecklistSection data={profitability} lang={lang} />
        </div>
      </details>
    </div>
  );
}
