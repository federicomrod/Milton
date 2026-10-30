"use client";

// R1-17b: the five KPI cards. Each has a goal chip (only when Objetivos has a
// goal and no dimension filter is active) and a Δ chip against the chosen
// comparison; no comparable period is «—», never 0%.

import { useState } from "react";
import type { DetailView, Kpi } from "@/lib/restaurant/sales-detail";
import { useT } from "@/lib/i18n/client";
import { dayLabelEs, moneyFmt, pctLabel } from "./format";

function Chip({ text, tone }: { text: string; tone: "good" | "bad" | "flat" }) {
  const cls =
    tone === "good"
      ? "bg-[#A7F3D0] text-[#0F172A]"
      : tone === "bad"
        ? "bg-[#FBCFE8] text-[#0F172A]"
        : "bg-[#f2f3f6] text-[#5b6476]";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {text}
    </span>
  );
}

const tone = (d: number | null) =>
  d === null || Math.abs(d) < 1 ? "flat" : d > 0 ? "good" : "bad";

function Chips({ kpi, short }: { kpi: Kpi; short: string }) {
  const { d, lang, fmt } = useT();
  const k = d.sales.detail.kpi;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {kpi.vsTarget !== null ? (
        <Chip
          text={fmt(k.vsTarget, { pct: pctLabel(kpi.vsTarget, 1, lang) })}
          tone={tone(kpi.vsTarget)}
        />
      ) : null}
      <Chip
        text={
          kpi.delta === null
            ? fmt(k.vsShortNone, { short })
            : fmt(k.vsShort, { pct: pctLabel(kpi.delta, 1, lang), short })
        }
        tone={tone(kpi.delta)}
      />
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  children,
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-[#eef0f4] bg-white px-3.5 py-3">
      <div className="flex items-center gap-1 text-[12px] text-[#6b7385]">
        {label}
        {info}
      </div>
      <div className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11.5px] text-[#8a92a3]">{sub}</div>
      ) : null}
      {children}
    </div>
  );
}

export function KpiRow({
  view,
  currency,
}: {
  view: DetailView;
  currency: string;
}) {
  const { d, lang, fmt, locale } = useT();
  const k0 = d.sales.detail.kpi;
  const money = moneyFmt(currency, lang);
  const [tip, setTip] = useState(false);
  const k = view.kpis;
  const short = view.compare.short;
  const dash = "—";
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      data-testid="sales-kpis"
    >
      <Card
        label={k0.net}
        value={k.net.value === null ? dash : money(k.net.value)}
        sub={
          k.net.target !== null
            ? fmt(k0.target, { amount: money(k.net.target) })
            : undefined
        }
        info={
          <span className="relative">
            <button
              type="button"
              aria-label={k0.netInfoAria}
              onMouseEnter={() => setTip(true)}
              onMouseLeave={() => setTip(false)}
              onFocus={() => setTip(true)}
              onBlur={() => setTip(false)}
              className="text-[#8a92a3] hover:text-[#1b40c8]"
            >
              ⓘ
            </button>
            {tip ? (
              <span
                role="tooltip"
                className="absolute left-0 top-5 z-30 w-52 rounded-lg bg-[#151c2c] p-2.5 text-[12px] text-white shadow-lg"
              >
                <span className="flex justify-between">
                  <span>{k0.gross}</span>
                  <b>{money(k.gross, 2)}</b>
                </span>
                <span className="flex justify-between">
                  <span>{k0.discounts}</span>
                  <b>−{money(k.discounts, 2)}</b>
                </span>
                <span className="flex justify-between border-t border-white/20 pt-1">
                  <span>{k0.net}</span>
                  <b>{money(k.net.value ?? 0, 2)}</b>
                </span>
                <span className="mt-1 flex justify-between text-[#cfd5e2]">
                  <span>{k0.tipsApart}</span>
                  <b>{money(k.tips, 2)}</b>
                </span>
              </span>
            ) : null}
          </span>
        }
      >
        <Chips kpi={k.net} short={short} />
      </Card>
      <Card
        label={k0.tickets}
        value={
          k.tickets.value === null
            ? dash
            : k.tickets.value.toLocaleString(locale)
        }
      >
        <Chips kpi={k.tickets} short={short} />
      </Card>
      <Card
        label={k0.avgTicket}
        value={k.ticket.value === null ? dash : money(k.ticket.value, 2)}
        sub={
          k.ticket.target !== null
            ? fmt(k0.target, { amount: money(k.ticket.target, 2) })
            : undefined
        }
      >
        <Chips kpi={k.ticket} short={short} />
      </Card>
      <Card
        label={k0.units}
        value={
          k.units.value === null
            ? dash
            : Math.round(k.units.value).toLocaleString(locale)
        }
        sub={
          k.units.value && k.net.value !== null
            ? fmt(k0.perUnit, {
                amount: money(k.net.value / k.units.value, 2),
              })
            : undefined
        }
      >
        <Chips kpi={k.units} short={short} />
      </Card>
      <Card
        label={k0.bestDay}
        value={k.best ? money(k.best.net) : dash}
        sub={
          k.best
            ? fmt(k0.bestDaySub, {
                day: dayLabelEs(k.best.date, lang),
                tickets: k.best.tickets,
              })
            : k0.noSalesPeriod
        }
      />
    </div>
  );
}
