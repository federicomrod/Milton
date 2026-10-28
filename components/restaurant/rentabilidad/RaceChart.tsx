// components/restaurant/rentabilidad/RaceChart.tsx
//
// The race chart of Rentabilidad: the margin you earn each day, added up,
// racing the month's fixed costs. Actual days are a solid line, the projection
// is dotted, and the día de equilibrio is marked. Inline SVG that scales to the
// width of the card (no horizontal scroll at 390 px).

import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";
import { dayLabelEs } from "@/lib/restaurant/rentabilidad-copy";

const W = 640;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

export function RaceChart({
  month,
  money,
}: {
  month: RentabilidadMonth;
  money: (n: number) => string;
}) {
  const fixed = month.fixed.total;
  if (fixed === null || month.days.length === 0) return null;
  const days = month.days;
  const total = month.daysInMonth;
  const values = days.map((d) => d.cumMargin);
  const max = Math.max(fixed, ...values, 1);
  const min = Math.min(0, ...values);
  const x = (day: number) =>
    PAD.l + ((day - 1) / Math.max(total - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) =>
    PAD.t + (1 - (v - min) / Math.max(max - min, 1)) * (H - PAD.t - PAD.b);
  const point = (i: number) =>
    `${x(i + 1).toFixed(1)},${y(days[i].cumMargin).toFixed(1)}`;
  const firstProjected = days.findIndex((d) => d.projected);
  const actualEnd = firstProjected === -1 ? days.length : firstProjected;
  const actualPath = days
    .slice(0, actualEnd)
    .map((_, i) => `${i === 0 ? "M" : "L"}${point(i)}`)
    .join(" ");
  // The dotted line starts at the last actual point so the two join.
  const projectedPath =
    firstProjected === -1
      ? ""
      : days
          .slice(Math.max(firstProjected - 1, 0))
          .map(
            (_, k) =>
              `${k === 0 ? "M" : "L"}${point(Math.max(firstProjected - 1, 0) + k)}`
          )
          .join(" ");
  const be = month.breakEvenDay;
  const beX = be ? x(be.day) : null;
  const beY = be ? y(days[be.day - 1].cumMargin) : null;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Margen acumulado contra costos fijos del mes"
        className="block h-auto w-full"
      >
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(fixed)}
          y2={y(fixed)}
          stroke="#b42318"
          strokeWidth={2}
        />
        <text
          x={W - PAD.r}
          y={y(fixed) - 5}
          textAnchor="end"
          fontSize={11}
          fill="#b42318"
        >
          Costos fijos del mes {money(fixed)}
        </text>
        {actualPath ? (
          <path d={actualPath} fill="none" stroke="#1B40C8" strokeWidth={2.5} />
        ) : null}
        {projectedPath ? (
          <path
            d={projectedPath}
            fill="none"
            stroke="#1B40C8"
            strokeWidth={2.5}
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
        ) : null}
        {be && beX !== null && beY !== null ? (
          <g>
            <circle
              cx={beX}
              cy={beY}
              r={6}
              fill="#fff"
              stroke="#1B40C8"
              strokeWidth={3}
            />
            <text
              x={Math.min(Math.max(beX, 70), W - 70)}
              y={beY + 22}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="#1B40C8"
            >
              Equilibrio {dayLabelEs(be.date)}
              {be.projected ? " (proyección)" : ""}
            </text>
          </g>
        ) : null}
        <text x={PAD.l} y={H - 5} fontSize={10} fill="#6b7385">
          1
        </text>
        <text
          x={W - PAD.r}
          y={H - 5}
          fontSize={10}
          fill="#6b7385"
          textAnchor="end"
        >
          {total}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6b7385]">
        <span>
          <span className="font-semibold text-[#1B40C8]">━</span> Margen
          acumulado
        </span>
        {projectedPath ? (
          <span>
            <span className="font-semibold text-[#1B40C8]">┅</span> Proyección
          </span>
        ) : null}
        <span>
          <span className="font-semibold text-[#b42318]">━</span> Costos fijos
        </span>
      </figcaption>
    </figure>
  );
}
