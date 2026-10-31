"use client";

// «¿Y si…?» (#401): the compact simulator of the Rentabilidad mockup. Three
// sliders (Subir precios %, Más clientes %, Costos fijos $) and a result box
// (ganancia → simulated, día de equilibrio → simulated). Runs in the browser,
// writes nothing and never touches the page's real figures. Brand blue and Ink
// only; a simulated value is always labelled «Simulación».

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { weekdayShort } from "@/lib/restaurant/rentabilidad-copy";
import {
  isoWeekday,
  type RentabilidadMonth,
} from "@/lib/restaurant/rentabilidad";
import {
  ZERO_SLIDERS,
  fixedRange,
  isZero,
  realResult,
  simulate,
  type WhatIfBreakEven,
  type WhatIfSliders,
} from "@/lib/restaurant/what-if";

const PRIMARY = "#1B40C8";
const INK = "#0F172A";

const RANGE =
  "h-2 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-[#E1E8FA] accent-[#1B40C8]";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const signed = (n: number, money: (n: number) => string) =>
  n < 0 ? `−${money(Math.abs(n))}` : money(n);

export function WhatIfPanel({
  month,
  money,
}: {
  month: RentabilidadMonth;
  money: (n: number) => string;
}) {
  const { d, lang } = useT();
  const w = d.rentabilidad.whatIf;
  const [s, setS] = useState<WhatIfSliders>(ZERO_SLIDERS);
  const range = useMemo(() => fixedRange(month.fixed.total), [month]);
  const real = useMemo(() => realResult(month), [month]);
  const sim = useMemo(() => simulate(month, s), [month, s]);
  const changed = !isZero(s);
  const estimate = month.basis === "estimada";
  const profitLabel = month.isCurrentMonth
    ? estimate
      ? d.rentabilidad.page.projectionEstimated
      : d.rentabilidad.page.projection
    : estimate
      ? d.rentabilidad.page.profitEstimatedMonth
      : d.rentabilidad.page.profitRealMonth;

  const dayText = (b: WhatIfBreakEven | null) =>
    b
      ? `${weekdayShort(isoWeekday(b.date), lang)} ${b.day}${b.projected ? ` · ${d.rentabilidad.daily.projectedShort}` : ""}`
      : w.notYet;
  const profitText = (p: number | null) =>
    p === null ? "—" : signed(p, money);

  const slider = (props: {
    id: string;
    label: string;
    valueText: string;
    hint: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (n: number) => void;
  }) => (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
        <label htmlFor={props.id} className="text-[#0F172A]">
          {props.label}
        </label>
        <b className="tabular-nums" style={{ color: INK }}>
          {props.valueText}
        </b>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className={RANGE}
      />
      <p className="mt-2 text-[12px] text-[#8a92a3]">{props.hint}</p>
    </div>
  );

  return (
    <section
      id="whatif"
      aria-label={w.aria}
      data-testid="whatif-panel"
      className="min-w-0 rounded-[14px] border border-[#dbe3f7] bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[14.5px] font-bold" style={{ color: INK }}>
          {w.title}
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
          style={{ background: PRIMARY }}
        >
          {w.simulation}
        </span>
        <span className="text-[12px] text-[#8a92a3]">{w.hint}</span>
        <button
          type="button"
          onClick={() => setS(ZERO_SLIDERS)}
          disabled={!changed}
          className="ml-auto rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] font-bold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-50"
        >
          {w.reset}
        </button>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_1fr_1.25fr] lg:gap-7">
        {slider({
          id: "whatif-price",
          label: w.prices,
          valueText: `${sign(s.pricePct)}${Math.abs(s.pricePct)}%`,
          hint: w.pricesHint,
          min: 0,
          max: 15,
          step: 1,
          value: s.pricePct,
          onChange: (n) => setS((v) => ({ ...v, pricePct: n })),
        })}
        {slider({
          id: "whatif-customers",
          label: w.customers,
          valueText: `${sign(s.customersPct)}${Math.abs(s.customersPct)}%`,
          hint: w.customersHint,
          min: -20,
          max: 20,
          step: 1,
          value: s.customersPct,
          onChange: (n) => setS((v) => ({ ...v, customersPct: n })),
        })}
        {month.fixed.total === null ? (
          <div className="min-w-0">
            <p className="mb-2 text-[13px]" style={{ color: INK }}>
              {w.fixed}
            </p>
            <span className="inline-block rounded-full bg-[#FDE68A] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]">
              {w.missing}
            </span>
          </div>
        ) : (
          slider({
            id: "whatif-fixed",
            label: w.fixed,
            valueText: `${sign(s.fixedDelta)}${money(Math.abs(s.fixedDelta))}`,
            hint: w.fixedHint,
            min: range.min,
            max: range.max,
            step: range.step,
            value: s.fixedDelta,
            onChange: (n) => setS((v) => ({ ...v, fixedDelta: n })),
          })
        )}

        <div
          className="min-w-0 rounded-[12px] border border-[#DCE3FA] bg-[#F6F8FE] p-3.5"
          aria-live="polite"
        >
          <p className="text-[12px] text-[#4a5a85]">{profitLabel}</p>
          <p
            data-testid="whatif-profit"
            className="break-words text-[20px] font-extrabold leading-tight"
            style={{ color: INK }}
          >
            {changed ? (
              <>
                {profitText(real.profit)} →{" "}
                <span style={{ color: PRIMARY }}>{profitText(sim.profit)}</span>
              </>
            ) : (
              profitText(real.profit)
            )}
          </p>
          <p className="mt-2 text-[12px] text-[#4a5a85]">{w.breakEvenDay}</p>
          <p
            data-testid="whatif-breakeven"
            className="break-words text-[16px] font-bold"
            style={{ color: INK }}
          >
            {changed ? (
              <>
                {dayText(real.breakEven)} →{" "}
                <span style={{ color: PRIMARY }}>{dayText(sim.breakEven)}</span>
              </>
            ) : (
              dayText(real.breakEven)
            )}
          </p>
          {changed ? (
            <p
              className="mt-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: PRIMARY }}
            >
              {w.simulation}
              {sim.profit === null ? ` · ${w.missing}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-[12px] text-[#8a92a3]">{w.footnote}</p>
    </section>
  );
}
