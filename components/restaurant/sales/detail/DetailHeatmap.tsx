"use client";

// R1-17b: «Hora × día». Ventas / Tickets / Ticket prom., hours in the
// restaurant's local clock, the weekday of the BUSINESS day. A click adds Día
// + Hora to the page filters; «Cruzar con» draws small multiples by Canal,
// Pago or Categoría.

import { useMemo } from "react";
import {
  heatValue,
  type CrossGrid,
  type CrossKey,
  type HeatGrid,
  type HeatMetric,
} from "@/lib/restaurant/sales-detail";
import { heatColor } from "@/lib/restaurant/ui/heat-scale";
import { useT } from "@/lib/i18n/client";
import { hourLabel, weekdaysLong, weekdaysShort } from "./format";

function hoursOf(grids: HeatGrid[]): number[] {
  let lo = 24;
  let hi = -1;
  for (const g of grids)
    for (let wd = 1; wd <= 7; wd += 1)
      for (let h = 0; h < 24; h += 1) {
        const c = g[wd][h];
        if (c.net > 0 || c.tickets > 0) {
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
  if (hi < 0) return [];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

function Grid({
  grid,
  hours,
  metric,
  max,
  selected,
  compact,
  onCell,
}: {
  grid: HeatGrid;
  hours: number[];
  metric: HeatMetric;
  max: number;
  selected?: { wd: number[]; h: number[] };
  compact?: boolean;
  onCell?: (wd: number, h: number) => void;
}) {
  const { d, fmt, lang } = useT();
  const WEEKDAYS_SHORT = weekdaysShort(lang);
  const WEEKDAYS_LONG = weekdaysLong(lang);
  const cell = compact ? "h-[9px]" : "h-[17px]";
  return (
    <div
      className="grid gap-[2px] text-[10.5px]"
      style={{
        gridTemplateColumns: `${compact ? "0px" : "30px"} repeat(7, 1fr)`,
      }}
    >
      <div />
      {WEEKDAYS_SHORT.map((d) => (
        <div key={d} className="text-center text-[#8a92a3]">
          {compact ? d.slice(0, 1) : d}
        </div>
      ))}
      {hours.map((h) => (
        <div key={h} className="contents">
          <div
            className={`pr-1 text-right text-[#8a92a3] ${compact ? "hidden" : ""}`}
            style={{ lineHeight: "17px" }}
          >
            {hourLabel(h)}
          </div>
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
            const v = heatValue(grid[wd][h], metric);
            const a = v !== null && max > 0 ? Math.min(v / max, 1) : 0;
            const isSel =
              !!selected && selected.wd.includes(wd) && selected.h.includes(h);
            return (
              <button
                key={wd}
                type="button"
                disabled={!onCell}
                aria-label={`${WEEKDAYS_LONG[wd - 1]} ${hourLabel(h)}`}
                title={
                  v === null
                    ? fmt(d.sales.detail.heat.cellNoSales, {
                        cell: `${WEEKDAYS_LONG[wd - 1]} ${hourLabel(h)}`,
                      })
                    : `${WEEKDAYS_LONG[wd - 1]} ${hourLabel(h)}${onCell ? d.sales.detail.heat.clickFilter : ""}`
                }
                onClick={() => onCell?.(wd, h)}
                className={`${cell} rounded-[3px]`}
                style={{
                  background: heatColor(v === null || v === 0 ? null : a),
                  outline: isSel ? "2px solid #151c2c" : undefined,
                  cursor: onCell ? "pointer" : "default",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DetailHeatmap({
  grid,
  cross,
  metric,
  crossKey,
  selectedDays,
  selectedHours,
  money,
  onMetric,
  onCross,
  onCell,
}: {
  grid: HeatGrid;
  cross: CrossGrid[];
  metric: HeatMetric;
  crossKey: CrossKey;
  selectedDays: number[];
  selectedHours: number[];
  money: (n: number, d?: number) => string;
  onMetric: (m: HeatMetric) => void;
  onCross: (c: CrossKey) => void;
  onCell: (wd: number, h: number) => void;
}) {
  const { d, lang } = useT();
  const h0 = d.sales.detail.heat;
  const WEEKDAY_NAMES = weekdaysLong(lang);
  const grids = useMemo(
    () => [grid, ...cross.map((c) => c.grid)],
    [grid, cross]
  );
  const hours = useMemo(() => hoursOf(grids), [grids]);
  const maxOf = (g: HeatGrid) => {
    let m = 0;
    for (let wd = 1; wd <= 7; wd += 1)
      for (const h of hours) m = Math.max(m, heatValue(g[wd][h], metric) ?? 0);
    return m;
  };
  // Pico: the busiest cell of the (filtered) period, by sales.
  let peak: { wd: number; h: number; net: number } | null = null;
  for (let wd = 1; wd <= 7; wd += 1)
    for (const h of hours)
      if (grid[wd][h].net > (peak?.net ?? 0))
        peak = { wd, h, net: grid[wd][h].net };
  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white p-3.5"
      data-testid="sales-heatmap"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-bold">{h0.title}</h2>
        <div
          role="group"
          aria-label={h0.metricAria}
          className="inline-flex rounded-[9px] bg-[#e9ecf2] p-[2px]"
        >
          {(
            [
              ["ventas", h0.sales],
              ["tickets", h0.tickets],
              ["ticket", h0.avgTicket],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={metric === k}
              onClick={() => onMetric(k)}
              className={
                "rounded-md px-2 py-0.5 text-[12px] font-semibold " +
                (metric === k
                  ? "bg-white text-[#151c2c] shadow-sm"
                  : "text-[#5b6476]")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {hours.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-[#8a92a3]">{h0.none}</p>
      ) : (
        <Grid
          grid={grid}
          hours={hours}
          metric={metric}
          max={maxOf(grid)}
          selected={{ wd: selectedDays, h: selectedHours }}
          onCell={onCell}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#6b7385]">
        {peak ? (
          <span>
            {h0.peak}{" "}
            <b className="text-[#151c2c]">
              {WEEKDAY_NAMES[peak.wd - 1]} {hourLabel(peak.h)}
            </b>{" "}
            · {money(peak.net)}
          </span>
        ) : null}
        <label className="ml-auto inline-flex items-center gap-1.5">
          {h0.cross}
          <select
            aria-label={h0.cross.replace(/:$/, "")}
            value={crossKey}
            onChange={(e) => onCross(e.target.value as CrossKey)}
            className="rounded-md border border-[#dfe3ea] bg-white px-1.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]"
          >
            <option value="ninguno">{h0.crossNone}</option>
            <option value="canal">{d.sales.detail.filter.channel}</option>
            <option value="pago">{d.sales.detail.filter.payment}</option>
            <option value="categoria">{d.sales.detail.filter.category}</option>
          </select>
        </label>
      </div>
      {cross.length > 0 ? (
        <div
          className="mt-3 grid grid-cols-2 gap-3"
          data-testid="sales-heatmap-cross"
        >
          {cross.map((c) => (
            <div key={c.token}>
              <div className="mb-1 truncate text-[11.5px] font-semibold text-[#4a5a85]">
                {c.label}
              </div>
              <Grid
                grid={c.grid}
                hours={hours}
                metric={metric}
                max={maxOf(c.grid)}
                compact
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
