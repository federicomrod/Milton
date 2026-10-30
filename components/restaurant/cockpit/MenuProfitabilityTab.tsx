// components/restaurant/cockpit/MenuProfitabilityTab.tsx
//
// Menú › Resumen for a company on the CSV bridge (no Odoo products).
// R1-09b: no margin-risk cards (D5) and no setup checklist (D1); the
// table's Estado says what is missing.

import { ProfitabilityKpisSection } from "@/components/restaurant/ProfitabilityCockpit";
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
            {t(
              lang,
              "Menu profitability",
              "Rentabilidad del menú",
              "Rentabilität der Speisekarte"
            )}{" "}
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
    </div>
  );
}
