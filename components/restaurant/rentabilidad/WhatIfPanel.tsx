"use client";

// «¿Y si…?» (#401): a simulator on the month's real numbers. Runs in the
// browser, writes nothing and never touches the page's real figures. Neutral
// brand colours only; a simulated value is always labelled «Simulación».

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { categoryLabel } from "@/lib/restaurant/fixed-costs";
import { AMOUNT_CATEGORIES } from "@/lib/restaurant/fixed-costs";
import {
  formatTypedNumber,
  parseLocaleNumber,
} from "@/lib/restaurant/locale-number";
import type { RentabilidadMonth } from "@/lib/restaurant/rentabilidad";
import {
  realResult,
  sameValues,
  simulate,
  whatIfBase,
  whatIfContext,
  type WhatIfValues,
} from "@/lib/restaurant/what-if";

const PRIMARY = "#1B40C8";
const INK = "#0F172A";

type FieldKey =
  | "sales"
  | "foodPct"
  | "impuestosPct"
  | (typeof AMOUNT_CATEGORIES)[number];

const FIELD =
  "block w-full min-w-0 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-2 text-[14px] font-bold text-[#1b2333] outline-none focus:border-[#1B40C8]";

function signed(n: number, money: (n: number) => string): string {
  return n < 0 ? `−${money(Math.abs(n))}` : money(n);
}

export function WhatIfPanel({
  month,
  money,
}: {
  month: RentabilidadMonth;
  money: (n: number) => string;
}) {
  const { d, lang, fmt } = useT();
  const w = d.rentabilidad.whatIf;
  const base = useMemo(() => whatIfBase(month), [month]);
  const ctx = useMemo(() => whatIfContext(month), [month]);
  const textOf = (v: WhatIfValues): Record<FieldKey, string> => {
    const t = (n: number | null, digits = 2) =>
      n === null
        ? ""
        : formatTypedNumber(Math.round(n * 10 ** digits) / 10 ** digits, lang);
    return {
      sales: t(v.sales),
      foodPct: t(v.foodPct, 1),
      impuestosPct: t(v.impuestosPct, 2),
      planilla: t(v.amounts.planilla),
      alquiler: t(v.amounts.alquiler),
      servicios: t(v.amounts.servicios),
      otros: t(v.amounts.otros),
    };
  };
  const [values, setValues] = useState<WhatIfValues>(base);
  const [text, setText] = useState(() => textOf(base));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, true>>>({});

  const changed = !sameValues(values, base);
  const real = useMemo(() => realResult(month), [month]);
  const sim = useMemo(
    () => simulate(values, ctx, { month }),
    [values, ctx, month]
  );

  function edit(key: FieldKey, raw: string) {
    setText((t) => ({ ...t, [key]: raw }));
    const parsed = parseLocaleNumber(raw, lang);
    const isPct = key === "foodPct" || key === "impuestosPct";
    if (!parsed.ok || (isPct && (parsed.value ?? 0) > 100)) {
      setErrors((e) => ({ ...e, [key]: true }));
      return;
    }
    setErrors((e) => {
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
    const n = parsed.value;
    setValues((v) => {
      if (key === "sales") return { ...v, sales: n ?? 0 };
      if (key === "foodPct" || key === "impuestosPct")
        return { ...v, [key]: n };
      return { ...v, amounts: { ...v.amounts, [key]: n } };
    });
  }

  function reset() {
    setValues(base);
    setText(textOf(base));
    setErrors({});
  }

  const salesCleared = text.sales.trim() === "" && !errors.sales;
  const input = (key: FieldKey, label: string, suffix?: string) => {
    const missing =
      (key === "foodPct" && values.foodPct === null) ||
      (key === "sales" && salesCleared) ||
      ((AMOUNT_CATEGORIES as readonly string[]).includes(key) &&
        text[key] === "");
    return (
      <label className="block min-w-0">
        <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-[12px] font-semibold text-[#4a5a85]">
          <span>{label}</span>
          {missing ? (
            <span className="font-bold" style={{ color: PRIMARY }}>
              {w.missing}
            </span>
          ) : null}
        </span>
        <span className="relative block">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text[key]}
            placeholder={key === "impuestosPct" ? w.taxUndefined : undefined}
            aria-invalid={errors[key] ? true : undefined}
            onChange={(e) => edit(key, e.target.value)}
            className={FIELD + (suffix ? " pr-8" : "")}
          />
          {suffix ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-[#8a92a3]">
              {suffix}
            </span>
          ) : null}
        </span>
        {errors[key] ? (
          <span
            className="mt-1 block text-[12px] font-semibold"
            style={{ color: PRIMARY }}
          >
            {w.invalid}
          </span>
        ) : null}
      </label>
    );
  };

  const result = (
    label: string,
    realValue: string,
    simValue: string,
    flag: boolean
  ) => (
    <div className="min-w-0 rounded-[12px] border border-[#c6d3f5] bg-white p-3">
      <p className="text-[12px] font-semibold text-[#4a5a85]">{label}</p>
      <p
        data-testid="whatif-sim-value"
        className="mt-1 break-words text-[22px] font-bold leading-tight"
        style={{ color: PRIMARY }}
      >
        {simValue}
      </p>
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: PRIMARY }}
      >
        {w.simulation}
        {flag ? ` · ${w.missing}` : ""}
      </p>
      <p className="mt-1 text-[12px] text-[#6b7385]">
        {fmt(w.realValue, { value: realValue })}
      </p>
    </div>
  );

  const dash = "—";
  return (
    <section
      aria-label={w.aria}
      data-testid="whatif-panel"
      className="min-w-0 space-y-3 rounded-[14px] border border-dashed border-[#9db4f0] bg-[#F5F8FF] p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[15px] font-bold" style={{ color: INK }}>
          {w.title}
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
          style={{ background: PRIMARY }}
        >
          {w.simulation}
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={!changed && Object.keys(errors).length === 0}
          className="ml-auto rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] font-bold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-50"
        >
          {w.reset}
        </button>
      </div>
      <p className="text-[13px] leading-snug text-[#4a5a85]">{w.intro}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {input("sales", w.sales)}
        {input("foodPct", w.food, "%")}
        {input("impuestosPct", w.taxes, "%")}
      </div>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-[12px] font-bold uppercase tracking-wide text-[#4a5a85]">
          {w.fixed}
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AMOUNT_CATEGORIES.map((c) => (
            <div key={c} className="min-w-0">
              {input(c, categoryLabel(c, lang))}
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-live="polite">
        {result(
          w.breakEven,
          real.breakEvenPerDay !== null ? money(real.breakEvenPerDay) : dash,
          sim.breakEvenPerDay !== null ? money(sim.breakEvenPerDay) : dash,
          sim.fixedTotal === null || salesCleared
        )}
        {result(
          w.profit,
          real.profit !== null ? signed(real.profit, money) : dash,
          sim.profit !== null ? signed(sim.profit, money) : dash,
          sim.fixedTotal === null || salesCleared
        )}
      </div>
      <p className="text-[12px] text-[#6b7385]">{w.footnote}</p>
    </section>
  );
}
