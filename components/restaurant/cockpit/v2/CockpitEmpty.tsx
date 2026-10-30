// R1 prod bugs 1 (item 6): the Cockpit v2 with nothing to show yet. Same
// structure as the live Cockpit (period, comparison, four cards, range cards,
// the daily chart, the mix, the weeks, the cost per day and the Milton card),
// but every figure is «—» / «Sin datos aún» and the way forward is clear:
// connect the POS, upload the costs. NO number, dish name or currency symbol
// here is made up: this component draws no data at all.

import Link from "next/link";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import { CONNECT_DATA_PATH } from "@/lib/restaurant/post-login";
import { fmt, getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

export type EmptyReason =
  | "unauthenticated"
  | "no_company"
  | "no_sales"
  | "supabase_error"
  | "env_missing";

function Card({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3.5">
      <div className="text-[12px] text-[#6b7385]">{label}</div>
      <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#b0b6c3]">
        —
      </div>
      {sub ? (
        <div className="mt-0.5 text-[12px] text-[#8a92a3]">{sub}</div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  noData,
  children,
}: {
  title: string;
  noData: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
      <h2 className="mb-2 text-[14px] font-bold">{title}</h2>
      {children ?? (
        <p className="py-6 text-center text-[12px] text-[#8a92a3]">{noData}</p>
      )}
    </section>
  );
}

export function CockpitEmpty({
  reason = "no_sales",
  lang = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
}: {
  reason?: EmptyReason;
  lang?: PreferredLanguage;
}) {
  const d = getDictionary(lang).cockpit;
  const REASON_COPY: Record<EmptyReason, string> = {
    no_sales: d.empty.noSales,
    unauthenticated: d.empty.unauthenticated,
    no_company: d.empty.noCompany,
    supabase_error: d.empty.supabaseError,
    env_missing: d.uiCopy.notAvailableYet,
  };
  const NO_DATA = d.empty.noData;
  const PERIODS = [
    d.periods.today,
    d.periods.d7,
    d.periods.d30,
    d.periods.quarter,
  ];
  return (
    <div className="space-y-3" data-testid="cockpit-v2-empty">
      <p
        role="status"
        className="rounded-[14px] border border-[#c6d3f5] bg-[#eef2fd] px-4 py-3 text-[13px] text-[#26314a]"
      >
        {REASON_COPY[reason]}
      </p>

      <div
        className="pointer-events-none flex select-none flex-wrap items-center gap-3 opacity-60"
        aria-hidden="true"
      >
        <div className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold">
          {PERIODS.map((p, i) => (
            <span
              key={p}
              className={
                "rounded-[9px] px-3.5 py-1.5 " +
                (i === 2
                  ? "bg-[#1b40c8] text-white shadow-sm"
                  : "text-[#4a5a85]")
              }
            >
              {p}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] text-[#8a92a3]">
          {d.v2.compareWith} <b>{d.comparisons.months6}</b>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={d.v2.avgDaily} sub={NO_DATA} />
        <Card
          label={fmt(d.v2.salesCard, { period: d.periods.d30 })}
          sub={NO_DATA}
        />
        <Card label={d.v2.foodCost} sub={d.empty.uploadCostsHint} />
        <Card label={d.v2.grossMargin} />
      </div>

      <div
        className="pointer-events-none grid select-none grid-cols-2 gap-2 opacity-60 lg:grid-cols-4"
        aria-hidden="true"
      >
        {PERIODS.map((p) => (
          <div
            key={p}
            className="flex items-center justify-between rounded-xl border border-[#dbe3f7] bg-white px-3 py-2 text-[13px]"
          >
            <span className="font-semibold">{p}</span>
            <span className="text-right text-[#b0b6c3]">
              <b>—</b>
              <span className="block text-[12px]">—</span>
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
        <Panel title={d.v2.dailySales} noData={NO_DATA} />
        <Panel title={d.v2.salesMix} noData={NO_DATA} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title={d.v2.weekVsWeek} noData={NO_DATA} />
        <Panel title={d.v2.foodCostByDay} noData={NO_DATA} />
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <h2 className="mb-2 text-[14px] font-bold">{d.v2.miltonTitle}</h2>
          <p className="text-[13px] leading-relaxed">{d.empty.startHere}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={CONNECT_DATA_PATH}
              className="inline-block rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
            >
              {d.empty.connectPos}
            </Link>
            <Link
              href={costsTabHref("precios")}
              className="inline-block rounded-lg border border-[#c6d3f5] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1b40c8] hover:bg-[#eef2fd]"
            >
              {d.empty.uploadCosts}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
