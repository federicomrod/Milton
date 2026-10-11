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
import { DataHealthIndicator } from "@/components/restaurant/shell/DataHealthIndicator";
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
  costSlot,
  insightsUpgrade,
  children,
}: {
  lang: PreferredLanguage;
  initialPreset: CockpitPeriodPreset;
  executives: CockpitExecutivesByPeriod;
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

          {children}
        </div>
      </div>
    </CockpitPeriodContext.Provider>
  );
}
