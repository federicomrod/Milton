// components/restaurant/sales/SalesPageChrome.tsx
//
// Shared Sales / detalle header: period chip honours the cockpit contract.

import { Suspense } from "react";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { CockpitPeriodControl } from "@/components/restaurant/cockpit/CockpitPeriodControl";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitPeriodPreset } from "@/lib/restaurant/cockpit-period";

export function SalesPageHeader({
  lang,
  title,
  periodPreset,
  range,
  comparisonLabel,
}: {
  lang: PreferredLanguage;
  title?: string;
  periodPreset: CockpitPeriodPreset;
  range: { from: string; to: string } | null;
  comparisonLabel?: string | null;
}) {
  return (
    <OperatingPageHeader
      title={title ?? t(lang, "Sales", "Ventas")}
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
    />
  );
}
