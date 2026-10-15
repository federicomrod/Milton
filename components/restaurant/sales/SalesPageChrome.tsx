// components/restaurant/sales/SalesPageChrome.tsx
//
// Shared Sales / detalle header: period chip honours the cockpit contract.
// One Ask Milton action sits top-right of the Sales header.

import { Suspense } from "react";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { CockpitPeriodControl } from "@/components/restaurant/cockpit/CockpitPeriodControl";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitPeriodPreset } from "@/lib/restaurant/cockpit-period";
import { SalesPeriodAskButton } from "./SalesPeriodAskButton";

export function SalesPageHeader({
  lang,
  title,
  periodPreset,
  range,
  comparisonLabel,
  periodAskQuestion,
}: {
  lang: PreferredLanguage;
  title?: string;
  periodPreset: CockpitPeriodPreset;
  range: { from: string; to: string } | null;
  comparisonLabel?: string | null;
  periodAskQuestion?: string | null;
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
      // One «Preguntar a Milton»: with a question for this period it IS the header's button.
      hideAskButton={!!periodAskQuestion}
      trailing={
        periodAskQuestion ? (
          <SalesPeriodAskButton question={periodAskQuestion} lang={lang} />
        ) : null
      }
    />
  );
}
