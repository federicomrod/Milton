"use client";

// R1-16b (mock 11): the Cockpit v2 charts as plain SVG/CSS (no chart library,
// nothing to download). Each one is a pure picture of a CockpitView slice: the
// numbers come from lib/restaurant/cockpit-v2.ts, never from here.

import { useMemo, useRef, useState } from "react";
import { fitFontSize, selectTicks } from "@/lib/restaurant/ui/axis-ticks";
import { useElementWidth } from "@/lib/restaurant/ui/use-element-width";
import type {
  DayBar,
  MixSlice,
  WeekBar,
  WeekdayCost,
} from "@/lib/restaurant/cockpit-v2";
import { NO_CATEGORY } from "@/lib/restaurant/cockpit-v2";
import { useT } from "@/lib/i18n/client";
import {
  dayLabel as formatDayLabel,
  dayMonthLabel,
  weekdayShort,
} from "@/lib/restaurant/cockpit-format";

const GOOD = "#A7F3D0";
const BAD = "#FBCFE8";
const NO_TARGET = "#E7EDFD";
const INK = "#0F172A";
const BLUE = "#1b40c8";

export function DailyBarsChart({
  bars,
  baselineAvg,
  baselineLabel,
  money,
  onDay,
}: {
  bars: DayBar[];
  /** The baseline line (average per day of the baseline); null = not drawn. */
  baselineAvg: number | null;
  baselineLabel: string;
  money: (n: number) => string;
  onDay: (date: string) => void;
}) {
  const { d, fmt, lang } = useT();
  const dayLabel = (ymd: string) => formatDayLabel(ymd, lang);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(wrapRef);
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
  const ticks = useMemo(
    () =>
      selectTicks({
        count: bars.length,
        positionOf: (i) => i * slot + slot / 2,
        labelOf: (i) => dayMonthLabel(bars[i].date, lang),
        width: W,
        fontSize: 11,
      }),
    [bars, slot, W, lang]
  );
  return (
    <div className="relative" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[190px] w-full"
        role="img"
        aria-label={d.cockpit.v2.dailySales}
        onMouseLeave={() => setHover(null)}
      >
        {bars.map((b, i) => {
          const x = i * slot + (slot - bw) / 2;
          const color =
            hover === i
              ? "#1B40C8"
              : b.above === null
                ? NO_TARGET
                : b.above
                  ? GOOD
                  : BAD;
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
            stroke={INK}
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
        {ticks.map((t) => (
          <text
            key={bars[t.index].date}
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
            <div>
              {fmt(d.cockpit.charts.tooltipVsTarget, {
                pct: `${h.deltaPct >= 0 ? "+" : ""}${Math.round(h.deltaPct)}%`,
              })}
            </div>
          ) : (
            <div className="text-[#c6d3f5]">{d.cockpit.charts.clickDetail}</div>
          )}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6b7385]">
        {hasTarget ? (
          <>
            <Legend
              color={GOOD}
              label={fmt(d.cockpit.charts.aboveTarget, {
                n: bars.filter((b) => b.above === true).length,
              })}
            />
            <Legend
              color={BAD}
              label={fmt(d.cockpit.charts.belowTarget, {
                n: bars.filter((b) => b.above === false).length,
              })}
            />
            <Legend color={INK} label={d.cockpit.charts.targetLegend} line />
          </>
        ) : null}
        {baselineAvg !== null ? (
          <Legend
            color="#8a92a3"
            label={fmt(d.cockpit.charts.averageLegend, {
              label: baselineLabel,
            })}
            line
          />
        ) : null}
      </div>
    </div>
  );
}

export function Legend({
  color,
  label,
  line,
  dashed,
  title,
}: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
  title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <i
        className="inline-block"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)`
            : color,
          width: line || dashed ? 14 : 10,
          height: line || dashed ? (dashed ? 2 : 3) : 10,
          borderRadius: line || dashed ? 0 : 2,
        }}
      />
      {label}
    </span>
  );
}

export { Legend as ChartLegend };

export function WeeksChart({
  weeks,
  money,
  onWeek,
}: {
  weeks: WeekBar[];
  money: (n: number) => string;
  onWeek: (w: WeekBar) => void;
}) {
  const { d } = useT();
  const max = Math.max(
    1,
    ...weeks.map((w) => Math.max(w.sales, w.target ?? 0))
  );
  if (weeks.length === 0)
    return (
      <p className="py-3 text-[12px] text-[#8a92a3]">
        {d.cockpit.charts.noWeeks}
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
          title={d.cockpit.charts.clickDetail}
        >
          <span className="w-8 text-[#8a92a3]">
            {w.label.replace(/^S/, d.cockpit.charts.weekPrefix)}
          </span>
          <span className="relative h-4 flex-1 rounded bg-[#eef1fa]">
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${(w.sales / max) * 100}%`,
                background: w.above === null ? NO_TARGET : w.above ? GOOD : BAD,
              }}
            />
            {w.target !== null ? (
              <span
                className="absolute -inset-y-[3px] border-l-2 border-dashed border-[#0F172A]"
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
  const { d: dict, fmt, lang } = useT();
  const dayNames = Array.from({ length: 7 }, (_, i) => weekdayShort(i, lang));
  const max = Math.max(
    1,
    target ?? 0,
    ...days.map((x) => x.food_cost_pct ?? 0)
  );
  if (loading)
    return (
      <p className="py-6 text-center text-[12px] text-[#8a92a3]">
        {dict.cockpit.charts.calculatingCost}
      </p>
    );
  if (days.every((x) => x.food_cost_pct === null))
    return (
      <p className="py-6 text-center text-[12px] text-[#8a92a3]">
        {dict.cockpit.charts.noPriceDishes}
      </p>
    );
  return (
    <div>
      <div className="relative flex h-[110px] items-end gap-2.5 border-b border-[#eef0f4]">
        {days.map((x) => (
          <div
            key={x.weekday}
            className="flex h-full flex-1 items-end justify-center"
            title={
              x.food_cost_pct === null
                ? fmt(dict.cockpit.charts.weekdayNoCost, {
                    day: dayNames[x.weekday],
                  })
                : fmt(dict.cockpit.charts.weekdayCost, {
                    day: dayNames[x.weekday],
                    pct: x.food_cost_pct.toFixed(1),
                    coverage: Math.round(x.coverage_pct ?? 0),
                  })
            }
          >
            {x.food_cost_pct !== null ? (
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(x.food_cost_pct / max) * 100}%`,
                  background:
                    x.above === null ? NO_TARGET : x.above ? BAD : GOOD,
                  opacity: 0.85,
                }}
              />
            ) : null}
          </div>
        ))}
        {target !== null ? (
          <div
            className="absolute inset-x-0 border-t-2 border-dashed border-[#0F172A]"
            style={{ bottom: `${(target / max) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex gap-2.5 text-[12px] text-[#8a92a3]">
        {dayNames.map((n) => (
          <span key={n} className="flex-1 text-center">
            {n}
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
  "#6b7280",
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
}: {
  slices: MixSlice[];
  total: number;
  money: (n: number) => string;
  active: string | null;
  onSlice: (category: string | null) => void;
  loading: boolean;
}) {
  const { d } = useT();
  const nameOf = (category: string) =>
    category === NO_CATEGORY ? d.cockpit.charts.noCategory : category;
  if (loading)
    return (
      <p className="py-10 text-center text-[12px] text-[#8a92a3]">
        {d.cockpit.charts.calculatingMix}
      </p>
    );
  if (slices.length === 0)
    return (
      <p className="py-10 text-center text-[12px] text-[#8a92a3]">
        {d.cockpit.charts.noSalesPeriod}
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
            category: d.cockpit.charts.others,
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
        aria-label={d.cockpit.v2.salesMix}
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
          fontSize={fitFontSize(money(total), 80, 17, 12, 0.62)}
          fontWeight="800"
          fill="#151c2c"
        >
          {money(total)}
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
              title={
                s.members ? s.members.join(", ") : d.cockpit.charts.clickFilter
              }
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
              <span className="truncate">{nameOf(s.category)}</span>
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
