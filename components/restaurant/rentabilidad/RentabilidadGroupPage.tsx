"use client";

// Rentabilidad #402 · «Todos los restaurantes»: one card per restaurant and a
// Todos card with the exact sum. Cards, not a table: one column at 390 px, no
// horizontal scroll, no tabs or accordions. Brand blues only, no status colours;
// a missing number is «⚑ Falta», never $0.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { useT } from "@/lib/i18n/client";
import {
  dayLabelEs,
  monthLabelEs,
  monthNameEs,
  pctText,
} from "@/lib/restaurant/rentabilidad-copy";
import type { RentabilidadGroupData } from "@/lib/restaurant/rentabilidad-server";
import type {
  GroupLine,
  GroupTotal,
} from "@/lib/restaurant/rentabilidad-group";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  SEGMENT_GROUP,
  segmentBtn,
} from "@/components/restaurant/rentabilidad/RentabilidadPage";

const PRIMARY = "#1B40C8";
const INK = "#0F172A";
const BASE = "/dashboard/restaurant/rentabilidad";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number, money: (n: number) => string) =>
  n < 0 ? `−${money(Math.abs(n))}` : money(n);

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-[#E7EDFD] px-2 py-0.5 text-[12px] font-bold text-[#1B40C8]">
      {children}
    </span>
  );
}

export function RentabilidadGroupPage({
  data,
  months,
  currentMonth,
}: {
  data: RentabilidadGroupData;
  months: string[];
  currentMonth: string;
}) {
  const router = useRouter();
  const { d, lang, fmt } = useT();
  const g = d.rentabilidad.group;
  const r = d.rentabilidad;
  const [pending, startTransition] = useTransition();
  const selected = data.month;
  const { view } = data;
  const goto = (month: string) =>
    startTransition(() =>
      router.push(`${BASE}?${new URLSearchParams({ month }).toString()}`)
    );
  const moneyFor = useMemo(
    () => (currency: string) => (n: number) => formatMoney(n, currency),
    []
  );

  const be = (b: GroupLine["breakEvenDay"], isCurrent: boolean) =>
    b
      ? fmt(b.projected ? g.breakEvenProjected : g.breakEvenDay, {
          day: b.day,
        })
      : isCurrent
        ? g.notYet
        : g.notYet;

  const row = (
    label: string,
    value: React.ReactNode,
    note?: React.ReactNode
  ) => (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold text-[#4a5a85]">{label}</dt>
      <dd className="break-words text-[15px] font-bold" style={{ color: INK }}>
        {value}
      </dd>
      {note ? <dd className="text-[12px] text-[#6b7385]">{note}</dd> : null}
    </div>
  );

  const total: GroupTotal | null = view.total;
  const totalMoney = view.currency ? moneyFor(view.currency) : null;

  return (
    <div
      className={
        "w-full min-w-0 space-y-3 px-4 py-3 sm:px-6 lg:px-10 " +
        (pending ? "opacity-70 transition-opacity" : "transition-opacity")
      }
      aria-busy={pending}
    >
      <OperatingPageHeader
        title={`${r.title} · ${g.title}`}
        showDateRange={false}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={r.page.monthGroup}
          className={SEGMENT_GROUP}
        >
          {months.map((month) => (
            <button
              key={month}
              type="button"
              onClick={() => goto(month)}
              aria-pressed={month === selected}
              className={segmentBtn(month === selected)}
            >
              {month === currentMonth
                ? fmt(r.page.thisMonth, {
                    month: capitalize(monthNameEs(month, lang)),
                  })
                : capitalize(monthNameEs(month, lang))}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[#8a92a3]">
          {data.isCurrentMonth
            ? fmt(r.page.dataUntilYesterday, {
                day: dayLabelEs(
                  new Date(Date.parse(`${data.today}T00:00:00Z`) - 86400000)
                    .toISOString()
                    .slice(0, 10),
                  lang
                ),
              })
            : monthLabelEs(data.month, lang)}
        </span>
      </div>
      <p className="text-[13px] text-[#4a5a85]">{g.intro}</p>

      {total === null ? (
        <section
          aria-label={g.currencyTitle}
          className="min-w-0 rounded-[14px] border border-[#9db4f0] bg-[#E7EDFD] p-4"
        >
          <h2 className="text-[14px] font-bold" style={{ color: PRIMARY }}>
            {g.currencyTitle}
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: INK }}>
            {fmt(g.currencyBody, { currencies: view.currencies.join(", ") })}
          </p>
        </section>
      ) : (
        <section
          aria-label={g.total}
          data-testid="group-total"
          className="min-w-0 rounded-[14px] border border-[#1B40C8] bg-white p-4"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-bold" style={{ color: PRIMARY }}>
              {g.total}
            </h2>
            {total.estimate ? <Flag>{g.estimateTag}</Flag> : null}
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {row(g.sales, totalMoney!(total.sales))}
            {row(
              g.margin,
              totalMoney!(total.margin),
              total.marginPct !== null
                ? fmt(g.marginPctOf, { pct: pctText(total.marginPct, 1, lang) })
                : undefined
            )}
            {row(
              g.fixed,
              total.fixedTotal !== null ? (
                totalMoney!(total.fixedTotal)
              ) : (
                <Flag>{g.missing}</Flag>
              )
            )}
            {row(
              total.estimate ? g.profitEstimated : g.profit,
              total.profit !== null ? (
                signed(total.profit, totalMoney!)
              ) : total.missingFixed.length > 0 ? (
                <Flag>{g.missing}</Flag>
              ) : (
                <Flag>{g.noSales}</Flag>
              )
            )}
            {row(
              g.breakEven,
              total.fixedTotal === null ? (
                <Flag>{g.missing}</Flag>
              ) : (
                be(total.breakEvenDay, data.isCurrentMonth)
              )
            )}
          </dl>
          {total.missingFixed.length > 0 ? (
            <p className="mt-3 text-[12px] text-[#4a5a85]">
              {fmt(g.missingFixedNote, {
                names: total.missingFixed.join(", "),
              })}
            </p>
          ) : null}
          {total.noSales.length > 0 ? (
            <p className="mt-1 text-[12px] text-[#4a5a85]">
              {fmt(g.noSalesNote, { names: total.noSales.join(", ") })}
            </p>
          ) : null}
        </section>
      )}

      <ul
        className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2"
        aria-label={g.aria}
      >
        {view.lines.map((l) => {
          const money = moneyFor(l.currency);
          return (
            <li
              key={l.locationId}
              data-testid="group-line"
              className="min-w-0 rounded-[14px] border border-[#dbe3f7] bg-white p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3
                  className="break-words text-[15px] font-bold"
                  style={{ color: INK }}
                >
                  {l.name}
                </h3>
                {l.estimate ? <Flag>{g.estimateTag}</Flag> : null}
              </div>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {row(
                  g.sales,
                  l.hasData ? money(l.sales) : <Flag>{g.noSales}</Flag>
                )}
                {row(
                  g.margin,
                  l.hasData ? money(l.margin) : "—",
                  l.hasData && l.marginPct !== null
                    ? fmt(g.marginPctOf, { pct: pctText(l.marginPct, 1, lang) })
                    : undefined
                )}
                {row(
                  g.fixed,
                  l.fixedTotal !== null ? (
                    money(l.fixedTotal)
                  ) : (
                    <Flag>{g.missing}</Flag>
                  ),
                  l.fixedTotal !== null ? g.fixedShare : undefined
                )}
                {row(
                  l.estimate ? g.profitEstimated : g.profit,
                  l.profit !== null ? (
                    signed(l.profit, money)
                  ) : l.missingFixed ? (
                    <Flag>{g.missing}</Flag>
                  ) : (
                    <Flag>{g.noSales}</Flag>
                  )
                )}
                {row(
                  g.breakEven,
                  l.missingFixed ? (
                    <Flag>{g.missing}</Flag>
                  ) : (
                    be(l.breakEvenDay, data.isCurrentMonth)
                  )
                )}
              </dl>
              {l.uncoveredPct !== null ? (
                <p className="mt-3">
                  <Flag>
                    {fmt(g.coverageFlag, {
                      pct: pctText(l.uncoveredPct, 0, lang),
                    })}
                  </Flag>
                </p>
              ) : null}
              <Link
                href={`${BASE}?${new URLSearchParams({ location: l.locationId, month: data.month }).toString()}`}
                className="mt-3 inline-block text-[13px] font-bold underline"
                style={{ color: PRIMARY }}
              >
                {g.open}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
