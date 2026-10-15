"use client";

// R1-17b: the sticky filter bar of Ventas › Detalle. Every control is
// independent and lives in the URL; none of them makes a request (the cube is
// already in the browser). Active filters are blue and each has a chip with ✕.

import { useEffect, useRef, useState } from "react";
import {
  COMPARE_OPTIONS,
  NONE_TOKEN,
  PERIODS,
  channelLabelEs,
  paymentLabelEs,
  type CompareKey,
  type DetailState,
  type PeriodKey,
  type TabKey,
} from "@/lib/restaurant/sales-detail";
import type { DetailCube } from "@/lib/restaurant/sales-detail-cube";
import { OBJECTIVES_HREF } from "@/lib/restaurant/navigation";
import { dayLabelEs, WEEKDAYS_LONG, hourLabel } from "./format";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tendencia", label: "Tendencia" },
  { key: "desglose", label: "Desglose" },
  { key: "platos", label: "Platos" },
];

const base =
  "h-8 rounded-lg border px-2.5 text-[12.5px] outline-none focus:border-[#1b40c8] ";
const idle = "border-[#dfe3ea] bg-white text-[#151c2c]";
const active = "border-[#1b40c8] bg-[#eef2fd] font-semibold text-[#1b40c8]";

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ token: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const text =
    selected.length === 0
      ? "Todos"
      : selected.length === 1
        ? (options.find((o) => o.token === selected[0])?.label ?? selected[0])
        : String(selected.length);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={base + (selected.length ? active : idle)}
      >
        {label}: {text} ▾
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 max-h-72 min-w-[200px] overflow-auto rounded-lg border border-[#dbe3f7] bg-white p-1.5 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-[#8a92a3]">
              Sin opciones
            </p>
          ) : (
            options.map((o) => (
              <label
                key={o.token}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-[#eef2fd]"
              >
                <input
                  type="checkbox"
                  className="accent-[#1b40c8]"
                  checked={selected.includes(o.token)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, o.token]
                        : selected.filter((t) => t !== o.token)
                    )
                  }
                />
                {o.label}
              </label>
            ))
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-[12px] font-semibold text-[#1b40c8] hover:bg-[#eef2fd]"
            >
              Quitar filtro
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterBar({
  state,
  cube,
  shiftsVisible,
  lastDay,
  onChange,
}: {
  state: DetailState;
  cube: DetailCube;
  shiftsVisible: boolean;
  lastDay: string | null;
  onChange: (patch: Partial<DetailState>) => void;
}) {
  const channelOptions = cube.channels.map((c) => ({
    token: c ?? NONE_TOKEN,
    label: channelLabelEs(c),
  }));
  const paymentOptions = cube.payments.map((c) => ({
    token: c ?? NONE_TOKEN,
    label: paymentLabelEs(c),
  }));
  const categoryOptions = [...cube.categories]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((c) => ({ token: c, label: c }));
  const shiftOptions = cube.shifts.map((s) => ({ token: s, label: s }));
  const chips: Array<{
    key: string;
    label: string;
    clear: Partial<DetailState>;
  }> = [];
  if (state.weekdays.length)
    chips.push({
      key: "dia",
      label: `Día: ${state.weekdays.map((d) => WEEKDAYS_LONG[d - 1]).join(", ")}`,
      clear: { weekdays: [] },
    });
  if (state.hours.length)
    chips.push({
      key: "hora",
      label: `Hora: ${state.hours.map(hourLabel).join(", ")}`,
      clear: { hours: [] },
    });
  const dayOnly =
    state.period === "custom" && state.from && state.from === state.to;

  return (
    <div
      className="sticky top-0 z-20 -mx-1 bg-[#f6f7fb]/95 px-1 py-2 backdrop-blur"
      data-testid="sales-filter-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Vista"
          className="inline-flex rounded-[10px] bg-[#e9ecf2] p-[3px]"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={state.tab === t.key}
              onClick={() => onChange({ tab: t.key })}
              className={
                "whitespace-nowrap rounded-lg px-3 py-1 text-[12.5px] font-semibold " +
                (state.tab === t.key
                  ? "bg-white text-[#151c2c] shadow-sm"
                  : "text-[#5b6476] hover:text-[#1b40c8]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Período"
          value={state.period}
          onChange={(e) => onChange({ period: e.target.value as PeriodKey })}
          className={base + (dayOnly ? active : idle)}
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {state.period === "custom" ? (
          <span className="inline-flex items-center gap-1 text-[12.5px]">
            <input
              type="date"
              aria-label="Desde"
              value={state.from ?? ""}
              max={lastDay ?? undefined}
              onChange={(e) => onChange({ from: e.target.value || null })}
              className={base + idle}
            />
            a
            <input
              type="date"
              aria-label="Hasta"
              value={state.to ?? ""}
              max={lastDay ?? undefined}
              onChange={(e) => onChange({ to: e.target.value || null })}
              className={base + idle}
            />
          </span>
        ) : null}
        <select
          aria-label="Comparar con"
          value={state.compare}
          onChange={(e) => onChange({ compare: e.target.value as CompareKey })}
          className={base + idle}
        >
          {COMPARE_OPTIONS.map((c) => (
            <option key={c.key} value={c.key}>
              Comparar: {c.label}
            </option>
          ))}
        </select>
        <MultiSelect
          label="Canal"
          options={channelOptions}
          selected={state.channels}
          onChange={(channels) => onChange({ channels })}
        />
        <MultiSelect
          label="Pago"
          options={paymentOptions}
          selected={state.payments}
          onChange={(payments) => onChange({ payments })}
        />
        <MultiSelect
          label="Categoría"
          options={categoryOptions}
          selected={state.categories}
          onChange={(categories) => onChange({ categories })}
        />
        {shiftsVisible ? (
          <MultiSelect
            label="Turno"
            options={shiftOptions}
            selected={state.shifts}
            onChange={(shifts) => onChange({ shifts })}
          />
        ) : null}
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          Objetivos en{" "}
          <a
            href={OBJECTIVES_HREF}
            className="font-semibold text-[#1b40c8] hover:underline"
          >
            Configuración › Objetivos
          </a>
        </span>
      </div>
      {chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#eef2fd] px-2.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]"
            >
              {c.label}
              <button
                type="button"
                aria-label={`Quitar ${c.label}`}
                onClick={() => onChange(c.clear)}
                className="hover:text-[#151c2c]"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {dayOnly && state.from ? (
        <div className="mt-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef2fd] px-2.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]">
            Día: {dayLabelEs(state.from)}
            <button
              type="button"
              aria-label="Quitar el día"
              onClick={() => onChange({ period: "7d", from: null, to: null })}
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
