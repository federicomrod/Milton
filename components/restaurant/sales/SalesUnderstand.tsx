// components/restaurant/sales/SalesUnderstand.tsx
//
// Default Sales view: compact heatmap + highlights + 2–3 summaries.
// Numbers arrive already computed.

"use client";

import { useState } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { SalesInsights } from "@/lib/restaurant/sales-insights";
import { DINNER_START_HOUR } from "@/lib/restaurant/sales-revenue";
import {
  SalesHeatmap,
  type HeatmapMetric,
} from "@/components/restaurant/cockpit/SalesHeatmap";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SalesHighlights } from "./SalesHighlights";
import { SalesDetailLink } from "./SalesDetailLink";

export function SalesUnderstand({
  insights,
  currency,
  timezone,
  lang,
  detailHref,
}: {
  insights: SalesInsights;
  currency: string;
  timezone: string;
  lang: PreferredLanguage;
  detailHref: string;
}) {
  const [metric, setMetric] = useState<HeatmapMetric>("net");

  return (
    <section data-testid="sales-understand" className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
        <div className="lg:col-span-2 rounded-md border border-border bg-background px-3 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                {t(lang, "When you make money", "Cuándo se vende")}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t(
                  lang,
                  `Restaurant timezone ${timezone}. Lunch before ${DINNER_START_HOUR}:00; dinner from ${DINNER_START_HOUR}:00.`,
                  `Zona horaria ${timezone}. Almuerzo antes de las ${DINNER_START_HOUR}:00; cena desde las ${DINNER_START_HOUR}:00.`
                )}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={metric}
              onValueChange={(value) => {
                if (value === "net" || value === "tickets") setMetric(value);
              }}
              variant="outline"
              size="sm"
              aria-label={t(lang, "Heatmap metric", "Métrica del mapa")}
              data-testid="heatmap-metric-toggle"
            >
              <ToggleGroupItem value="net" className="px-2.5 text-xs">
                {t(lang, "Net sales", "Ventas netas")}
              </ToggleGroupItem>
              <ToggleGroupItem value="tickets" className="px-2.5 text-xs">
                {t(lang, "Tickets", "Tickets")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <SalesHeatmap
            cells={insights.heatmap}
            currency={currency}
            lang={lang}
            metric={metric}
            compact
          />
          <div className="mt-1 flex justify-end">
            <SalesDetailLink href={`${detailHref}#horario`} lang={lang} />
          </div>
        </div>
        <SalesHighlights highlights={insights.highlights} lang={lang} />
      </div>

      <div
        data-testid="sales-summaries"
        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
      >
        {insights.summaries.map((row) => (
          <div
            key={row.id}
            className="rounded-md border border-border px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {row.label}
            </p>
            <p className="text-lg font-semibold tabular-nums mt-0.5">
              {row.value}
            </p>
            <p className="text-[11px] text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
