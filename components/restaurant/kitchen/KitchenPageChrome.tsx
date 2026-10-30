// components/restaurant/kitchen/KitchenPageChrome.tsx
//
// Kitchen header: same period chip as Sales, one Ask Milton top-right.

import { Suspense } from "react";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { CockpitPeriodControl } from "@/components/restaurant/cockpit/CockpitPeriodControl";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitPeriodPreset } from "@/lib/restaurant/cockpit-period";
import { KitchenPeriodAskButton } from "./KitchenPeriodAskButton";

export function KitchenPageHeader({
  lang,
  periodPreset,
  range,
  comparisonLabel,
  periodAskQuestion,
}: {
  lang: PreferredLanguage;
  periodPreset: CockpitPeriodPreset;
  range: { from: string; to: string } | null;
  comparisonLabel?: string | null;
  periodAskQuestion?: string | null;
}) {
  return (
    <OperatingPageHeader
      title={t(lang, "Kitchen", "Cocina", "Küche")}
      lang={lang}
      dateRange={
        <Suspense fallback={<PageSkeleton width="16rem" height="2rem" />}>
          <CockpitPeriodControl
            lang={lang}
            preset={periodPreset}
            range={range}
            comparisonLabel={comparisonLabel}
          />
        </Suspense>
      }
      hideAskButton={!!periodAskQuestion}
      trailing={
        periodAskQuestion ? (
          <KitchenPeriodAskButton question={periodAskQuestion} lang={lang} />
        ) : null
      }
    />
  );
}
