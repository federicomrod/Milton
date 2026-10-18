// components/restaurant/cockpit/SalesHeatmap.tsx
//
// Hour × weekday heatmap of net sales. Lightweight SVG — no extra chart
// dependency. Colors are the brand-blue sequential scale (lib/restaurant/ui/heat-scale).

"use client";

import { useEffect, useRef, useState } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { HeatmapCell } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";
import { heatColor, heatText } from "@/lib/restaurant/ui/heat-scale";

export type HeatmapDisplayCell = HeatmapCell & {
  avg_ticket?: number;
  typical_net?: number;
  vs_typical_pct?: number | null;
};

const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function cellFill(intensity: number): string {
  // The same blue scale as Ventas › hora × día (lib/restaurant/ui/heat-scale).
  return heatColor(intensity <= 0 ? null : intensity);
}

export type HeatmapMetric = "net" | "tickets";

/** Fixed row height of the heatmap, in pixels (R1-14). */
export const HEATMAP_ROW_PX = 15;
const MAX_HEATMAP_WIDTH = 760;
const HEATMAP_LABEL_PX = 16;

/** Height of the drawing for N hour rows (labels + rows + padding). */
export function heatmapHeightPx(hourRows: number): number {
  return HEATMAP_LABEL_PX + hourRows * HEATMAP_ROW_PX + 4;
}

export function SalesHeatmap({
  cells,
  currency,
  lang,
  metric = "net",
  compact = false,
  selected = null,
  onSelectCell,
}: {
  cells: HeatmapDisplayCell[];
  currency: string;
  lang: PreferredLanguage;
  metric?: HeatmapMetric;
  compact?: boolean;
  selected?: HeatmapDisplayCell | null;
  onSelectCell?: (cell: HeatmapDisplayCell) => void;
}) {
  const [focus, setFocus] = useState<HeatmapDisplayCell | null>(null);
  const locale = localeForCurrency(currency);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const days = lang === "es" ? WEEKDAY_SHORT_ES : WEEKDAY_SHORT_EN;
  const hours = Array.from(new Set(cells.map((c) => c.hour))).sort(
    (a, b) => a - b
  );
  const max = cells.reduce(
    (m, c) => Math.max(m, metric === "tickets" ? c.tickets : c.net_sales),
    0
  );
  const byKey = new Map(
    cells.map((c) => [`${c.weekday}-${c.hour}`, c] as const)
  );

  // R1-14: drawn at its real pixel size (never scaled up from a small
  // viewBox): the columns share the width the card gives it, the rows have a
  // FIXED small height, so 12-14 hours take about a quarter of a laptop
  // screen instead of filling it.
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setBoxWidth(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const labelW = 30;
  const labelH = HEATMAP_LABEL_PX;
  const cellH = HEATMAP_ROW_PX;
  const width = Math.max(
    240,
    compact ? boxWidth : Math.min(boxWidth, MAX_HEATMAP_WIDTH)
  );
  const cellW = (width - labelW - 4) / 7;
  const height = heatmapHeightPx(hours.length);

  return (
    <div>
      <div ref={box} className="w-full">
        <svg
          role="img"
          aria-label={t(
            lang,
            "Net sales by hour and weekday",
            "Ventas netas por hora y día"
          )}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full"
        >
          {days.map((label, weekday) => (
            <text
              key={label}
              x={labelW + weekday * cellW + cellW / 2}
              y={12}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {label}
            </text>
          ))}
          {hours.map((hour, row) => {
            const y = labelH + row * cellH;
            return (
              <g key={hour}>
                <text
                  x={labelW - 6}
                  y={y + cellH / 2 + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {String(hour).padStart(2, "0")}
                </text>
                {days.map((_, weekday) => {
                  const cell = byKey.get(`${weekday}-${hour}`);
                  const net = cell?.net_sales ?? 0;
                  const tickets = cell?.tickets ?? 0;
                  const value = metric === "tickets" ? tickets : net;
                  const intensity = max > 0 ? value / max : 0;
                  const x = labelW + weekday * cellW;
                  const exact = `${days[weekday]} ${String(hour).padStart(2, "0")}:00 — ${money.format(net)}`;
                  return (
                    <g key={`${weekday}-${hour}`}>
                      <rect
                        x={x + 1}
                        y={y + 1}
                        width={cellW - 2}
                        height={cellH - 2}
                        rx={2}
                        fill={cellFill(intensity)}
                        stroke={
                          (selected &&
                            selected.weekday === weekday &&
                            selected.hour === hour) ||
                          (focus &&
                            focus.weekday === weekday &&
                            focus.hour === hour)
                            ? "#151c2c"
                            : "transparent"
                        }
                        tabIndex={0}
                        role="button"
                        aria-label={exact}
                        onMouseEnter={() =>
                          setFocus(
                            cell ?? {
                              weekday,
                              weekday_key: "Sunday",
                              hour,
                              net_sales: 0,
                              tickets: 0,
                            }
                          )
                        }
                        onMouseLeave={() => setFocus(null)}
                        onFocus={() =>
                          setFocus(
                            cell ?? {
                              weekday,
                              weekday_key: "Sunday",
                              hour,
                              net_sales: 0,
                              tickets: 0,
                            }
                          )
                        }
                        onBlur={() => setFocus(null)}
                        onClick={() =>
                          onSelectCell?.(
                            cell ?? {
                              weekday,
                              weekday_key: "Sunday",
                              hour,
                              net_sales: 0,
                              tickets: 0,
                            }
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          onSelectCell?.(
                            cell ?? {
                              weekday,
                              weekday_key: "Sunday",
                              hour,
                              net_sales: 0,
                              tickets: 0,
                            }
                          );
                        }}
                      >
                        <title>{exact}</title>
                      </rect>
                      {!compact && net > 0 && intensity > 0.35 ? (
                        <text
                          x={x + cellW / 2}
                          y={y + cellH / 2 + 3}
                          textAnchor="middle"
                          fontSize="8"
                          fill={heatText(intensity)}
                          className="pointer-events-none"
                        >
                          {metric === "tickets" ? tickets : Math.round(net)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <p
        className="text-xs text-muted-foreground mt-1.5 min-h-4 rounded-sm px-1.5 py-0.5"
        aria-live="polite"
        data-heatmap-exact={focus ? "true" : "false"}
      >
        {focus
          ? focusCaption(focus, days, money, lang)
          : t(
              lang,
              "Hover or focus a cell for the exact net sales.",
              "Pasa el cursor o enfoca una celda para ver el monto exacto."
            )}
      </p>
    </div>
  );
}

function focusCaption(
  focus: HeatmapDisplayCell,
  days: readonly string[],
  money: Intl.NumberFormat,
  lang: PreferredLanguage
): string {
  const parts = [
    `${days[focus.weekday]} ${String(focus.hour).padStart(2, "0")}:00 — ${money.format(focus.net_sales)}`,
    `${focus.tickets} ${t(lang, "tickets", "tickets")}`,
  ];
  if (focus.avg_ticket != null && focus.tickets > 0) {
    parts.push(
      `${t(lang, "avg ticket", "ticket promedio")} ${money.format(focus.avg_ticket)}`
    );
  }
  if (focus.vs_typical_pct != null) {
    const signed =
      focus.vs_typical_pct > 0
        ? `+${focus.vs_typical_pct.toFixed(0)}%`
        : `${focus.vs_typical_pct.toFixed(0)}%`;
    parts.push(`${signed} ${t(lang, "vs typical hour", "vs hora típica")}`);
  }
  return parts.join(" · ");
}
