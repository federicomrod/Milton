// components/restaurant/cockpit/CockpitPeriodControl.tsx
//
// Cockpit-only period toggle: last 7 days / month. Other pages keep the
// read-only DateRangeControl. Writes ?period= last_7|month.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  COCKPIT_PERIOD_PARAM,
  DEFAULT_COCKPIT_PERIOD,
  parseCockpitPeriodPreset,
  type CockpitPeriodPreset,
} from "@/lib/restaurant/cockpit-period";
import { formatPageDateRangeLabel } from "@/lib/restaurant/page-date-range";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
  const locale = lang === "es" ? "es" : "en-US";
  const rangeLabel = range ? formatPageDateRangeLabel(range, locale) : null;

  function select(next: string) {
    const resolved = parseCockpitPeriodPreset(next);
    const search = new URLSearchParams(params.toString());
    if (resolved === DEFAULT_COCKPIT_PERIOD) {
      search.delete(COCKPIT_PERIOD_PARAM);
    } else {
      search.set(COCKPIT_PERIOD_PARAM, resolved);
    }
    const qs = search.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div
      data-testid="cockpit-period-control"
      className="inline-flex items-center gap-2 min-h-8"
    >
      <ToggleGroup
        type="single"
        value={preset}
        onValueChange={(value) => {
          if (value) select(value);
        }}
        variant="outline"
        size="sm"
        aria-label={t(lang, "Period", "Periodo")}
      >
        <ToggleGroupItem value="last_7" className="px-2.5 text-xs">
          {t(lang, "Last 7 days", "Últimos 7 días")}
        </ToggleGroupItem>
        <ToggleGroupItem value="month" className="px-2.5 text-xs">
          {t(lang, "Month", "Mes")}
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
