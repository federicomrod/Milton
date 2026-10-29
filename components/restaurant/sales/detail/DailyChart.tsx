"use client";

// R1-17b: «Ventas por día». Bars when the period has fewer than 8 days, a
// straight line beyond (no smoothing: a spline invents values between days),
// the daily goal as a dashed line when Objetivos has one, and a Ventas /
// Tickets toggle. Click a day = that day, for the whole page.

import { useMemo, useRef, useState } from "react";
import type { ChartMetric, DayBar } from "@/lib/restaurant/sales-detail";
import { selectTicks } from "@/lib/restaurant/ui/axis-ticks";
import { useElementWidth } from "@/lib/restaurant/ui/use-element-width";
import { BLUE, dayLabelEs } from "./format";

const H = 190;
const PAD = { l: 8, r: 8, t: 14, b: 24 };

export function DailyChart({
  bars,
  metric,
  money,
  hasTarget,
  onMetric,
  onDay,
}: {
  bars: DayBar[];
  metric: ChartMetric;
  money: (n: number) => string;
  hasTarget: boolean;
  onMetric: (m: ChartMetric) => void;
  onDay: (date: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn in real pixels: the text keeps its size and nothing is letterboxed.
  const wrapRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(wrapRef);
  const values = bars.map((b) => (metric === "ventas" ? b.net : b.tickets));
  const targets =
    metric === "ventas" ? bars.map((b) => b.target) : bars.map(() => null);
  const max = Math.max(1, ...values, ...targets.map((t) => t ?? 0));
  const innerH = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const n = bars.length;
  const slot = (W - PAD.l - PAD.r) / Math.max(n, 1);
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const useBars = n < 8;
  const bw = Math.min(46, slot * 0.6);
  const fmt = (v: number) =>
    metric === "ventas" ? money(v) : `${Math.round(v)} tickets`;
  const ticks = useMemo(
    () =>
      selectTicks({
        count: n,
        positionOf: (i) => PAD.l + slot * i + slot / 2,
        labelOf: (i) => dayLabelEs(bars[i].date),
        width: W,
        fontSize: 10.5,
      }),
    [bars, n, slot, W]
  );
  const tgtPath = targets.some((t) => t !== null)
    ? targets
        .map((t, i) =>
          t === null
            ? null
            : `${i === 0 || targets[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(t).toFixed(1)}`
        )
        .filter(Boolean)
        .join(" ")
    : null;
  const above = bars.filter(
    (b, i) =>
      metric === "ventas" &&
      b.target !== null &&
      values[i] >= (b.target as number)
  ).length;
  const withTarget = bars.filter((b) => b.target !== null).length;

  return (
    <section
      className="rounded-[14px] border border-[#eef0f4] bg-white p-3.5"
      data-testid="sales-daily-chart"
    >
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[13px] font-bold">Ventas por día</h2>
        <div
          role="group"
          aria-label="Métrica"
          className="inline-flex rounded-[9px] bg-[#e9ecf2] p-[2px]"
        >
          {(["ventas", "tickets"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => onMetric(m)}
              className={
                "rounded-md px-2.5 py-0.5 text-[12px] font-semibold " +
                (metric === m
                  ? "bg-white text-[#151c2c] shadow-sm"
                  : "text-[#5b6476]")
              }
            >
              {m === "ventas" ? "Ventas" : "Tickets"}
            </button>
          ))}
        </div>
      </div>
      <div
        className="relative"
        ref={wrapRef}
        title="Clic en un día para filtrar la página"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[190px] w-full"
          role="img"
          aria-label="Ventas por día"
        >
          {useBars ? (
            bars.map((b, i) => {
              const top = y(values[i]);
              const over =
                metric === "ventas" &&
                b.target !== null &&
                values[i] >= b.target;
              return (
                <g key={b.date}>
                  <rect
                    x={x(i) - slot / 2}
                    y={PAD.t}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onDay(b.date)}
                  />
                  <rect
                    x={x(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={PAD.t + innerH - top}
                    rx={3}
                    fill={
                      hover === i
                        ? BLUE
                        : metric !== "ventas" || b.target === null
                          ? "#E7EDFD"
                          : over
                            ? "#A7F3D0"
                            : "#FBCFE8"
                    }
                    opacity={hover === null || hover === i ? 1 : 0.6}
                    pointerEvents="none"
                  />
                </g>
              );
            })
          ) : (
            <>
              <polyline
                fill="none"
                stroke={BLUE}
                strokeWidth={2}
                strokeLinejoin="miter"
                points={bars
                  .map(
                    (_, i) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`
                  )
                  .join(" ")}
              />
              {bars.map((b, i) => (
                <rect
                  key={b.date}
                  x={x(i) - slot / 2}
                  y={PAD.t}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onDay(b.date)}
                />
              ))}
              {hover !== null ? (
                <circle cx={x(hover)} cy={y(values[hover])} r={4} fill={BLUE} />
              ) : null}
            </>
          )}
          {tgtPath ? (
            <path
              d={tgtPath}
              fill="none"
              stroke="#0F172A"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          ) : null}
          {ticks.map((t) => (
            <text
              key={bars[t.index].date}
              x={t.x}
              y={H - 6}
              fontSize={10.5}
              fill="#8a92a3"
              textAnchor={t.anchor}
            >
              {t.label}
            </text>
          ))}
        </svg>
        {hover !== null ? (
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-md bg-[#151c2c] px-2 py-1 text-[11.5px] text-white">
            {dayLabelEs(bars[hover].date)} · {fmt(values[hover])}
            {targets[hover] !== null
              ? ` · objetivo ${money(targets[hover] as number)}`
              : ""}
          </div>
        ) : null}
      </div>
      {hasTarget && metric === "ventas" && withTarget > 0 ? (
        <p className="text-[11.5px] text-[#8a92a3]">
          {`${above} de ${n} días sobre el objetivo (línea punteada).`}
        </p>
      ) : null}
    </section>
  );
}
