// components/restaurant/shell/DateRangeControl.tsx
//
// Compact header date-range control. Writes `?from=` / `?to=` while
// keeping `?location=` and any hash. Presets reuse rangeForPreset from
// the existing Sync now date logic.

"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  defaultPageDateRange,
  formatPageDateRangeLabel,
  parsePageDateRange,
  type PageDateRange,
} from "@/lib/restaurant/page-date-range";
import { rangeForPreset } from "@/lib/restaurant/odoo/sync-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export function DateRangeControl({
  lang = "es",
}: {
  lang?: PreferredLanguage;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parsePageDateRange(searchParams);
  const locale = lang === "es" ? "es" : "en-US";
  const label = formatPageDateRangeLabel(range, locale);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  function apply(next: PageDateRange) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(DATE_FROM_PARAM, next.from);
    params.set(DATE_TO_PARAM, next.to);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setCustomFrom(next.from);
    setCustomTo(next.to);
  }

  const thisMonth = defaultPageDateRange();
  const lastMonth = rangeForPreset("last_month");
  const last7 = rangeForPreset("last_7_days");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="page-date-range"
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-label={t(lang, "Date range", "Rango de fechas")}
        >
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onClick={() => apply(thisMonth)}>
          {t(lang, "This month", "Este mes")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => apply({ from: lastMonth.start, to: lastMonth.end })}
        >
          {t(lang, "Last month", "El mes pasado")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => apply({ from: last7.start, to: last7.end })}
        >
          {t(lang, "Last 7 days", "Últimos 7 días")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-2 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t(lang, "Custom", "Personalizado")}
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 text-xs"
              aria-label={t(lang, "From date", "Desde")}
            />
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 text-xs"
              aria-label={t(lang, "To date", "Hasta")}
            />
          </div>
          <button
            type="button"
            className="w-full h-8 rounded-md border border-border text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            onClick={() => apply({ from: customFrom, to: customTo })}
          >
            {t(lang, "Apply", "Aplicar")}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
