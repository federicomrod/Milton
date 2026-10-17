"use client";

// R1-16b (mock 11): the Cockpit v2 charts as plain SVG/CSS (no chart library,
// nothing to download). Each one is a pure picture of a CockpitView slice: the
// numbers come from lib/restaurant/cockpit-v2.ts, never from here.

import { useState } from "react";
import type {
  DayBar,
  MixSlice,
  WeekBar,
  WeekdayCost,
} from "@/lib/restaurant/cockpit-v2";
import { NO_CATEGORY } from "@/lib/restaurant/cockpit-v2";

const GREEN = "#1f9d55";
const RED = "#e6a19b";
const NEUTRAL = "#aebbe6";
const BLUE = "#1b40c8";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const WEEKDAY_FULL = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function dayLabel(ymd: string): string {
  const d = new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
  );
  const wd = WEEKDAY_FULL[(d.getUTCDay() + 6) % 7];
  return `${wd} ${+ymd.slice(8)} ${MONTHS[+ymd.slice(5, 7) - 1]}`;
}

export function DailyBarsChart({
  bars,
  baselineAvg,
  baselineLabel,
  money,
  onDay,
}: {
  bars: DayBar[];
  /** The orange line (average per day of the baseline); null = not drawn. */
  baselineAvg: number | null;
  baselineLabel: string;
  money: (n: number) => string;
  onDay: (date: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 190;
  const top = 12;
  const bottom = 22;
  const plotH = H - top - bottom;
  const max = Math.max(
    1,
    ...bars.map((b) => Math.max(b.sales, b.target ?? 0)),
    baselineAvg ?? 0
  );
  const slot = W / Math.max(bars.length, 1);
  const bw = Math.max(3, Math.min(14, slot * 0.62));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const targets = bars.filter((b) => b.target !== null);
  const hasTarget = targets.length > 0;
  // The dashed line follows the daily target (it moves with the weekday weights and the month).
  const targetPath = hasTarget
    ? bars
        .map((b, i) =>
          b.target === null
            ? null
            : `${i === 0 || bars[i - 1].target === null ? "M" : "L"}${(i * slot + slot / 2).toFixed(1)},${y(b.target).toFixed(1)}`
        )
        .filter(Boolean)
        .join(" ")
    : null;
  const h = hover === null ? null : bars[hover];
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[190px] w-full"
        role="img"
        aria-label="Ventas diarias"
        onMouseLeave={() => setHover(null)}
      >
        {bars.map((b, i) => {
          const x = i * slot + (slot - bw) / 2;
          const color = b.above === null ? NEUTRAL : b.above ? GREEN : RED;
          return (
            <g key={b.date}>
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H - bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => onDay(b.date)}
                style={{ cursor: "pointer" }}
              />
              <rect
                x={x}
                y={y(b.sales)}
                width={bw}
                height={Math.max(0, top + plotH - y(b.sales))}
                rx={2}
                fill={color}
                opacity={hover === i ? 1 : 0.88}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {targetPath ? (
          <path
            d={targetPath}
            stroke="#151c2c"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            fill="none"
          />
        ) : null}
        {baselineAvg !== null ? (
          <line
            x1={0}
            x2={W}
            y1={y(baselineAvg)}
            y2={y(baselineAvg)}
            stroke="#8a92a3"
            strokeDasharray="5 4"
            strokeWidth={1.5}
          />
        ) : null}
        <text x={0} y={H - 6} fontSize={11} fill="#8a92a3">
          {bars.length ? dayLabel(bars[0].date).slice(4) : ""}
        </text>
        <text x={W} y={H - 6} fontSize={11} fill="#8a92a3" textAnchor="end">
          {bars.length ? dayLabel(bars[bars.length - 1].date).slice(4) : ""}
        </text>
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg bg-[#151c2c] px-3 py-2 text-[12px] text-white shadow-lg"
          style={{
            left: `${Math.min(78, Math.max(0, ((hover! * slot) / W) * 100 - 6))}%`,
          }}
        >
          <div className="font-semibold">
            {dayLabel(h.date)} · {money(h.sales)}
          </div>
          {h.deltaPct !== null ? (
            <div
              className={h.deltaPct >= 0 ? "text-[#9fe0b8]" : "text-[#f4b6b0]"}
            >
              {h.deltaPct >= 0 ? "+" : ""}
              {Math.round(h.deltaPct)}% vs objetivo · clic = detalle
            </div>
          ) : (
            <div className="text-[#c6d3f5]">clic = detalle</div>
          )}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6b7385]">
        {hasTarget ? (
          <>
            <Legend
              color={GREEN}
              label={`Sobre objetivo · ${bars.filter((b) => b.above === true).length} días`}
            />
            <Legend
              color={RED}
              label={`Bajo objetivo · ${bars.filter((b) => b.above === false).length} días`}
            />
            <Legend color="#151c2c" label="Objetivo" line />
          </>
        ) : null}
        {baselineAvg !== null ? (
          <Legend
            color="#8a92a3"
            label={`Promedio (${baselineLabel.replace("vs ", "")})`}
            line
          />
        ) : null}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  line,
}: {
  color: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        className="inline-block"
        style={{
          background: color,
          width: line ? 14 : 10,
          height: line ? 3 : 10,
          borderRadius: line ? 0 : 2,
        }}
      />
      {label}
    </span>
  );
}

export function WeeksChart({
  weeks,
  money,
  onWeek,
}: {
  weeks: WeekBar[];
  money: (n: number) => string;
  onWeek: (w: WeekBar) => void;
}) {
  const max = Math.max(
    1,
    ...weeks.map((w) => Math.max(w.sales, w.target ?? 0))
  );
  if (weeks.length === 0)
    return (
      <p className="py-3 text-[12px] text-[#8a92a3]">
        Aún no hay semanas completas.
      </p>
    );
  return (
    <div>
      {weeks.map((w) => (
        <button
          key={w.from}
          type="button"
          onClick={() => onWeek(w)}
          className="my-1.5 flex w-full items-center gap-2 text-left text-[13px]"
          title="clic = detalle"
        >
          <span className="w-8 text-[#8a92a3]">{w.label}</span>
          <span className="relative h-4 flex-1 rounded bg-[#eef1fa]">
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${(w.sales / max) * 100}%`,
                background:
                  w.above === null ? NEUTRAL : w.above ? GREEN : "#c9ced8",
              }}
            />
            {w.target !== null ? (
              <span
                className="absolute -inset-y-[3px] border-l-2 border-dashed border-[#151c2c]"
                style={{ left: `${(w.target / max) * 100}%` }}
              />
            ) : null}
          </span>
          <b className="w-[62px] text-right tabular-nums">{money(w.sales)}</b>
        </button>
      ))}
    </div>
  );
}

export function WeekdayCostChart({
  days,
  target,
  loading,
}: {
  days: WeekdayCost[];
  target: number | null;
  loading: boolean;
}) {
  const max = Math.max(
    1,
    target ?? 0,
    ...days.map((d) => d.food_cost_pct ?? 0)
  );
  if (loading)
    return (
      <p className="py-6 text-center text-[12px] text-[#8a92a3]">
        Calculando costo…
      </p>
    );
  if (days.every((d) => d.food_cost_pct === null))
    return (
      <p className="py-6 text-center text-[12px] text-[#8a92a3]">
        Sin precio: aún no hay productos con costo para calcular el costo por
        día.
      </p>
    );
  return (
    <div>
      <div className="relative flex h-[110px] items-end gap-2.5 border-b border-[#eef0f4]">
        {days.map((d) => (
          <div
            key={d.weekday}
            className="flex h-full flex-1 items-end justify-center"
            title={
              d.food_cost_pct === null
                ? `${DAYS[d.weekday]}: sin costo`
                : `${DAYS[d.weekday]}: ${d.food_cost_pct.toFixed(1)}% · cobertura ${Math.round(d.coverage_pct ?? 0)}% de las ventas`
            }
          >
            {d.food_cost_pct !== null ? (
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(d.food_cost_pct / max) * 100}%`,
                  background:
                    d.above === null ? NEUTRAL : d.above ? "#d14343" : GREEN,
                  opacity: 0.85,
                }}
              />
            ) : null}
          </div>
        ))}
        {target !== null ? (
          <div
            className="absolute inset-x-0 border-t-2 border-dashed border-[#151c2c]"
            style={{ bottom: `${(target / max) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex gap-2.5 text-[12px] text-[#8a92a3]">
        {DAYS.map((d) => (
          <span key={d} className="flex-1 text-center">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

const SLICE_COLORS = [
  "#1b40c8",
  "#151c2c",
  "#8a92a3",
  "#e9b98a",
  "#4a7ad8",
  "#c9ced8",
];

export function MixDonut({
  slices,
  total,
  money,
  active,
  onSlice,
  loading,
  daysLabel,
}: {
  slices: MixSlice[];
  total: number;
  money: (n: number) => string;
  active: string | null;
  onSlice: (category: string | null) => void;
  loading: boolean;
  daysLabel: string;
}) {
  if (loading)
    return (
      <p className="py-10 text-center text-[12px] text-[#8a92a3]">
        Calculando mezcla…
      </p>
    );
  if (slices.length === 0)
    return (
      <p className="py-10 text-center text-[12px] text-[#8a92a3]">
        Sin ventas en el periodo.
      </p>
    );
  // The biggest four, the rest together; «Sin categoría» always stands on its own.
  const named = slices.filter((s) => s.category !== NO_CATEGORY);
  const top = named.slice(0, 4);
  const rest = named.slice(4);
  const none = slices.find((s) => s.category === NO_CATEGORY);
  const shown: Array<MixSlice & { members?: string[] }> = [
    ...top,
    ...(rest.length
      ? [
          {
            category: "Otros",
            net: rest.reduce((a, s) => a + s.net, 0),
            share_pct: rest.reduce((a, s) => a + s.share_pct, 0),
            members: rest.map((r) => r.category),
          },
        ]
      : []),
    ...(none ? [none] : []),
  ];
  const R = 56;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 150 150"
        className="h-[150px] w-[150px] shrink-0"
        role="img"
        aria-label="Mezcla de ventas"
      >
        <g transform="rotate(-90 75 75)">
          {shown.map((s, i) => {
            const len = (s.share_pct / 100) * C;
            const el = (
              <circle
                key={s.category}
                cx={75}
                cy={75}
                r={R}
                fill="none"
                stroke={
                  s.category === NO_CATEGORY
                    ? "#dfe3ea"
                    : SLICE_COLORS[i % SLICE_COLORS.length]
                }
                strokeWidth={active === s.category ? 26 : 20}
                strokeDasharray={`${Math.max(len - 1, 0)} ${C - len + 1}`}
                strokeDashoffset={-offset}
                opacity={active && active !== s.category ? 0.35 : 1}
                style={{ cursor: s.members ? "default" : "pointer" }}
                onClick={() =>
                  !s.members &&
                  onSlice(active === s.category ? null : s.category)
                }
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text
          x="75"
          y="72"
          textAnchor="middle"
          fontSize="17"
          fontWeight="800"
          fill="#151c2c"
        >
          {money(total)}
        </text>
        <text x="75" y="90" textAnchor="middle" fontSize="11" fill="#8a92a3">
          {daysLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-[13px]">
        {shown.map((s, i) => (
          <li key={s.category}>
            <button
              type="button"
              disabled={!!s.members}
              onClick={() => onSlice(active === s.category ? null : s.category)}
              aria-pressed={active === s.category}
              title={s.members ? s.members.join(", ") : "clic = filtrar todo"}
              className={
                "flex w-full items-center gap-2 text-left " +
                (active === s.category ? "font-bold" : "")
              }
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{
                  background:
                    s.category === NO_CATEGORY
                      ? "#dfe3ea"
                      : SLICE_COLORS[i % SLICE_COLORS.length],
                }}
              />
              <span className="truncate">{s.category}</span>
              <b className="ml-auto tabular-nums">
                {Math.round(s.share_pct * 10) / 10}%
              </b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { BLUE };
