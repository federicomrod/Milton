// components/restaurant/cockpit/CockpitPeriodControl.tsx
//
// Period toggle: last 7 days / month. Cockpit and Sales honour
// lib/restaurant/cockpit-period.ts. Writes ?period= last_7|month.
// On the cockpit, CockpitPeriodShell owns the selected period so the
// click updates immediately; Sales still navigates via the router.

"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import {
  localeFor,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import {
  COCKPIT_PERIOD_PARAM,
  DEFAULT_COCKPIT_PERIOD,
  parseCockpitPeriodPreset,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import { formatPageDateRangeLabel } from "@/lib/restaurant/page-date-range";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCockpitPeriodOptional } from "@/components/restaurant/cockpit/cockpit-period-context";

export function CockpitPeriodControl({
  lang = "es",
  preset,
  range,
  comparisonLabel,
}: {
  lang?: PreferredLanguage;
  preset: CockpitPeriodPreset;
  range: { from: string; to: string } | null;
  comparisonLabel?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const cockpit = useCockpitPeriodOptional();
  const [routerPending, startTransition] = useTransition();
  const locale = localeFor(lang);
  const selected = cockpit?.preset ?? preset;
  const pending = cockpit?.pending ?? routerPending;
  const rangeLabel = range ? formatPageDateRangeLabel(range, locale) : null;

  function select(next: string) {
    const resolved = parseCockpitPeriodPreset(next);
    if (cockpit) {
      cockpit.selectPeriod(resolved);
      return;
    }
    const search = new URLSearchParams(params.toString());
    if (resolved === DEFAULT_COCKPIT_PERIOD) {
      search.delete(COCKPIT_PERIOD_PARAM);
    } else {
      search.set(COCKPIT_PERIOD_PARAM, resolved);
    }
    const qs = search.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  return (
    <div
      data-testid="cockpit-period-control"
      data-pending={pending ? "true" : "false"}
      aria-busy={pending}
      className="inline-flex items-center gap-2 min-h-8"
    >
      <ToggleGroup
        type="single"
        value={selected}
        onValueChange={(value) => {
          if (value) select(value);
        }}
        variant="outline"
        size="sm"
        aria-label={t(lang, "Period", "Periodo", "Zeitraum")}
      >
        <ToggleGroupItem value="last_7" className="px-2.5 text-xs">
          {t(lang, "Last 7 days", "Últimos 7 días", "Letzte 7 Tage")}
        </ToggleGroupItem>
        <ToggleGroupItem value="month" className="px-2.5 text-xs">
          {t(lang, "Month", "Mes", "Monat")}
        </ToggleGroupItem>
      </ToggleGroup>
      {comparisonLabel || rangeLabel ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
          <CalendarRange className="h-3.5 w-3.5 shrink-0" />
          {comparisonLabel ?? rangeLabel}
        </span>
      ) : null}
    </div>
  );
}
