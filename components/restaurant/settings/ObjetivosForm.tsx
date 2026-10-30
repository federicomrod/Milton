"use client";

// R1-16a (mock 12): Configuración › Objetivos. Monthly sales, food cost %,
// gross margin %, average ticket (optional); who it applies to; Milton's
// weekday split from real sales; the Cockpit's default comparison. One
// primary button saves everything in one transaction (kpi_targets_save,
// migration 052). A blank field is "no target": it draws no line and no
// chip — it is never saved as 0.

import { NOT_AVAILABLE_YET } from "@/lib/restaurant/ui-copy";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COMPARISONS,
  COMPARISON_LABEL,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
import {
  daysInMonth,
  pickTargetRow,
  weekdayAmounts,
  weightsFromAmounts,
  type TargetRow,
} from "@/lib/restaurant/objetivos";
import type { ObjetivosReferences } from "@/lib/restaurant/objetivos-references";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { fmt } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { formatTypedNumber, typedNumber } from "@/lib/restaurant/locale-number";
import {
  EditorButtons,
  useInlineEditor,
} from "@/components/restaurant/config/InlineEditCard";

/** "2026-10-29" as a short date in the person's language (29 oct 2026 / Oct 29, 2026 / 29. Okt. 2026). */
const dateIn = (ymd: string, locale: string) =>
  new Date(
    Date.UTC(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(5, 7)) - 1,
      Number(ymd.slice(8, 10))
    )
  ).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** "$34,500" / "34500" / "34.500,5" → 34500; empty or junk → null. */
function parseNumber(
  raw: string,
  lang: PreferredLanguage = "es"
): number | null {
  if (lang === "de") return typedNumber(raw, "de");
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,(?=\d{1,2}$)/, ".");
  const plain = cleaned.replace(/,/g, "");
  if (plain === "" || !/^\d*\.?\d+$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface ObjetivosFormProps {
  currency: string;
  restaurants: Array<{ id: string; name: string }>;
  applyTo: string | null;
  rows: TargetRow[];
  /** Migration 052 applied. */
  available: boolean;
  refs: ObjetivosReferences;
  cost30: {
    food_cost_pct: number | null;
    gross_margin_pct: number | null;
  } | null;
  today: string;
  /** When a saved goal starts to apply; the first option is the default. */
  startOptions: Array<{ value: string; label: string }>;
  defaultComparison: Comparison;
  canEdit: boolean;
}

export function ObjetivosForm(props: ObjetivosFormProps) {
  const { currency, refs, cost30, today, available, canEdit } = props;
  const router = useRouter();
  const editor = useInlineEditor();
  const { d, locale, lang } = useT();
  const g = d.settings.goals;
  const DAYS = d.common.weekdaysShort;
  const money = (n: number, d = 0) =>
    formatMoneyEs(n, currency, { decimals: d });

  const rowOf = (metric: TargetRow["metric_key"]) =>
    pickTargetRow(props.rows, metric, today, props.applyTo);
  const revenueRow = rowOf("revenue");
  const monthlyRow =
    revenueRow?.target_period === "monthly" ? revenueRow : null;
  const level = (m: "food_cost_pct" | "gross_margin_pct" | "avg_ticket") => {
    const r = rowOf(m);
    return {
      value: r && r.location_id === props.applyTo ? r.target_value : null,
      inherited: r && r.location_id !== props.applyTo ? r.target_value : null,
    };
  };
  const food = level("food_cost_pct");
  const margin = level("gross_margin_pct");
  const ticket = level("avg_ticket");

  const [revenue, setRevenue] = useState(
    monthlyRow ? formatTypedNumber(monthlyRow.target_value, lang) : ""
  );
  const [foodPct, setFoodPct] = useState(
    food.value !== null ? formatTypedNumber(food.value, lang) : ""
  );
  const [marginPct, setMarginPct] = useState(
    margin.value !== null ? formatTypedNumber(margin.value, lang) : ""
  );
  const [avgTicket, setAvgTicket] = useState(
    ticket.value !== null ? formatTypedNumber(ticket.value, lang) : ""
  );
  const [comparison, setComparison] = useState<Comparison>(
    props.defaultComparison
  );
  const [useSplit, setUseSplit] = useState(
    monthlyRow
      ? monthlyRow.weekday_weights !== null
      : refs.suggestedWeights !== null
  );
  const [edited, setEdited] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; message: string }
    | { kind: "info"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [start, setStart] = useState(props.startOptions[0].value);
  const startLabel =
    props.startOptions.find((o) => o.value === start)?.label ??
    dateIn(start, locale);

  const monthly = parseNumber(revenue, lang);
  const weights =
    edited ?? monthlyRow?.weekday_weights ?? refs.suggestedWeights ?? null;
  const dim = daysInMonth(today);
  const flatDaily = monthly !== null ? monthly / dim : null;
  const amounts =
    weights && monthly !== null ? weekdayAmounts(monthly, weights) : null;
  const legacyDaily =
    revenueRow && revenueRow.target_period === "daily"
      ? revenueRow.target_value
      : null;

  const disabled = !available || !canEdit || status.kind === "saving";

  const dirty = useMemo(() => {
    const same = (draft: string, saved: number | null) =>
      (parseNumber(draft, lang) ?? null) === saved;
    return !(
      same(revenue, monthlyRow ? monthlyRow.target_value : null) &&
      same(foodPct, food.value) &&
      same(marginPct, margin.value) &&
      same(avgTicket, ticket.value) &&
      comparison === props.defaultComparison &&
      edited === null &&
      start === props.startOptions[0].value &&
      useSplit ===
        (monthlyRow
          ? monthlyRow.weekday_weights !== null
          : refs.suggestedWeights !== null)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    revenue,
    foodPct,
    marginPct,
    avgTicket,
    comparison,
    edited,
    useSplit,
    start,
  ]);

  // Unsaved edits warn before leaving the page.
  useEffect(() => {
    editor.setDirty(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function save() {
    // Never a silent button: always say what happened or why nothing did.
    if (!available) {
      setStatus({
        kind: "error",
        message: NOT_AVAILABLE_YET,
      });
      return;
    }
    if (!canEdit) {
      setStatus({
        kind: "error",
        message: d.settings.noEditTargets,
      });
      return;
    }
    if (!dirty) {
      setStatus({ kind: "info", message: g.noChanges });
      return;
    }
    setStatus({ kind: "saving" });
    const body: Record<string, unknown> = {
      version: 2,
      location_id: props.applyTo,
      default_comparison: comparison,
      effective_from: start,
    };
    // A number sets it; a field the person emptied clears it; an untouched empty one is left alone.
    const put = (key: string, draft: string, saved: number | null) => {
      const n = parseNumber(draft, lang);
      if (n !== null) body[key] = n;
      else if (saved !== null) body[key] = null;
    };
    put(
      "revenue_monthly",
      revenue,
      monthlyRow ? monthlyRow.target_value : null
    );
    put("food_cost_pct", foodPct, food.value);
    put("gross_margin_pct", marginPct, margin.value);
    put("avg_ticket", avgTicket, ticket.value);
    if (parseNumber(revenue, lang) !== null) {
      body.weekday_weights = useSplit && weights ? weights : null;
    }
    try {
      const res = await fetch("/api/restaurant/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(userErrorMessage(json, g.saveFailed));
      const message = fmt(g.savedMsg, { date: startLabel.split(" · ")[0] });
      setStatus({ kind: "ok", message });
      setEdited(null);
      editor.saved(message);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : g.saveFailed;
      setStatus({ kind: "error", message });
      editor.failed(message);
    }
  }

  const input =
    "h-9 w-[112px] rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-right text-[14px] text-[#151c2c] outline-none focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20 disabled:bg-[#f4f6fb] disabled:text-[#8a92a3]";
  const dash = "—";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid grid-cols-1 gap-[14px]"
    >
      <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4">
        <div className="mb-2 flex items-center">
          <h2 className="text-[14px] font-bold">{g.title}</h2>
          <span className="ml-auto text-[12px] text-[#8a92a3]">
            {g.leaveEmpty}
          </span>
        </div>
        {!available ? (
          <p
            role="status"
            className="mb-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-[13px]"
          >
            {NOT_AVAILABLE_YET} {g.unavailableNote}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-left text-[12px] font-semibold text-[#4a5a85]">
                <th className="py-1.5">{g.colGoal}</th>
                <th className="py-1.5 text-right">{g.colTarget}</th>
                <th className="px-3 py-1.5">{g.colUse}</th>
                <th className="py-1.5">{g.colReference}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#eef0f4]">
                <td className="py-3 font-bold">{g.monthlySales}</td>
                <td className="py-3 text-right">
                  <input
                    aria-label={g.monthlySales}
                    inputMode="decimal"
                    className={input}
                    disabled={disabled}
                    value={revenue}
                    placeholder="$"
                    onChange={(e) => setRevenue(e.target.value)}
                  />
                </td>
                <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                  {monthly !== null && flatDaily !== null
                    ? `${fmt(g.perDay, { amount: money(flatDaily), days: dim })}${weights && useSplit ? g.perDaySplit : ""}`
                    : legacyDaily !== null
                      ? fmt(g.legacyDaily, { amount: money(legacyDaily) })
                      : "—"}
                </td>
                <td className="py-3 text-[12px] text-[#6b7385]">
                  {refs.avgMonthly6 !== null ? (
                    <>
                      {fmt(g.avg6, { amount: money(refs.avgMonthly6) })}
                      {refs.span6Note ? ` (${refs.span6Note})` : ""}
                    </>
                  ) : (
                    dash
                  )}
                </td>
              </tr>
              <tr className="border-b border-[#eef0f4]">
                <td className="py-3 font-bold">{g.foodCost}</td>
                <td className="py-3 text-right">
                  <input
                    aria-label={g.foodCostAria}
                    inputMode="decimal"
                    className={input}
                    disabled={disabled}
                    value={foodPct}
                    placeholder={
                      food.inherited !== null
                        ? fmt(g.allSuffix, { value: food.inherited })
                        : "%"
                    }
                    onChange={(e) => setFoodPct(e.target.value)}
                  />
                </td>
                <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                  {parseNumber(foodPct, lang) !== null
                    ? fmt(g.redAbove, {
                        value: parseNumber(foodPct, lang) as number,
                      })
                    : g.noGoal}
                </td>
                <td className="py-3 text-[12px] text-[#6b7385]">
                  {cost30?.food_cost_pct != null
                    ? fmt(g.current30, {
                        value: `${Math.round(cost30.food_cost_pct)}%`,
                      })
                    : dash}
                </td>
              </tr>
              <tr className="border-b border-[#eef0f4]">
                <td className="py-3 font-bold">{g.grossMargin}</td>
                <td className="py-3 text-right">
                  <input
                    aria-label={g.grossMarginAria}
                    inputMode="decimal"
                    className={input}
                    disabled={disabled}
                    value={marginPct}
                    placeholder={
                      margin.inherited !== null
                        ? fmt(g.allSuffix, { value: margin.inherited })
                        : "%"
                    }
                    onChange={(e) => setMarginPct(e.target.value)}
                  />
                </td>
                <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                  {parseNumber(marginPct, lang) !== null
                    ? fmt(g.greenFrom, {
                        value: parseNumber(marginPct, lang) as number,
                      })
                    : g.noGoal}
                </td>
                <td className="py-3 text-[12px] text-[#6b7385]">
                  {cost30?.gross_margin_pct != null
                    ? fmt(g.current30, {
                        value: `${Math.round(cost30.gross_margin_pct)}%`,
                      })
                    : dash}
                </td>
              </tr>
              <tr>
                <td className="py-3 font-bold">{g.avgTicket}</td>
                <td className="py-3 text-right">
                  <input
                    aria-label={g.avgTicket}
                    inputMode="decimal"
                    className={input}
                    disabled={disabled}
                    value={avgTicket}
                    placeholder={
                      ticket.inherited !== null
                        ? fmt(g.allSuffix, {
                            value: money(ticket.inherited, 2),
                          })
                        : "$"
                    }
                    onChange={(e) => setAvgTicket(e.target.value)}
                  />
                </td>
                <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                  {g.optional}
                </td>
                <td className="py-3 text-[12px] text-[#6b7385]">
                  {refs.ticket30 !== null
                    ? fmt(g.current30, { value: money(refs.ticket30, 2) })
                    : dash}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-[#4a5a85]">
            {g.effectiveFrom}
            <select
              aria-label={g.effectiveFrom}
              value={start}
              disabled={disabled}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] outline-none focus:border-[#1b40c8]"
            >
              {props.startOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[12px] text-[#8a92a3]">
            {fmt(g.effectiveNote, { date: startLabel.split(" · ")[0] })}
          </span>
          {status.kind === "ok" || status.kind === "info" ? (
            <span role="status" className="text-[12px] text-[#64748B]">
              {status.message}
            </span>
          ) : null}
          {status.kind === "error" ? (
            <span
              role="alert"
              className="rounded-md border border-[#0F172A] px-2 py-1 text-[12px] text-[#0F172A]"
            >
              ⚑ {status.message}
            </span>
          ) : null}
        </div>
        <EditorButtons
          saving={status.kind === "saving"}
          onCancel={editor.close}
        />
      </section>

      <div className="space-y-[14px]">
        <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4">
          <h2 className="text-[14px] font-bold">{g.splitTitle}</h2>
          {weights ? (
            <>
              <p className="mb-2 text-[12px] text-[#8a92a3]">
                {g.splitBasis}
                {monthly !== null
                  ? fmt(g.splitSum, { amount: money(monthly) })
                  : g.splitEnterMonthly}
              </p>
              <div className="flex gap-1.5">
                {DAYS.map((day, i) => (
                  <div key={day} className="flex-1 text-center">
                    <div className="text-[12px] text-[#8a92a3]">{day}</div>
                    {editing === i && amounts ? (
                      <input
                        autoFocus
                        aria-label={fmt(g.amountOf, { day })}
                        defaultValue={formatTypedNumber(
                          Math.round(amounts[i]),
                          lang
                        )}
                        className="mt-1 w-full rounded-md border border-[#1b40c8] px-1 py-1 text-center text-[13px] outline-none"
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                          if (e.key === "Enter") {
                            const n = parseNumber(e.currentTarget.value, lang);
                            if (n !== null) {
                              const next = [...amounts];
                              next[i] = n;
                              const w = weightsFromAmounts(next);
                              if (w) {
                                setEdited(w);
                                setUseSplit(true);
                              }
                            }
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={disabled || !amounts}
                        onClick={() => amounts && setEditing(i)}
                        title={amounts ? g.clickToChange : undefined}
                        className="mt-1 block w-full rounded-md border border-[#E5E7EB] bg-white px-1 py-1 text-[13px] disabled:bg-[#f4f6fb]"
                      >
                        {amounts
                          ? money(amounts[i])
                          : `${Math.round(weights[i] * 100)}%`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-[#4a5a85]">
                <input
                  type="checkbox"
                  checked={useSplit}
                  disabled={disabled}
                  onChange={(e) => setUseSplit(e.target.checked)}
                  className="accent-[#1b40c8]"
                />
                {g.useSplit}
              </label>
              <p className="mt-1 text-[12px] text-[#8a92a3]">{g.clickDay}</p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-[#8a92a3]">
              {g.noSplit}
              {flatDaily !== null
                ? fmt(g.noSplitDaily, { amount: money(flatDaily) })
                : ""}
              .
            </p>
          )}
        </section>

        <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4">
          <h2 className="text-[14px] font-bold">{g.comparisonTitle}</h2>
          <select
            aria-label={g.comparisonAria}
            value={comparison}
            disabled={disabled}
            onChange={(e) => setComparison(e.target.value as Comparison)}
            className="mt-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#1b40c8]"
          >
            {COMPARISONS.map((c) => (
              <option key={c} value={c}>
                {COMPARISON_LABEL[c]}
              </option>
            ))}
          </select>
        </section>
      </div>
    </form>
  );
}
