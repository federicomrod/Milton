// components/restaurant/cockpit/CockpitPeriodShell.tsx
//
// Client island for Month <-> Last 7 days. Both executive snapshots are
// already on the page (one 031 rollup). The toggle updates local state
// immediately, then writes ?period= in the background so a shareable URL
// does not wait on costs / insights / tabs.

"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PAGINATED_READ_SAFETY_CAP } from "@/lib/restaurant/paginated-read";
import {
  COCKPIT_PERIOD_PARAM,
  DEFAULT_COCKPIT_PERIOD,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type {
  CockpitExecutiveView,
  CockpitExecutivesByPeriod,
} from "@/lib/restaurant/cockpit-page-data";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  DataHealthBanner,
  DataHealthIndicator,
} from "@/components/restaurant/shell/DataHealthIndicator";
import { CockpitOnboardingChip } from "@/components/restaurant/cockpit/CockpitOnboardingChip";
import { CockpitPeriodControl } from "@/components/restaurant/cockpit/CockpitPeriodControl";
import { CockpitHeadline } from "@/components/restaurant/cockpit/CockpitHeadline";
import { CockpitKpiStrip } from "@/components/restaurant/cockpit/CockpitKpiStrip";
import { CockpitHeroChart } from "@/components/restaurant/cockpit/CockpitHeroChart";
import { CockpitChannelBreakdown } from "@/components/restaurant/cockpit/CockpitChannelBreakdown";
import { CockpitInsightsCard } from "@/components/restaurant/cockpit/CockpitInsightsCard";
import { CockpitPeriodContext } from "@/components/restaurant/cockpit/cockpit-period-context";

export function CockpitPeriodShell({
  lang,
  initialPreset,
  executives,
  readError,
  truncated,
  costSlot,
  insightsUpgrade,
  children,
}: {
  lang: PreferredLanguage;
  initialPreset: CockpitPeriodPreset;
  executives: CockpitExecutivesByPeriod;
  readError: boolean;
  truncated: boolean;
  costSlot?: ReactNode;
  insightsUpgrade?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [preset, setPreset] = useState<CockpitPeriodPreset>(initialPreset);
  const [pending, startTransition] = useTransition();

  const selectPeriod = useCallback(
    (next: CockpitPeriodPreset) => {
      setPreset(next);
      const search = new URLSearchParams(params.toString());
      if (next === DEFAULT_COCKPIT_PERIOD) {
        search.delete(COCKPIT_PERIOD_PARAM);
      } else {
        search.set(COCKPIT_PERIOD_PARAM, next);
      }
      const qs = search.toString();
      startTransition(() => {
        router.replace(qs ? `?${qs}` : "?", { scroll: false });
      });
    },
    [params, router]
  );

  const value = useMemo(
    () => ({ preset, pending, executives, selectPeriod }),
    [preset, pending, executives, selectPeriod]
  );
  const executive: CockpitExecutiveView | null = executives[preset];

  return (
    <CockpitPeriodContext.Provider value={value}>
      <div className="w-full py-3 px-6 lg:px-10">
        <div className="space-y-3">
          <OperatingPageHeader
            title={t(lang, "Cockpit", "Cockpit")}
            lang={lang}
            dateRange={
              <CockpitPeriodControl
                lang={lang}
                preset={preset}
                range={executive ? executive.snapshot.period.current : null}
                comparisonLabel={executive?.comparisonLabel}
              />
            }
          />
          {executive ? (
            <div className="flex items-center gap-2 flex-wrap">
              {executive.setup ? (
                <CockpitOnboardingChip lang={lang} progress={executive.setup} />
              ) : null}
              <DataHealthIndicator lang={lang} health={executive.health} />
            </div>
          ) : null}

          {executive ? <CockpitHeadline text={executive.headline} /> : null}

          {executive ? (
            <CockpitKpiStrip
              model={executive.kpis}
              lang={lang}
              costSlot={costSlot}
            />
          ) : null}

          {executive ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
              <div className="lg:col-span-2">
                <CockpitHeroChart
                  lang={lang}
                  currency={executive.snapshot.currency}
                  points={executive.snapshot.daily}
                />
              </div>
              <CockpitChannelBreakdown
                lang={lang}
                currency={executive.snapshot.currency}
                channels={executive.snapshot.channels}
              />
            </div>
          ) : null}

          {executive ? (
            preset === initialPreset && insightsUpgrade ? (
              insightsUpgrade
            ) : (
              <CockpitInsightsCard
                lang={lang}
                insights={executive.insights.insights}
                source={executive.insights.source}
              />
            )
          ) : null}

          {executive?.health.tone === "error" || readError ? (
            <DataHealthBanner tone="error">
              {t(
                lang,
                "Could not load all sales rows. Totals are unavailable — they are not a smaller number from a partial read. Try refreshing the page.",
                "No se pudieron cargar todas las ventas. Los totales no están disponibles: no son un número más chico de una lectura parcial. Recarga la página."
              )}
            </DataHealthBanner>
          ) : null}

          {truncated && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 p-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {t(
                  lang,
                  `Totals may be incomplete. This view stopped after ${PAGINATED_READ_SAFETY_CAP.toLocaleString("es-MX")} rows. The numbers shown are partial.`,
                  `Los totales pueden estar incompletos. Esta vista se detuvo después de ${PAGINATED_READ_SAFETY_CAP.toLocaleString("es-MX")} filas. Los números que ves son parciales.`
                )}
              </span>
            </div>
          )}

          {children}
        </div>
      </div>
    </CockpitPeriodContext.Provider>
  );
}
