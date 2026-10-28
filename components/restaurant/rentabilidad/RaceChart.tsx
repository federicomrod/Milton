// components/restaurant/rentabilidad/RaceChart.tsx
//
// «¿Ya cubriste tus costos fijos?»: the margin you earn each day, added up,
// against the month's fixed costs. Same plain-SVG pattern as the Cockpit and
// Ventas charts: real pixel width (useElementWidth), fixed 190 px height,
// selectTicks for the day labels, a transparent hit rect per day with the dark
// tooltip, and the legend underneath. No in-plot text, no gridlines.

"use client";

import { useMemo, useRef, useState } from "react";
import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";
import {
  dayLabelEs,
  PROJECTION_METHOD,
} from "@/lib/restaurant/rentabilidad-copy";
import { useElementWidth } from "@/lib/restaurant/ui/use-element-width";
import { selectTicks } from "@/lib/restaurant/ui/axis-ticks";
import { ChartLegend } from "@/components/restaurant/cockpit/v2/charts";

const H = 190;
const PAD = { l: 8, r: 8, t: 14, b: 24 };
const BLUE = "#1B40C8";
const INK = "#0F172A";

export function RaceChart({
  month,
  money,
}: {
  month: RentabilidadMonth;
  money: (n: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(wrapRef);
  const [hover, setHover] = useState<number | null>(null);
  const fixed = month.fixed.total;
  const days = month.days;
  const total = month.daysInMonth;
  const geometry = useMemo(() => {
    if (fixed === null || days.length === 0) return null;
    const values = days.map((d) => d.cumMargin);
    const max = Math.max(fixed, ...values, 1);
    const min = Math.min(0, ...values);
    const x = (day: number) =>
      PAD.l + ((day - 1) / Math.max(total - 1, 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) =>
      PAD.t + (1 - (v - min) / Math.max(max - min, 1)) * (H - PAD.t - PAD.b);
    return { x, y };
  }, [fixed, days, total, W]);
  const ticks = useMemo(
    () =>
      geometry
        ? selectTicks({
            count: total,
            positionOf: (i) => geometry.x(i + 1),
            labelOf: (i) => String(i + 1),
            width: W,
            fontSize: 11,
          })
        : [],
    [geometry, total, W]
  );
  if (fixed === null || days.length === 0 || !geometry) return null;
  const { x, y } = geometry;
  const point = (i: number) =>
    `${x(i + 1).toFixed(1)},${y(days[i].cumMargin).toFixed(1)}`;
  const firstProjected = days.findIndex((d) => d.projected);
  const actualEnd = firstProjected === -1 ? days.length : firstProjected;
  const actualPath = days
    .slice(0, actualEnd)
    .map((_, i) => `${i === 0 ? "M" : "L"}${point(i)}`)
    .join(" ");
  const from = Math.max(firstProjected - 1, 0);
  const projectedPath =
    firstProjected === -1
      ? ""
      : days
          .slice(from)
          .map((_, k) => `${k === 0 ? "M" : "L"}${point(from + k)}`)
          .join(" ");
  const be = month.breakEvenDay;
  const slot = (W - PAD.l - PAD.r) / Math.max(total - 1, 1);
  const h = hover === null ? null : days[hover];
  return (
    <div className="relative" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[190px] w-full"
        role="img"
        aria-label="Margen acumulado contra costos fijos del mes"
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(fixed)}
          y2={y(fixed)}
          stroke={INK}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        {actualPath ? (
          <path
            d={actualPath}
            fill="none"
            stroke={BLUE}
            strokeWidth={2}
            strokeLinejoin="miter"
          />
        ) : null}
        {projectedPath ? (
          <path
            d={projectedPath}
            fill="none"
            stroke={BLUE}
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        ) : null}
        {be ? (
          <circle
            cx={x(be.day)}
            cy={y(days[be.day - 1].cumMargin)}
            r={4}
            fill={BLUE}
            stroke="#fff"
            strokeWidth={2}
          />
        ) : null}
        {days.map((d, i) => (
          <rect
            key={d.date}
            x={x(i + 1) - slot / 2}
            y={0}
            width={Math.max(slot, 1)}
            height={H - PAD.b}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {ticks.map((t) => (
          <text
            key={t.index}
            x={t.x}
            y={H - 6}
            fontSize={11}
            fill="#8a92a3"
            textAnchor={t.anchor}
          >
            {t.label}
          </text>
        ))}
      </svg>
      {h && hover !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg bg-[#151c2c] px-3 py-2 text-[12px] text-white shadow-lg"
          style={{
            left: `${Math.min(78, Math.max(0, (x(hover + 1) / W) * 100 - 6))}%`,
          }}
        >
          <div className="font-semibold">
            {dayLabelEs(h.date)} · {money(h.cumMargin)} acumulado
          </div>
          {h.projected ? <div>proyección</div> : null}
          {be && be.day === hover + 1 ? <div>Equilibrio</div> : null}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6b7385]">
        <ChartLegend color={BLUE} label="Margen acumulado" line />
        {projectedPath ? (
          <ChartLegend
            color={BLUE}
            label="Proyección"
            dashed
            title={PROJECTION_METHOD}
          />
        ) : null}
        <ChartLegend color={INK} label="Costos fijos del mes" dashed />
      </div>
    </div>
  );
}
