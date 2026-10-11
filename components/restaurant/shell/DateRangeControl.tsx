// components/restaurant/shell/DateRangeControl.tsx
//
// Read-only "period shown" chip. Loaders do not honour ?from=/?to= yet
// (PR 2), so this must not look like a working filter.

"use client";

import { CalendarRange } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  formatPageDateRangeLabel,
  type PageDateRange,
} from "@/lib/restaurant/page-date-range";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DateRangeControl({
  lang = "es",
  range,
}: {
  lang?: PreferredLanguage;
  range: PageDateRange | null;
}) {
  if (!range) return null;
  const locale = lang === "es" ? "es" : "en-US";
  const label = formatPageDateRangeLabel(range, locale);
  const hint = t(
    lang,
    "Date filtering arrives in the next version",
    "El filtro por fechas llega con la siguiente versión"
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="page-date-range"
          data-readonly="true"
          tabIndex={0}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-muted/40 text-sm font-medium text-muted-foreground cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-label={`${t(lang, "Period shown", "Periodo mostrado")}: ${label}. ${hint}`}
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
