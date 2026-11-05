// components/restaurant/costs/FixedCostsTab.tsx
//
// Costos › Costos fijos. One simple page: each cluster (Planilla, Alquiler,
// Servicios, Otros and Impuestos as a tax rate) is a card that shows either its
// confirmed amount for the month («Planilla $21,400 · desde factura · Editar»)
// or ONE field with «Sin dato · subir factura o escribir». Never both. The
// «Costos fijos» total and the break-even are derived from the confirmed
// amounts only (lib/restaurant/fixed-cost-clusters.ts), so approving an
// uploaded line, typing an amount or editing a card all move the same numbers.
// With nothing confirmed there is no break-even, only «Añade costos fijos…».

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  AMOUNT_CATEGORIES,
  categoryLabel,
  FIXED_COST_CATEGORIES,
  previewGroupSplit,
  nextMonthStart,
  previousMonthStart,
  type FixedCostCategory,
  type SplitRule,
} from "@/lib/restaurant/fixed-costs";
import {
  clustersFromLines,
  figuresOf,
  type ClusterMap,
} from "@/lib/restaurant/fixed-cost-clusters";
import type {
  FixedCostHistoryItem,
  FixedCostsView,
} from "@/lib/restaurant/fixed-costs-server";
import { FixedCostUpload, type ClusterChange } from "./FixedCostUpload";
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
  /** The company's restaurants (the review list asks «¿A qué restaurante?»). */
  restaurants?: Array<{ id: string; name: string }>;
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
  restaurants = [],
  splitTargets = [],
}: FixedCostsTabProps) {
  const router = useRouter();
  const uploadInput = useRef<HTMLInputElement>(null);
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

  // The ONE source of truth on screen: what is confirmed for the month.
  const [clusters, setClusters] = useState<ClusterMap>(() =>
    clustersFromLines(view.lines)
  );
  const [flash, setFlash] = useState<FixedCostCategory[] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Live: pure and cheap, derived from the confirmed amounts only.
  const live = useMemo(
    () =>
      figuresOf({
        clusters,
        groupShares: view.groupShares,
        groupImpuestosPct: view.groupImpuestosPct,
        margin: view.margin,
        openDays: view.openDays,
      }),
    [
      clusters,
      view.groupShares,
      view.groupImpuestosPct,
      view.margin,
      view.openDays,
    ]
  );
  const splitPreview = useMemo(
    () =>
      previewGroupSplit(
        AMOUNT_CATEGORIES.map((c) => clusters[c]?.value ?? null),
        splitRule,
        splitTargets
      ),
    [clusters, splitRule, splitTargets]
  );

  // The page re-reads the month after a change (quietly): take what the server
  // now says.
  const [seenLines, setSeenLines] = useState(view.lines);
  if (seenLines !== view.lines) {
    setSeenLines(view.lines);
    setClusters(clustersFromLines(view.lines));
  }

  function highlight(cats: FixedCostCategory[]) {
    setFlash(cats);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  /** Approve / undo from the review list: the cards follow at once. */
  function applyChanges(changes: ClusterChange[]) {
    if (changes.length === 0) return;
    setClusters((cur) => {
      const next = { ...cur };
      for (const c of changes) {
        if (c.total === null) delete next[c.category];
        else
          next[c.category] = {
            value: c.total,
            source: c.source,
            label: c.label,
          };
      }
      return next;
    });
    highlight(changes.map((c) => c.category));
  }

  function settle() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 2500);
  }

  /** Saves ONE cluster (typed on a card). Others are left exactly as they are. */
  async function saveCluster(
    category: FixedCostCategory,
    value: number
  ): Promise<string | null> {
    const before = clusters;
    setClusters((cur) => ({
      ...cur,
      [category]: { value, source: "manual", label: null },
    }));
    highlight([category]);
    try {
      const res = await fetch("/api/restaurant/fixed-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: view.month,
          location_id: view.locationId,
          entries: [
            {
              category,
              value,
              repeats,
              split_rule: isGroup ? splitRule : null,
            },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setClusters(before);
        return body.error ?? f.saveFailed;
      }
      settle();
      return null;
    } catch {
      setClusters(before);
      return f.saveFailed;
    }
  }

  /** «Repetir cada mes» / «Repartir»: applied to what is already confirmed. */
  async function saveOptions(next: { repeats: boolean; split: SplitRule }) {
    const cats = FIXED_COST_CATEGORIES.filter((c) => clusters[c]);
    if (cats.length === 0) return;
    setMessage(null);
    try {
      const res = await fetch("/api/restaurant/fixed-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: view.month,
          location_id: view.locationId,
          entries: cats.map((category) => ({
            category,
            value: (clusters[category] as { value: number }).value,
            label: clusters[category]?.label ?? null,
            repeats: next.repeats,
            split_rule: isGroup ? next.split : null,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMessage({ ok: false, text: body.error ?? f.saveFailed });
      else settle();
    } catch {
      setMessage({ ok: false, text: f.saveFailed });
    }
  }

  function goMonth(month: string) {
    const params: Record<string, string | string[] | undefined> = {
      ...shellParams,
      month: month.slice(0, 7),
    };
    router.push(costsTabHref("costos-fijos", params));
  }

  const breakEvenText =
    live.breakEven !== null
      ? formatMoney(live.breakEven, view.currency, lang)
      : null;
  const partialNote =
    live.partial && live.missingAmounts.length > 0
      ? fmt(f.partialBreakEven, {
          list: live.missingAmounts.map(inText).join(", "),
        })
      : null;
  const flagReason = live.empty
    ? f.addCostsFirst
    : view.marginReason
      ? view.marginReason
      : live.missingAmounts.length > 0
        ? fmt(f.reasonMissing, {
            list: live.missingAmounts.map(inText).join(", "),
          })
        : f.reasonNoMargin;

  const breakEvenBlock = (compact: boolean) => (
    <div
      data-testid="break-even"
      className={
        "rounded-lg transition-colors duration-300 " +
        (flash ? "bg-[#E7EDFD] ring-2 ring-[#1B40C8]" : "")
      }
    >
      <p className="text-sm font-medium text-[#6b7385]">{f.breakEven}</p>
      {breakEvenText ? (
        <>
          <p className="text-base font-semibold text-[#151c2c]">
            {f.needSellBefore}{" "}
            <span className="text-[#1B40C8]" data-testid="break-even-value">
              {breakEvenText}
            </span>{" "}
            {f.needSellAfter}
          </p>
          {partialNote && !compact ? (
            <p className="mt-1 text-sm text-[#6b7385]">
              <span aria-hidden="true">{FLAG}</span> {partialNote}
            </p>
          ) : null}
        </>
      ) : live.empty ? (
        <p
          data-testid="break-even-empty"
          className="text-base font-semibold text-[#151c2c]"
        >
          {f.addCostsFirst}
        </p>
      ) : (
        <>
          <p className="text-base font-semibold text-[#151c2c]">
            <span aria-hidden="true">{FLAG}</span> {f.missing}
            <span className="sr-only">{f.missingDataSr}</span>
          </p>
          {!compact ? (
            <p className="mt-1 text-sm text-[#6b7385]">{flagReason}</p>
          ) : null}
        </>
      )}
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
          <FixedCostUpload
            inputRef={uploadInput}
            lastMonth={view.lastMonth ?? {}}
            clusters={clusters}
            onConfirm={applyChanges}
            onSettled={settle}
            month={view.month}
            locationId={view.locationId}
            currency={view.currency}
            restaurants={restaurants}
          />

          {live.empty ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1B40C8] bg-[#E7EDFD] p-4"
              data-testid="falta-cta"
            >
              <p className="text-sm font-medium text-[#151c2c]">
                <span aria-hidden="true">{FLAG}</span> {f.missingCta}
              </p>
              <button
                type="button"
                onClick={() => uploadInput.current?.click()}
                className="inline-flex h-11 items-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
              >
                {f.uploadFixed}
              </button>
            </div>
          ) : null}

          <p
            data-testid="fixed-total"
            className={
              "flex flex-wrap items-baseline justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-semibold text-[#151c2c] transition-colors duration-300 " +
              (flash
                ? "border-[#1B40C8] bg-[#E7EDFD]"
                : "border-[#dfe3ea] bg-white")
            }
          >
            <span>{f.totalFixed}</span>
            <span>
              {live.fixed.total !== null
                ? formatMoney(live.fixed.total, view.currency, lang)
                : "—"}
              {live.fixed.missingCount > 0 ? (
                <span className="ml-2 rounded-full bg-[#FDE68A] px-2 py-0.5 text-xs font-semibold">
                  <span aria-hidden="true">{FLAG}</span>{" "}
                  {fmt(f.totalMissing, { n: live.fixed.missingCount })}
                </span>
              ) : null}
            </span>
          </p>

          <div className="divide-y divide-[#dfe3ea] rounded-xl border border-[#dfe3ea] bg-white">
            {FIXED_COST_CATEGORIES.map((category) => (
              <ClusterCard
                key={category}
                category={category}
                confirmed={clusters[category] ?? null}
                share={
                  category === "impuestos"
                    ? null
                    : (view.groupShares[
                        category as (typeof AMOUNT_CATEGORIES)[number]
                      ] ?? null)
                }
                currency={view.currency}
                flashing={flash?.includes(category) ?? false}
                onUpload={() => uploadInput.current?.click()}
                onSave={(value) => saveCluster(category, value)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-[#dfe3ea] bg-white p-4">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-medium text-[#151c2c]">
              <input
                type="checkbox"
                role="switch"
                checked={repeats}
                onChange={(e) => {
                  setRepeats(e.target.checked);
                  void saveOptions({
                    repeats: e.target.checked,
                    split: splitRule,
                  });
                }}
                className="h-5 w-5 accent-[#1B40C8]"
              />
              {f.repeatMonthly}
            </label>
            {isGroup ? (
              <label className="flex items-center gap-2 text-sm font-medium text-[#151c2c]">
                {f.split}
                <select
                  value={splitRule}
                  onChange={(e) => {
                    setSplitRule(e.target.value as SplitRule);
                    void saveOptions({
                      repeats,
                      split: e.target.value as SplitRule,
                    });
                  }}
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
              className="inline-block rounded-lg border border-[#1B40C8] bg-[#E7EDFD] px-2.5 py-1 text-sm font-medium text-[#0F172A]"
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

        {/* Desktop: side panel with the live break-even. */}
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
          </div>
        </aside>
      </div>

      {/* Phone: fixed bar at the bottom, the break-even always in view. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dfe3ea] bg-white px-4 py-3 lg:hidden">
        {breakEvenBlock(true)}
      </div>
    </section>
  );
}

/**
 * One cluster. Confirmed → the amount, where it came from and «Editar» (inline).
 * Not confirmed → ONE field: «Sin dato · subir factura o escribir». Never both.
 */
function ClusterCard({
  category,
  confirmed,
  share,
  currency,
  flashing,
  onUpload,
  onSave,
}: {
  category: FixedCostCategory;
  confirmed: { value: number; source: string | null } | null;
  share: number | null;
  currency: string;
  flashing: boolean;
  onUpload: () => void;
  /** Resolves to an error message, or null when it saved. */
  onSave: (value: number) => Promise<string | null>;
}) {
  const { d, lang, fmt } = useT();
  const f = d.costs.fixed;
  const isTax = category === "impuestos";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLocaleNumber(text, lang);
  const valid = text.trim() !== "" && parsed.ok && parsed.value !== null;
  const showField = confirmed === null || editing;
  const id = `fixed-${category}`;
  const label = categoryLabel(category, lang);
  const from =
    confirmed?.source === "upload"
      ? f.fromInvoice
      : confirmed?.source === "repeat"
        ? f.fromRepeat
        : confirmed?.source === "estimate"
          ? f.fromEstimate
          : f.byHand;

  async function commit() {
    if (!valid || parsed.value === null) return;
    setSaving(true);
    setError(null);
    const err = await onSave(parsed.value);
    setSaving(false);
    if (err) setError(err);
    else {
      setEditing(false);
      setText("");
    }
  }

  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors duration-300 " +
        (flashing ? "bg-[#E7EDFD]" : "")
      }
      data-testid={`fixed-row-${category}`}
      data-state={confirmed ? "confirmed" : "empty"}
    >
      <div className="min-w-0 flex-1 basis-32">
        <label htmlFor={id} className="text-sm font-semibold text-[#151c2c]">
          {label}
        </label>
        {isTax ? (
          <p className="text-sm text-[#6b7385]">{f.taxHint}</p>
        ) : share !== null ? (
          <p className="text-sm text-[#6b7385]">
            {fmt(f.groupShare, { amount: formatMoney(share, currency, lang) })}
          </p>
        ) : null}
      </div>

      {confirmed && !editing ? (
        <div className="text-right" data-testid={`fixed-value-${category}`}>
          <p id={id} className="text-base font-semibold text-[#151c2c]">
            {isTax
              ? `${confirmed.value}%`
              : formatMoney(confirmed.value, currency, lang)}
          </p>
          <p className="text-xs text-[#6b7385]">
            {from} ·{" "}
            <button
              type="button"
              onClick={() => {
                setText(formatTypedNumber(confirmed.value, lang));
                setEditing(true);
              }}
              aria-label={`${f.edit} ${label}`}
              className="inline-flex min-h-[44px] items-center px-1 font-semibold text-[#1B40C8] underline"
            >
              {f.edit}
            </button>
          </p>
        </div>
      ) : null}

      {showField ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {confirmed === null ? (
            <p className="mr-auto text-sm text-[#6b7385] sm:mr-0">
              {f.noDataLead}{" "}
              <button
                type="button"
                onClick={onUpload}
                className="font-semibold text-[#1B40C8] underline"
              >
                {f.uploadLink}
              </button>{" "}
              {f.orType}
            </p>
          ) : null}
          <div className="flex items-center gap-1">
            {!isTax ? (
              <span className="text-sm text-[#6b7385]" aria-hidden="true">
                {currency === "MXN" || currency === "USD" ? "$" : currency}
              </span>
            ) : null}
            <input
              id={confirmed === null ? id : `${id}-edit`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              aria-label={fmt(isTax ? f.cardRate : f.cardAmount, {
                category: label,
              })}
              aria-invalid={(text.trim() !== "" && !parsed.ok) || undefined}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
              }}
              placeholder={isTax ? "0" : "0.00"}
              className="h-11 w-32 rounded-lg border border-[#c9cfdb] bg-white px-3 text-right text-sm text-[#151c2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
            />
            {isTax ? (
              <span className="text-sm text-[#6b7385]" aria-hidden="true">
                %
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!valid || saving}
            aria-label={`${f.cardSave} ${label}`}
            onClick={() => void commit()}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? f.saving : f.cardSave}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#1B40C8] underline"
            >
              {f.cardCancel}
            </button>
          ) : null}
        </div>
      ) : null}

      {text.trim() !== "" && !parsed.ok && showField ? (
        <p role="alert" className="w-full text-right text-sm text-[#151c2c]">
          <span aria-hidden="true">{FLAG}</span> {f.invalidNumber}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-right text-sm text-[#151c2c]">
          <span aria-hidden="true">{FLAG}</span> {error}
        </p>
      ) : null}
    </div>
  );
}
