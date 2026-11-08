"use client";

// The multi-month overview of Costos fijos: cash categories as rows, three
// months as columns, positions on demand. A read-only reading surface, not a
// spreadsheet: an amount opens its detail, nothing is edited here.
//
// What is NOT known is never drawn as 0: a missing cell is a long dash with the
// word "Falta" for screen readers; a confirmed zero says so in words; a recurring
// reference is italic, labelled, and never part of a total.

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  AMOUNT_CATEGORIES,
  type AmountCategory,
} from "@/lib/restaurant/fixed-costs";
import {
  monthText as monthName,
  type OverviewCell,
  OverviewMonth,
  Overview,
} from "@/lib/restaurant/fixed-cost-overview";
import { categoryLabel } from "@/lib/restaurant/fixed-costs";

export const cellId = (month: string, category: AmountCategory) =>
  `${month}|${category}`;

const TH =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7385]";
const TD = "px-3 py-2 text-left align-top text-sm";
const CHIP =
  "ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold";

export function FixedCostOverview({
  overview,
  currency,
  selectedMonth,
  expanded,
  onToggle,
  onOpen,
  changed,
  onShift,
  canShiftLater,
}: {
  overview: Overview;
  currency: string;
  selectedMonth: string;
  expanded: ReadonlySet<AmountCategory>;
  onToggle: (c: AmountCategory) => void;
  onOpen: (month: string, category: AmountCategory) => void;
  /** Cells to highlight after an import: `month|category`. */
  changed: ReadonlySet<string>;
  onShift: (delta: number) => void;
  canShiftLater: boolean;
}) {
  const { d, lang, fmt } = useT();
  const o = d.costs.fixedOverview;
  const money = (n: number) => formatMoney(n, currency, lang);
  const cat = (c: AmountCategory) => categoryLabel(c, lang);
  const monthText = (m: string) => monthName(m, lang);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const hasShared = overview.months.some((m) => m.sharedTotal !== null);

  function status(m: OverviewMonth): ReactNode {
    if (m.completeness === "complete")
      return (
        <span className={`${CHIP} bg-[#E7EDFD] text-[#1B40C8]`}>
          {o.complete}
        </span>
      );
    if (m.completeness === "none")
      return (
        <span className={`${CHIP} ml-0 bg-[#EEF0F4] text-[#4a5266]`}>
          {o.none}
        </span>
      );
    return (
      <span className={`${CHIP} ml-0 bg-[#FDE68A] text-[#0F172A]`}>
        {fmt(o.partial, { list: m.missing.map(cat).join(", ") })}
      </span>
    );
  }

  function cell(
    m: OverviewMonth,
    c: AmountCategory,
    x: OverviewCell
  ): ReactNode {
    const mark = changed.has(cellId(m.month, c))
      ? "rounded-md bg-[#E7EDFD] ring-1 ring-[#1B40C8]"
      : "";
    const open = (label: ReactNode) => (
      <button
        type="button"
        onClick={() => onOpen(m.month, c)}
        aria-label={fmt(o.open, {
          category: cat(c),
          month: monthText(m.month),
        })}
        data-testid={`cell-${m.month}-${c}`}
        className={`inline-flex min-h-[32px] items-center rounded px-1 font-semibold text-[#151c2c] underline decoration-dotted underline-offset-4 hover:text-[#1B40C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]`}
      >
        {label}
      </button>
    );
    if (x.state === "recorded" || x.state === "zero")
      return (
        <div className={mark}>
          {open(money(x.amount as number))}
          {x.state === "zero" ? (
            <span className={`${CHIP} bg-[#E7EDFD] text-[#1B40C8]`}>
              {o.zero}
            </span>
          ) : null}
          {x.detail === "legacy_total" ? (
            <p className="text-xs text-[#6b7385]">{o.noDetail}</p>
          ) : null}
        </div>
      );
    if (x.state === "recurring")
      return (
        <div data-testid={`cell-${m.month}-${c}`} className={mark}>
          <span className="text-[#6b7385]">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{o.missing}</span>
          </span>
          <p className="text-xs italic text-[#4a5266]">
            {o.recurring}
            <br />
            {fmt(o.recurringRef, {
              amount: money(x.reference as number),
              month: monthText(x.referenceMonth as string),
            })}
          </p>
        </div>
      );
    if (x.state === "draft")
      return (
        <span
          data-testid={`cell-${m.month}-${c}`}
          className="text-xs text-[#6b7385]"
        >
          {o.draft}
        </span>
      );
    return (
      <span
        data-testid={`cell-${m.month}-${c}`}
        className={`text-[#6b7385] ${mark}`}
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">{o.missing}</span>
      </span>
    );
  }

  const chevron =
    "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#dfe3ea] bg-white text-lg font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

  return (
    <section
      aria-label={o.aria}
      data-testid="fixed-overview"
      className="space-y-3"
    >
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={o.windowLabel}
      >
        <button
          type="button"
          onClick={() => onShift(-1)}
          aria-label={o.earlier}
          className={chevron}
          data-testid="window-earlier"
        >
          ‹
        </button>
        <span
          className="min-w-[14rem] text-center text-sm font-semibold text-[#151c2c]"
          data-testid="window-label"
        >
          {overview.months.map((m) => cap(monthText(m.month))).join(" · ")}
        </span>
        <button
          type="button"
          onClick={() => onShift(1)}
          aria-label={o.later}
          disabled={!canShiftLater}
          className={chevron}
          data-testid="window-later"
        >
          ›
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#dfe3ea] bg-white">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">{o.aria}</caption>
          <thead>
            <tr className="border-b border-[#dfe3ea]">
              <th scope="col" className={TH}>
                {o.category}
              </th>
              {overview.months.map((m) => (
                <th
                  key={m.month}
                  scope="col"
                  className={`${TH} ${
                    m.month === selectedMonth ? "text-[#1B40C8]" : ""
                  }`}
                  aria-current={m.month === selectedMonth ? "date" : undefined}
                >
                  <span className="normal-case tracking-normal text-sm text-[#151c2c]">
                    {cap(monthText(m.month))}
                  </span>
                  <div className="mt-1 normal-case tracking-normal">
                    {status(m)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AMOUNT_CATEGORIES.map((c) => {
              const open = expanded.has(c);
              const positions = overview.positions[c];
              return (
                <CategoryRows
                  key={c}
                  c={c}
                  open={open}
                  onToggle={() => onToggle(c)}
                  label={cat(c)}
                  months={overview.months}
                  render={cell}
                  positions={positions}
                  money={money}
                  changed={changed}
                />
              );
            })}
            <tr className="border-t border-[#dfe3ea] bg-[#F8FAFF]">
              <th scope="row" className={`${TD} font-bold text-[#151c2c]`}>
                {o.localTotal}
              </th>
              {overview.months.map((m) => (
                <td
                  key={m.month}
                  className={`${TD} font-bold`}
                  data-testid={`local-${m.month}`}
                >
                  {m.localTotal === null ? (
                    <span className="text-[#6b7385]">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{o.missing}</span>
                    </span>
                  ) : (
                    money(m.localTotal)
                  )}
                </td>
              ))}
            </tr>
            {hasShared ? (
              <>
                <tr className="border-t border-[#dfe3ea]">
                  <th scope="row" className={`${TD} text-[#4a5266]`}>
                    {o.sharedHeading}
                    <p className="text-xs font-normal text-[#6b7385]">
                      {o.sharedNote}
                    </p>
                  </th>
                  {overview.months.map((m) => (
                    <td
                      key={m.month}
                      className={`${TD} text-[#4a5266]`}
                      data-testid={`shared-${m.month}`}
                    >
                      {m.sharedTotal === null ? (
                        <span aria-hidden="true">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          <li className="font-semibold">
                            {money(m.sharedTotal)}
                          </li>
                          {AMOUNT_CATEGORIES.filter(
                            (c) => m.shared[c] !== undefined
                          ).map((c) => (
                            <li key={c} className="text-xs">
                              {cat(c)} · {money(m.shared[c] as number)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-[#dfe3ea] bg-[#F8FAFF]">
                  <th scope="row" className={`${TD} font-bold text-[#151c2c]`}>
                    {o.combinedTotal}
                  </th>
                  {overview.months.map((m) => (
                    <td
                      key={m.month}
                      className={`${TD} font-bold`}
                      data-testid={`combined-${m.month}`}
                    >
                      {m.combinedTotal === null ? (
                        <span aria-hidden="true">—</span>
                      ) : (
                        money(m.combinedTotal)
                      )}
                    </td>
                  ))}
                </tr>
              </>
            ) : null}
            <tr className="border-t border-[#dfe3ea]">
              <th scope="row" className={`${TD} text-[#4a5266]`}>
                {o.taxHeading}
                <p className="text-xs font-normal text-[#6b7385]">
                  {o.taxNote}
                </p>
              </th>
              {overview.months.map((m) => (
                <td key={m.month} className={TD} data-testid={`tax-${m.month}`}>
                  {m.taxRate === null ? (
                    <span className="text-xs text-[#6b7385]">
                      {o.taxMissing}
                    </span>
                  ) : (
                    `${m.taxRate}%`
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#dfe3ea]">
              <th scope="row" className={`${TD} text-[#4a5266]`}>
                {o.breakEven}
              </th>
              {overview.months.map((m) => (
                <td
                  key={m.month}
                  className={TD}
                  data-testid={`breakeven-${m.month}`}
                >
                  {m.breakEvenPerDay !== null ? (
                    <span className="font-semibold">
                      {money(m.breakEvenPerDay)}
                    </span>
                  ) : (
                    <span className="text-xs text-[#6b7385]">
                      {fmt(o.breakEvenWait, {
                        list:
                          [
                            ...m.missing.map(cat),
                            ...(m.figures.missing.some((x) => x.kind === "tax")
                              ? [o.taxHeading.toLowerCase()]
                              : []),
                            ...(m.figures.missing.some(
                              (x) =>
                                x.kind === "margin" || x.kind === "open_days"
                            )
                              ? [o.breakEvenOther]
                              : []),
                          ].join(", ") || o.none,
                      })}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#6b7385]">
        <span className="font-semibold">{o.legend}.</span> {o.legendBody}
      </p>
    </section>
  );
}

function CategoryRows({
  c,
  open,
  onToggle,
  label,
  months,
  render,
  positions,
  money,
  changed,
}: {
  c: AmountCategory;
  open: boolean;
  onToggle: () => void;
  label: string;
  months: OverviewMonth[];
  render: (m: OverviewMonth, c: AmountCategory, x: OverviewCell) => ReactNode;
  positions: Overview["positions"][AmountCategory];
  money: (n: number) => string;
  changed: ReadonlySet<string>;
}) {
  const { d, fmt } = useT();
  const o = d.costs.fixedOverview;
  return (
    <>
      <tr className="border-t border-[#dfe3ea]" data-testid={`row-${c}`}>
        <th scope="row" className={TD}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={fmt(open ? o.collapse : o.expand, { category: label })}
            className="inline-flex min-h-[32px] items-center gap-2 font-semibold text-[#151c2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
          >
            <span aria-hidden="true" className="text-[#1B40C8]">
              {open ? "▾" : "▸"}
            </span>
            {label}
          </button>
        </th>
        {months.map((m) => (
          <td key={m.month} className={TD}>
            {render(m, c, m.cells[c])}
          </td>
        ))}
      </tr>
      {open ? (
        positions.length === 0 ? (
          <tr className="bg-[#F8FAFF]">
            <td
              colSpan={months.length + 1}
              className={`${TD} text-xs text-[#6b7385]`}
            >
              {o.positionsNone}
            </td>
          </tr>
        ) : (
          positions.map((p) => (
            <tr
              key={p.key}
              className="bg-[#F8FAFF]"
              data-testid={`position-${c}-${p.key}`}
            >
              <th
                scope="row"
                className={`${TD} pl-9 font-normal text-[#4a5266]`}
              >
                {p.kind === "legacy_base" ? o.noDetail : (p.label ?? "—")}
              </th>
              {months.map((m) => {
                const a = p.amounts[m.month];
                const mark = changed.has(cellId(m.month, c))
                  ? "rounded bg-[#E7EDFD]"
                  : "";
                return (
                  <td key={m.month} className={`${TD} text-[#4a5266]`}>
                    {a ? (
                      <span className={mark}>{money(a.amount)}</span>
                    ) : (
                      <span className="text-[#9aa1b0]">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{o.missing}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))
        )
      ) : null}
    </>
  );
}
