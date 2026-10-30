// components/restaurant/costs/FixedCostsTab.tsx
//
// Costos › Costos fijos (#398). One row per category (Planilla, Alquiler,
// Servicios, Otros and Impuestos as a tax rate), the month picker, «repetir
// cada mes», the history and a live break-even: «Necesitas vender $X al día».
// The break-even is recomputed on the client on every keystroke from the pure
// helpers in lib/restaurant/fixed-costs.ts. A missing cost shows ⚑ Falta and
// never a number; a typed 0 counts as filled. Side panel on desktop, a fixed
// bar at the bottom on a phone — Guardar cambios is always visible.

"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  AMOUNT_CATEGORIES,
  categoryLabel,
  FIXED_COST_CATEGORIES,
  breakEvenPerDay,
  effectiveFixedCosts,
  fixedCostCompleteness,
  previewGroupSplit,
  nextMonthStart,
  previousMonthStart,
  type FixedCostCategory,
  type FixedCostLine,
  type MarginInputs,
  type SplitRule,
} from "@/lib/restaurant/fixed-costs";
import type {
  FixedCostHistoryItem,
  FixedCostsView,
} from "@/lib/restaurant/fixed-costs-server";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import { getDictionary } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  formatTypedNumber,
  parseLocaleNumber,
  typedNumber,
} from "@/lib/restaurant/locale-number";

export function monthLabelEs(
  month: string,
  lang: PreferredLanguage = "es"
): string {
  const [y, m] = month.split("-").map(Number);
  return `${getDictionary(lang).rentabilidad.months[m - 1]} ${y}`;
}

/**
 * Typed text → number by the language's format; "" / invalid → null (an empty
 * field is missing, never 0). Invalid text is reported by the field, never
 * guessed (see lib/restaurant/locale-number.ts).
 */
export function parseTyped(
  text: string,
  lang: PreferredLanguage = "es"
): number | null {
  return typedNumber(text, lang);
}

const toText = (v: number | null, lang: PreferredLanguage) =>
  v === null ? "" : formatTypedNumber(v, lang);

const FLAG = "⚑";

function describeValue(
  v: { amount: number | null; pct_of_sales: number | null } | null,
  currency: string,
  lang: PreferredLanguage
): string {
  if (!v) return "—";
  if (v.pct_of_sales !== null) return `${v.pct_of_sales}%`;
  return v.amount === null ? "—" : formatMoney(v.amount, currency, lang);
}

export interface FixedCostsTabProps {
  view: FixedCostsView;
  history: FixedCostHistoryItem[];
  /** Name of the selected restaurant; null = the group's shared costs. */
  locationName: string | null;
  shellParams: Record<string, string | string[] | undefined>;
  /** The current month (YYYY-MM-01), the latest the picker goes to. */
  currentMonth: string;
  /** Group view only: the restaurants and their month sales, for the «Repartir» preview. */
  splitTargets?: Array<{
    location_id: string;
    name: string;
    sales: number | null;
  }>;
}

export function FixedCostsTab({
  view,
  history,
  locationName,
  shellParams,
  currentMonth,
  splitTargets = [],
}: FixedCostsTabProps) {
  const router = useRouter();
  const { d, lang, locale, fmt } = useT();
  const f = d.costs.fixed;
  // Spanish and English write a category inside a sentence in lower case;
  // German nouns keep their capital.
  const inText = (c: FixedCostCategory) =>
    lang === "de"
      ? categoryLabel(c, lang)
      : categoryLabel(c, lang).toLowerCase();
  const actionText: Record<string, string> = {
    create: f.historyCreate,
    update: f.historyUpdate,
    delete: f.historyDelete,
    repeat: f.historyRepeat,
  };
  const sourceText: Record<string, string> = {
    manual: f.sourceManual,
    repeat: f.sourceRepeat,
    estimate: f.sourceEstimate,
    upload: f.sourceUpload,
  };
  const isGroup = view.locationId === null;
  const byCategory = useMemo(() => {
    const map = new Map<FixedCostCategory, FixedCostLine>();
    for (const l of view.lines) map.set(l.category, l);
    return map;
  }, [view.lines]);

  const [values, setValues] = useState<Record<FixedCostCategory, string>>(
    () => {
      const out = {} as Record<FixedCostCategory, string>;
      for (const c of FIXED_COST_CATEGORIES) {
        const l = byCategory.get(c);
        out[c] = toText(
          c === "impuestos" ? (l?.pct_of_sales ?? null) : (l?.amount ?? null),
          lang
        );
      }
      return out;
    }
  );
  const [repeats, setRepeats] = useState(
    view.lines.length > 0 && view.lines.every((l) => l.repeats)
  );
  const [splitRule, setSplitRule] = useState<SplitRule>(
    view.lines.find((l) => l.split_rule)?.split_rule ?? "sales"
  );
  const nameOf = useMemo(
    () => new Map(splitTargets.map((t) => [t.location_id, t.name])),
    [splitTargets]
  );
  const splitPreview = useMemo(
    () =>
      previewGroupSplit(
        AMOUNT_CATEGORIES.map((c) => parseTyped(values[c], lang)),
        splitRule,
        splitTargets
      ),
    [values, splitRule, splitTargets]
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const dirty =
    FIXED_COST_CATEGORIES.some((c) => {
      const l = byCategory.get(c);
      const saved = toText(
        c === "impuestos" ? (l?.pct_of_sales ?? null) : (l?.amount ?? null),
        lang
      );
      return values[c].trim() !== saved;
    }) ||
    (view.lines.length > 0 && repeats !== view.lines.every((l) => l.repeats));

  // Live: pure and cheap, recomputed on every keystroke.
  const live = useMemo(() => {
    const typed = FIXED_COST_CATEGORIES.map((c) => {
      const n = parseTyped(values[c], lang);
      return {
        category: c,
        amount: c === "impuestos" ? null : n,
        pct_of_sales: c === "impuestos" ? n : null,
      };
    }).filter((l) =>
      l.category === "impuestos" ? l.pct_of_sales !== null : l.amount !== null
    );
    const costs = effectiveFixedCosts(
      typed,
      view.groupShares,
      view.groupImpuestosPct
    );
    const completeness = fixedCostCompleteness(costs);
    const margin: MarginInputs | null = view.margin;
    const breakEven = breakEvenPerDay({
      amounts: costs.amounts,
      impuestosPct: costs.impuestosPct,
      margin,
      openDays: view.openDays,
    });
    return { costs, completeness, breakEven };
  }, [
    values,
    view.groupShares,
    view.groupImpuestosPct,
    view.margin,
    view.openDays,
  ]);

  const missingAmounts = live.completeness.missingAmounts;
  const missingSet = new Set(live.completeness.missing);

  function goMonth(month: string) {
    const params: Record<string, string | string[] | undefined> = {
      ...shellParams,
      month: month.slice(0, 7),
    };
    router.push(costsTabHref("costos-fijos", params));
  }

  // Text that does not fit the language's number format is shown as an error
  // on its field and blocks saving: never saved as a different number.
  const invalid = new Set(
    FIXED_COST_CATEGORIES.filter((c) => !parseLocaleNumber(values[c], lang).ok)
  );

  async function save() {
    if (invalid.size > 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/restaurant/fixed-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: view.month,
          location_id: view.locationId,
          entries: FIXED_COST_CATEGORIES.map((category) => ({
            category,
            value: parseTyped(values[category], lang),
            repeats,
            split_rule: isGroup ? splitRule : null,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({
          ok: false,
          text: body.error ?? f.saveFailed,
        });
      } else {
        setMessage({ ok: true, text: f.saved });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: f.saveFailed });
    } finally {
      setSaving(false);
    }
  }

  const breakEvenText =
    live.breakEven !== null
      ? formatMoney(live.breakEven, view.currency, lang)
      : null;
  const flagReason =
    missingAmounts.length > 0
      ? fmt(f.reasonMissing, { list: missingAmounts.map(inText).join(", ") })
      : view.marginReason
        ? view.marginReason
        : f.reasonNoMargin;

  const saveButton = (
    <button
      type="button"
      onClick={save}
      disabled={saving || !dirty || invalid.size > 0}
      className="inline-flex h-11 min-w-[9rem] items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? f.saving : f.save}
    </button>
  );

  const breakEvenBlock = (compact: boolean) =>
    breakEvenText ? (
      <div data-testid="break-even">
        <p className="text-sm font-medium text-[#6b7385]">{f.breakEven}</p>
        <p className="text-base font-semibold text-[#151c2c]">
          {f.needSellBefore}{" "}
          <span className="text-[#1B40C8]" data-testid="break-even-value">
            {breakEvenText}
          </span>{" "}
          {f.needSellAfter}
        </p>
      </div>
    ) : (
      <div data-testid="break-even">
        <p className="text-sm font-medium text-[#6b7385]">{f.breakEven}</p>
        <p className="text-base font-semibold text-[#151c2c]">
          <span aria-hidden="true">{FLAG}</span> {f.missing}
          <span className="sr-only">{f.missingDataSr}</span>
        </p>
        {!compact ? (
          <p className="mt-1 text-sm text-[#6b7385]">{flagReason}</p>
        ) : null}
      </div>
    );

  const prevMonth = previousMonthStart(view.month);
  const nextMonth = nextMonthStart(view.month);

  return (
    <section
      className="space-y-4 pb-28 lg:pb-0"
      aria-label={f.sectionAria}
      data-testid="fixed-costs-tab"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#151c2c]">
            {isGroup ? f.groupTitle : (locationName ?? f.restaurant)}
          </h2>
          <p className="text-sm text-[#6b7385]">
            {isGroup ? f.groupHint : f.locationHint}
          </p>
        </div>
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label={f.monthGroup}
        >
          <button
            type="button"
            onClick={() => goMonth(prevMonth)}
            aria-label={f.prevMonth}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#E7EDFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
          >
            ‹
          </button>
          <span
            className="min-w-[8.5rem] text-center text-sm font-semibold capitalize text-[#151c2c]"
            data-testid="fixed-costs-month"
          >
            {monthLabelEs(view.month, lang)}
          </span>
          <button
            type="button"
            onClick={() => goMonth(nextMonth)}
            disabled={view.month >= currentMonth}
            aria-label={f.nextMonth}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#E7EDFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      <div className="lg:flex lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-4 lg:flex-1">
          <div className="divide-y divide-[#dfe3ea] rounded-xl border border-[#dfe3ea] bg-white">
            {FIXED_COST_CATEGORIES.map((category) => {
              const isTax = category === "impuestos";
              const missing = missingSet.has(category);
              const share = isTax
                ? null
                : (view.groupShares[
                    category as (typeof AMOUNT_CATEGORIES)[number]
                  ] ?? null);
              const id = `fixed-${category}`;
              return (
                <div
                  key={category}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4"
                  data-testid={`fixed-row-${category}`}
                >
                  <div className="min-w-0 flex-1 basis-32">
                    <label
                      htmlFor={id}
                      className="text-sm font-semibold text-[#151c2c]"
                    >
                      {categoryLabel(category, lang)}
                    </label>
                    {isTax ? (
                      <p className="text-sm text-[#6b7385]">{f.taxHint}</p>
                    ) : share !== null ? (
                      <p className="text-sm text-[#6b7385]">
                        {fmt(f.groupShare, {
                          amount: formatMoney(share, view.currency, lang),
                        })}
                      </p>
                    ) : null}
                  </div>
                  {missing ? (
                    <span
                      className="rounded-full bg-[#FDE68A] px-2 py-0.5 text-sm font-semibold text-[#0F172A]"
                      data-testid={`falta-${category}`}
                    >
                      <span aria-hidden="true">{FLAG}</span> {f.missing}
                    </span>
                  ) : null}
                  <div className="flex items-center gap-1">
                    {!isTax ? (
                      <span
                        className="text-sm text-[#6b7385]"
                        aria-hidden="true"
                      >
                        {view.currency === "MXN" || view.currency === "USD"
                          ? "$"
                          : view.currency}
                      </span>
                    ) : null}
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={values[category]}
                      aria-invalid={invalid.has(category) || undefined}
                      aria-describedby={
                        invalid.has(category) ? `${id}-error` : undefined
                      }
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [category]: e.target.value }))
                      }
                      placeholder={isTax ? "0" : f.noData}
                      className="h-11 w-32 rounded-lg border border-[#c9cfdb] bg-white px-3 text-right text-sm text-[#151c2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
                    />
                    {isTax ? (
                      <span
                        className="text-sm text-[#6b7385]"
                        aria-hidden="true"
                      >
                        %
                      </span>
                    ) : null}
                  </div>
                  {invalid.has(category) ? (
                    <p
                      id={`${id}-error`}
                      role="alert"
                      className="w-full text-right text-sm text-[#151c2c]"
                    >
                      <span aria-hidden="true">{FLAG}</span> {f.invalidNumber}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {missingAmounts.length > 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1B40C8] bg-[#E7EDFD] p-4"
              data-testid="falta-cta"
            >
              <p className="text-sm font-medium text-[#151c2c]">
                <span aria-hidden="true">{FLAG}</span> {f.missingCta}
              </p>
              <button
                type="button"
                onClick={() => {
                  const first = missingAmounts[0];
                  if (first) document.getElementById(`fixed-${first}`)?.focus();
                }}
                className="inline-flex h-11 items-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
              >
                {f.uploadFixed}
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-[#dfe3ea] bg-white p-4">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-medium text-[#151c2c]">
              <input
                type="checkbox"
                role="switch"
                checked={repeats}
                onChange={(e) => setRepeats(e.target.checked)}
                className="h-5 w-5 accent-[#1B40C8]"
              />
              {f.repeatMonthly}
            </label>
            {isGroup ? (
              <label className="flex items-center gap-2 text-sm font-medium text-[#151c2c]">
                {f.split}
                <select
                  value={splitRule}
                  onChange={(e) => setSplitRule(e.target.value as SplitRule)}
                  className="h-11 rounded-lg border border-[#c9cfdb] bg-white px-3 text-sm"
                >
                  <option value="sales">{f.splitSales}</option>
                  <option value="equal">{f.splitEqual}</option>
                </select>
              </label>
            ) : null}
            {isGroup && splitPreview.kind !== "single" ? (
              <div className="basis-full text-xs text-[#6b7385]">
                {splitPreview.kind === "empty" ? (
                  <p data-testid="split-preview">{f.splitEmpty}</p>
                ) : (
                  <>
                    <p
                      data-testid="split-preview"
                      className="font-medium text-[#151c2c]"
                    >
                      {splitPreview.shares
                        .map(
                          (sh) =>
                            `${nameOf.get(sh.location_id) ?? f.restaurant} ${formatMoney(sh.amount, view.currency, lang)}`
                        )
                        .join(" · ")}
                    </p>
                    {splitPreview.fellBackToEqual ? (
                      <p>{f.splitNoSales}</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>

          {message ? (
            <p
              role="status"
              className={
                "text-sm font-medium " +
                (message.ok
                  ? "text-[#151c2c]"
                  : "inline-block rounded-lg bg-[#FDE68A] px-2.5 py-1 text-[#0F172A]")
              }
            >
              {message.text}
            </p>
          ) : null}

          <div className="rounded-xl border border-[#dfe3ea] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#151c2c]">
              {f.history}
            </h3>
            {history.length === 0 ? (
              <p className="mt-2 text-sm text-[#6b7385]">{f.historyEmpty}</p>
            ) : (
              <ul
                className="mt-2 divide-y divide-[#dfe3ea]"
                data-testid="history"
              >
                {history.map((h) => (
                  <li key={h.id} className="py-2 text-sm text-[#151c2c]">
                    <span className="font-medium">
                      {actionText[h.action]
                        ? fmt(actionText[h.action], {
                            category: inText(h.category),
                          })
                        : h.action}
                    </span>{" "}
                    <span className="text-[#6b7385]">
                      · {monthLabelEs(h.month.slice(0, 10), lang)} ·{" "}
                      {describeValue(h.old_value, view.currency, lang)} →{" "}
                      {describeValue(h.new_value, view.currency, lang)} ·{" "}
                      {sourceText[h.source] ?? h.source} ·{" "}
                      {new Date(h.created_at).toLocaleDateString(locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Desktop: side panel with the live break-even and Guardar. */}
        <aside className="hidden lg:block lg:w-[320px] lg:shrink-0 lg:sticky lg:top-[80px]">
          <div className="space-y-4 rounded-xl border border-[#dfe3ea] bg-white p-4">
            {breakEvenBlock(false)}
            {live.breakEven !== null && view.margin ? (
              <p className="text-sm text-[#6b7385]">
                {fmt(
                  live.costs.impuestosPct === null
                    ? f.openDaysNoTax
                    : f.openDays,
                  { days: view.openDays }
                )}
              </p>
            ) : null}
            {saveButton}
          </div>
        </aside>
      </div>

      {/* Phone: fixed bar at the bottom, Guardar always in view. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-[#dfe3ea] bg-white px-4 py-3 lg:hidden">
        <div className="min-w-0">{breakEvenBlock(true)}</div>
        <div className="shrink-0">{saveButton}</div>
      </div>
    </section>
  );
}
