// components/restaurant/cockpit/SalesHeatmap.tsx
//
// Hour × weekday heatmap of net sales. Lightweight SVG — no extra chart
// dependency. Colors are a single orange sequential scale (not red/green).

"use client";

import { useState } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { HeatmapCell } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";

export type HeatmapDisplayCell = HeatmapCell & {
  avg_ticket?: number;
  typical_net?: number;
  vs_typical_pct?: number | null;
};

const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function cellFill(intensity: number): string {
  if (intensity <= 0) return "var(--muted)";
  const t = Math.min(1, Math.max(0, intensity));
  const light = 96 - Math.round(t * 52);
  const sat = 55 + Math.round(t * 30);
  return `hsl(24 ${sat}% ${light}%)`;
}

function textColor(intensity: number): string {
  return intensity > 0.65 ? "hsl(24 40% 18%)" : "hsl(24 10% 28%)";
}

export type HeatmapMetric = "net" | "tickets";

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

  const cellW = compact ? 32 : 44;
  const cellH = compact ? 14 : 18;
  const labelW = compact ? 34 : 42;
  const labelH = compact ? 16 : 20;
  const width = labelW + 7 * cellW + 8;
  const height = labelH + hours.length * cellH + 8;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={t(
            lang,
            "Net sales by hour and weekday",
            "Ventas netas por hora y día"
          )}
          viewBox={`0 0 ${width} ${height}`}
          className={compact ? "w-full h-auto" : "w-full max-w-3xl h-auto"}
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
                        rx={3}
                        fill={cellFill(intensity)}
                        stroke={
                          (selected &&
                            selected.weekday === weekday &&
                            selected.hour === hour) ||
                          (focus &&
                            focus.weekday === weekday &&
                            focus.hour === hour)
                            ? "hsl(24 80% 40%)"
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
                          fill={textColor(intensity)}
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
