// components/restaurant/costs/FixedCostsTab.tsx
//
// Costos › Costos fijos (Sofia's mocks, v3). One card with the five clusters
// (Planilla, Alquiler, Servicios, Otros and Impuestos as a tax rate): each is
// either its confirmed amount («Planilla $21,400 · Nómina · desde factura ·
// Editar») or «Sin dato · subir factura o escribir» with Subir / Escribir. The
// side card shows the break-even and «Total costos fijos». Everything on screen
// derives from the confirmed amounts (lib/restaurant/fixed-cost-clusters.ts):
// with nothing confirmed there is no break-even, only «Añade costos fijos…».
// Moving between months swaps the content in place (skeleton while it loads).

"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
  confirmedCount,
  figuresOf,
  itemsToShow,
  type ClusterItem,
  type ClusterMap,
  type Confirmed,
} from "@/lib/restaurant/fixed-cost-clusters";
import type {
  FixedCostHistoryItem,
  FixedCostsView,
} from "@/lib/restaurant/fixed-costs-server";
import { FixedCostUpload, type ClusterChange } from "./FixedCostUpload";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import { RENTABILIDAD_HREF } from "@/lib/restaurant/navigation";
import { historyDelta, relativeTimeText } from "@/lib/restaurant/relative-time";
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
const TOTAL_CLUSTERS = FIXED_COST_CATEGORIES.length;

const BTN =
  "inline-flex h-11 items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_LIGHT =
  "inline-flex h-11 items-center justify-center rounded-lg border border-[#c9cfdb] bg-white px-4 text-sm font-semibold text-[#151c2c] hover:bg-[#F1F3F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-50";
const TEXT_BTN =
  "inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-[#1B40C8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

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
  /** The lines an earlier upload approved per cluster, so a reload still lists them. */
  savedItems?: Partial<Record<FixedCostCategory, ClusterItem[]>>;
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
  savedItems = {},
  splitTargets = [],
}: FixedCostsTabProps) {
  const router = useRouter();
  const uploadInput = useRef<HTMLInputElement>(null);
  const { d, lang, locale, fmt } = useT();
  const f = d.costs.fixed;
  // Spanish and English write a month inside a sentence in lower case; German
  // nouns keep their capital.
  const lower = (s: string) => (lang === "de" ? s : s.toLowerCase());
  const actionText: Record<string, string> = {
    create: f.historyCreate,
    update: f.historyUpdate,
    delete: f.historyDelete,
    repeat: f.historyRepeat,
  };
  const sourceText: Record<string, string> = {
    manual: f.byHand,
    repeat: f.sourceRepeat,
    estimate: f.sourceEstimate,
    upload: f.fromInvoice,
  };
  const isGroup = view.locationId === null;

  // The ONE source of truth on screen: what is confirmed for the month.
  const [clusters, setClusters] = useState<ClusterMap>(() =>
    clustersFromLines(view.lines)
  );
  const [items, setItems] = useState<
    Partial<Record<FixedCostCategory, ClusterItem[]>>
  >({});
  const [falta, setFalta] = useState<string[]>([]);
  const onReview = useCallback(
    (info: {
      items: Partial<Record<FixedCostCategory, ClusterItem[]>>;
      falta: string[];
    }) => {
      setItems(info.items);
      setFalta(info.falta);
    },
    []
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

  // Live: pure and cheap. The total on screen is the cards plus (on a restaurant)
  // its read-only group share: exactly what the row below the cards shows.
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
  // A restaurant's part of the costs the group shares: read-only here, but part
  // of the total and the break-even. Never shown in the group view.
  const sharedTotal =
    view.locationId === null
      ? 0
      : Math.round(
          AMOUNT_CATEGORIES.reduce(
            (n, c) => n + (view.groupShares[c] ?? 0),
            0
          ) * 100
        ) / 100;
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
            repeats: c.repeats,
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

  /** Saves ONE cluster (typed on a card, or its repeat switch). Others are left as they are. */
  async function saveCluster(
    category: FixedCostCategory,
    next: { value: number; repeats: boolean; keepSource?: boolean }
  ): Promise<string | null> {
    const before = clusters;
    const prev = clusters[category];
    setClusters((cur) => ({
      ...cur,
      [category]: {
        value: next.value,
        source: next.keepSource ? (prev?.source ?? "manual") : "manual",
        label: next.keepSource ? (prev?.label ?? null) : null,
        repeats: next.repeats,
      },
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
              value: next.value,
              label: next.keepSource ? (prev?.label ?? null) : null,
              repeats: next.repeats,
              keepSource: next.keepSource === true,
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

  /** «Repartir» (group view): applied to what is already confirmed. */
  async function saveSplit(next: SplitRule) {
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
            value: (clusters[category] as Confirmed).value,
            label: clusters[category]?.label ?? null,
            repeats: clusters[category]?.repeats === true,
            keepSource: true,
            split_rule: next,
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

  const prevMonth = previousMonthStart(view.month);
  const nextMonth = nextMonthStart(view.month);
  const prevName = lower(
    getDictionary(lang).rentabilidad.months[Number(prevMonth.split("-")[1]) - 1]
  );
  const [copying, setCopying] = useState(false);
  /** «Copiar octubre»: brings last month's «se repite» costs in (idempotent). */
  async function copyPrevious() {
    setCopying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/restaurant/fixed-costs/repeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: view.month }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        created?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage({ ok: false, text: body.error ?? f.saveFailed });
      } else {
        const n = body.created ?? 0;
        setMessage({
          ok: true,
          text: n
            ? fmt(f.copied, { n, month: prevName })
            : fmt(f.copyNone, { month: prevName }),
        });
        if (n) router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: f.saveFailed });
    } finally {
      setCopying(false);
    }
  }

  // ---- month switcher: instant press feedback, skeleton while it loads -------
  const [navigating, startNav] = useTransition();
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const shownMonth = navigating && pendingMonth ? pendingMonth : view.month;
  const monthHref = (month: string) =>
    costsTabHref("costos-fijos", { ...shellParams, month: month.slice(0, 7) });
  useEffect(() => {
    // The neighbours are fetched ahead so a click feels instant.
    const r = router as { prefetch?: (href: string) => void };
    r.prefetch?.(monthHref(prevMonth));
    if (nextMonth <= currentMonth) r.prefetch?.(monthHref(nextMonth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.month]);
  function goMonth(month: string) {
    if (month > currentMonth) return;
    setPendingMonth(month);
    startNav(() => router.push(monthHref(month)));
  }

  const shownText = monthLabelEs(shownMonth, lang);
  const confirmed = confirmedCount(clusters);
  // Nothing of the restaurant's own is confirmed: the first-visit page.
  const ownEmpty = confirmed === 0 && sharedTotal === 0;
  const breakEvenText =
    live.breakEven !== null
      ? formatMoney(live.breakEven, view.currency, lang)
      : null;
  // Nothing confirmed is «—», never $0.
  const totalText =
    live.fixed.total === null
      ? "—"
      : formatMoney(live.fixed.total, view.currency, lang);
  const rentabilidadHref = (() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(shellParams)) {
      if (k === "tab" || k === "month" || v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
    }
    q.set("month", view.month.slice(0, 7));
    return `${RENTABILIDAD_HREF}?${q.toString()}`;
  })();
  const detailText = live.empty
    ? f.addCostsFirst
    : breakEvenText
      ? fmt(f.beDetail, { total: totalText, days: view.openDays })
      : (view.marginReason ?? f.reasonNoMargin);

  /** «+$650» for an amount that moved, the amount itself otherwise, the rate for a tax. */
  const historyValue = (h: FixedCostHistoryItem) => {
    if (h.new_value?.pct_of_sales != null)
      return describeValue(h.new_value, view.currency, lang);
    const delta = historyDelta(
      h.action === "create" ? 0 : (h.old_value?.amount ?? null),
      h.new_value?.amount ?? null
    );
    return delta.kind === "delta"
      ? `${delta.sign}${formatMoney(delta.abs, view.currency, lang)}`
      : describeValue(h.new_value, view.currency, lang);
  };

  const chevron =
    "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#dfe3ea] bg-white text-lg text-[#6b7385] transition-[background-color,color,transform] duration-100 hover:bg-[#F1F3F7] hover:text-[#151c2c] active:scale-95 active:bg-[#E3E7EF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";
  const futureBlocked = nextMonth > currentMonth;

  const breakEvenCard = (
    <div
      data-testid="break-even"
      className={
        "rounded-2xl border bg-white p-5 transition-colors duration-300 " +
        (flash ? "border-[#1B40C8] bg-[#E7EDFD]" : "border-[#dfe3ea]")
      }
    >
      <p className="text-sm text-[#6b7385]">
        {live.empty ? f.beIntroEmpty : f.beSell}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span
          data-testid={breakEvenText ? "break-even-value" : undefined}
          className={
            "text-3xl font-bold " +
            (breakEvenText ? "text-[#151c2c]" : "text-[#9aa3b5]")
          }
        >
          {breakEvenText ?? "—"}
        </span>
        <span className="text-base font-semibold text-[#6b7385]">
          {f.perDay}
        </span>
      </p>
      <p
        data-testid={live.empty ? "break-even-empty" : "break-even-detail"}
        className="mt-1 text-sm text-[#6b7385]"
      >
        {detailText}
      </p>
      <dl className="mt-4 space-y-1 border-t border-[#eef0f4] pt-3 text-sm text-[#151c2c]">
        <div
          data-testid="fixed-total"
          className="flex items-baseline justify-between gap-3"
        >
          <dt className="text-[#6b7385]">{f.totalLabel}</dt>
          <dd className="font-bold">{totalText}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[#6b7385]">{f.confirmedLabel}</dt>
          <dd data-testid="confirmed-count" className="font-bold">
            {fmt(f.confirmedOf, { n: confirmed, total: TOTAL_CLUSTERS })}
          </dd>
        </div>
      </dl>
      <a
        href={rentabilidadHref}
        className="mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold text-[#1B40C8] hover:underline"
      >
        {f.seeRentabilidad}
      </a>
    </div>
  );

  const skeleton = (
    <div
      data-testid="fixed-skeleton"
      role="status"
      aria-label={fmt(f.loadingMonth, { month: shownText })}
      className="animate-pulse space-y-4"
    >
      {FIXED_COST_CATEGORIES.map((c) => (
        <div key={c} className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-[#E7EAF0]" />
            <div className="h-3 w-48 rounded bg-[#EEF0F4]" />
          </div>
          <div className="h-8 w-28 rounded bg-[#E7EAF0]" />
        </div>
      ))}
    </div>
  );

  return (
    <section
      className="space-y-4 pb-24 lg:pb-0"
      aria-label={f.sectionAria}
      data-testid="fixed-costs-tab"
    >
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={f.monthGroup}
      >
        <button
          type="button"
          onClick={() => goMonth(prevMonth)}
          aria-label={f.prevMonth}
          aria-busy={navigating || undefined}
          className={chevron}
        >
          ‹
        </button>
        <span
          className="min-w-[10rem] text-center text-base font-semibold text-[#151c2c]"
          data-testid="fixed-costs-month"
        >
          {shownText.charAt(0).toUpperCase() + shownText.slice(1)}
        </span>
        <span
          title={futureBlocked ? f.futureMonth : undefined}
          className="inline-flex"
        >
          <button
            type="button"
            onClick={() => goMonth(nextMonth)}
            aria-label={f.nextMonth}
            aria-disabled={futureBlocked || undefined}
            aria-busy={navigating || undefined}
            className={
              chevron +
              (futureBlocked
                ? " cursor-not-allowed opacity-40 hover:bg-white hover:text-[#6b7385] active:scale-100 active:bg-white"
                : "")
            }
          >
            ›
          </button>
        </span>
      </div>

      <div className="lg:flex lg:items-start lg:gap-6">
        <div className="min-w-0 lg:flex-1">
          <div className="space-y-4 rounded-2xl border border-[#dfe3ea] bg-white p-4 sm:p-5">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#6b7385]">
                {isGroup ? f.groupTitle : (locationName ?? f.restaurant)}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-lg font-bold text-[#151c2c]">
                  {fmt(f.cardTitle, { month: lower(shownText) })}
                </h2>
                {!navigating && confirmed > 0 ? (
                  <span
                    data-testid="confirmed-pill"
                    className="rounded-full bg-[#A7F3D0] px-2.5 py-0.5 text-xs font-semibold text-[#0F172A]"
                  >
                    {fmt(f.confirmedPill, {
                      n: confirmed,
                      total: TOTAL_CLUSTERS,
                    })}
                  </span>
                ) : null}
                {!navigating && falta.length > 0 ? (
                  <span
                    data-testid="falta-pill"
                    className="rounded-full bg-[#FDE68A] px-2.5 py-0.5 text-xs font-semibold text-[#0F172A]"
                  >
                    <span aria-hidden="true">{FLAG}</span>{" "}
                    {fmt(f.faltaPill, { names: falta.join(", ") })}
                  </span>
                ) : null}
                {!navigating && !ownEmpty ? (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => uploadInput.current?.click()}
                      className={BTN_LIGHT}
                    >
                      {d.costs.fixedUpload.button}
                    </button>
                    <button
                      type="button"
                      disabled={copying}
                      onClick={() => void copyPrevious()}
                      className={BTN_LIGHT}
                    >
                      {fmt(f.copyMonth, { month: prevName })}
                    </button>
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-[#6b7385]">
                {ownEmpty ? f.cardSubEmpty : f.cardSubFilled}
              </p>
              {isGroup ? (
                <p className="text-sm text-[#6b7385]">{f.groupHint}</p>
              ) : null}
            </div>

            <FixedCostUpload
              inputRef={uploadInput}
              lastMonth={view.lastMonth ?? {}}
              clusters={clusters}
              showDrop={!navigating && ownEmpty}
              onReview={onReview}
              onConfirm={applyChanges}
              onSettled={settle}
              month={view.month}
              locationId={view.locationId}
              currency={view.currency}
              restaurants={restaurants}
            />

            {message ? (
              <p
                role="status"
                className="inline-block rounded-lg border border-[#1B40C8] bg-[#E7EDFD] px-2.5 py-1 text-sm font-medium text-[#0F172A]"
              >
                {message.text}
              </p>
            ) : null}

            {navigating ? (
              skeleton
            ) : (
              <div className="divide-y divide-[#eef0f4]">
                {FIXED_COST_CATEGORIES.map((category) => (
                  <ClusterRow
                    key={category}
                    category={category}
                    confirmed={clusters[category] ?? null}
                    items={itemsToShow(
                      items[category]?.length
                        ? items[category]
                        : savedItems[category],
                      clusters[category]
                    )}
                    currency={view.currency}
                    flashing={flash?.includes(category) ?? false}
                    onUpload={() => uploadInput.current?.click()}
                    onSave={(value) =>
                      saveCluster(category, {
                        value,
                        repeats: clusters[category]?.repeats === true,
                      })
                    }
                    onRepeat={(repeats) =>
                      saveCluster(category, {
                        value: (clusters[category] as Confirmed).value,
                        repeats,
                        keepSource: true,
                      })
                    }
                  />
                ))}
                {sharedTotal > 0 ? (
                  <div data-testid="fixed-shared-row" className="py-4">
                    <p className="text-sm font-semibold text-[#151c2c]">
                      {fmt(f.sharedRow, {
                        amount: formatMoney(sharedTotal, view.currency, lang),
                      })}
                    </p>
                    <p className="text-sm text-[#6b7385]">{f.sharedSub}</p>
                  </div>
                ) : null}
              </div>
            )}

            {isGroup && !navigating ? (
              <div className="space-y-2 border-t border-[#eef0f4] pt-3">
                <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#151c2c]">
                  {f.split}
                  <select
                    value={splitRule}
                    onChange={(e) => {
                      setSplitRule(e.target.value as SplitRule);
                      void saveSplit(e.target.value as SplitRule);
                    }}
                    className="h-11 rounded-lg border border-[#c9cfdb] bg-white px-3 text-sm"
                  >
                    <option value="sales">{f.splitSales}</option>
                    <option value="equal">{f.splitEqual}</option>
                  </select>
                </label>
                {splitPreview.kind !== "single" ? (
                  <div className="text-xs text-[#6b7385]">
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
            ) : null}
          </div>
        </div>

        <aside className="mt-4 hidden space-y-4 lg:mt-0 lg:block lg:w-[330px] lg:shrink-0 lg:sticky lg:top-[80px]">
          {navigating ? (
            <div
              data-testid="fixed-skeleton-aside"
              className="h-56 animate-pulse rounded-2xl border border-[#dfe3ea] bg-[#F5F6F9]"
            />
          ) : (
            breakEvenCard
          )}
          <div className="rounded-2xl border border-[#dfe3ea] bg-white p-5">
            <h3 className="text-sm font-bold text-[#151c2c]">{f.history}</h3>
            {navigating ? (
              <div className="mt-3 h-16 animate-pulse rounded bg-[#F5F6F9]" />
            ) : history.length === 0 ? (
              <p className="mt-2 text-sm text-[#6b7385]">{f.historyEmpty}</p>
            ) : (
              <ul
                className="mt-2 divide-y divide-[#eef0f4]"
                data-testid="history"
              >
                {history.map((h) => (
                  <li key={h.id} className="py-2 text-sm text-[#151c2c]">
                    <span className="font-semibold">
                      {h.action === "delete" || h.action === "repeat"
                        ? fmt(actionText[h.action], {
                            category: categoryLabel(h.category, lang),
                          })
                        : fmt(f.historyLine, {
                            category: categoryLabel(h.category, lang),
                            value: historyValue(h),
                            source: sourceText[h.source] ?? h.source,
                          })}
                    </span>
                    <span className="block text-xs text-[#6b7385]">
                      {relativeTimeText(h.created_at, Date.now(), locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Phone: the break-even stays in view at the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dfe3ea] bg-white px-4 py-3 lg:hidden">
        {navigating ? (
          <div className="h-10 animate-pulse rounded bg-[#F5F6F9]" />
        ) : (
          <div
            data-testid="break-even"
            className={
              "rounded-lg transition-colors duration-300 " +
              (flash ? "bg-[#E7EDFD] ring-2 ring-[#1B40C8]" : "")
            }
          >
            <p className="flex items-baseline gap-2">
              <span className="text-sm text-[#6b7385]">
                {live.empty ? f.beIntroEmpty : f.beSell}
              </span>
              <span
                data-testid={breakEvenText ? "break-even-value" : undefined}
                className="text-lg font-bold text-[#151c2c]"
              >
                {breakEvenText ?? "—"}
              </span>
              <span className="text-sm font-semibold text-[#6b7385]">
                {f.perDay}
              </span>
            </p>
            {live.empty ? (
              <p className="text-xs text-[#6b7385]">{f.addCostsFirst}</p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One cluster. Confirmed → title left, amount right, «{concepto} · desde
 * factura» or «escrito a mano», «Editar» and «Se repite cada mes». Several lines
 * (Servicios) are listed under it. Not confirmed → «Sin dato · subir factura o
 * escribir» with Subir / Escribir, no amount, no second field.
 */
function ClusterRow({
  category,
  confirmed,
  items,
  currency,
  flashing,
  onUpload,
  onSave,
  onRepeat,
}: {
  category: FixedCostCategory;
  confirmed: Confirmed | null;
  items: ClusterItem[];
  currency: string;
  flashing: boolean;
  onUpload: () => void;
  /** Resolve to an error message, or null when it saved. */
  onSave: (value: number) => Promise<string | null>;
  onRepeat: (repeats: boolean) => Promise<string | null>;
}) {
  const { d, lang, fmt } = useT();
  const f = d.costs.fixed;
  const isTax = category === "impuestos";
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLocaleNumber(text, lang);
  const valid = text.trim() !== "" && parsed.ok && parsed.value !== null;
  const id = `fixed-${category}`;
  const label = categoryLabel(category, lang);
  const subline =
    confirmed?.source === "upload"
      ? confirmed.label
        ? fmt(f.fromConcept, { concept: confirmed.label })
        : f.fromInvoice
      : confirmed?.source === "repeat"
        ? f.sourceRepeat
        : confirmed?.source === "estimate"
          ? f.sourceEstimate
          : f.byHand;

  async function commit() {
    if (!valid || parsed.value === null) return;
    setSaving(true);
    setError(null);
    const err = await onSave(parsed.value);
    setSaving(false);
    if (err) setError(err);
    else {
      setWriting(false);
      setText("");
    }
  }

  const field = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <div className="flex items-center gap-1">
        {!isTax ? (
          <span className="text-sm text-[#6b7385]" aria-hidden="true">
            {currency === "MXN" || currency === "USD" ? "$" : currency}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          aria-label={fmt(isTax ? f.cardRate : f.cardAmount, {
            category: label,
          })}
          aria-invalid={(text.trim() !== "" && !parsed.ok) || undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setWriting(false);
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
        className={BTN}
      >
        {saving ? f.saving : f.cardSave}
      </button>
      <button
        type="button"
        onClick={() => {
          setWriting(false);
          setError(null);
        }}
        className={TEXT_BTN}
      >
        {f.cardCancel}
      </button>
    </div>
  );

  return (
    <div
      className={
        "flex flex-wrap items-start gap-x-4 gap-y-2 py-4 transition-colors duration-300 " +
        (flashing ? "rounded-lg bg-[#E7EDFD]" : "")
      }
      data-testid={`fixed-row-${category}`}
      data-state={confirmed ? "confirmed" : "empty"}
    >
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-semibold text-[#151c2c]">{label}</p>
        <p className="text-sm text-[#6b7385]">
          {confirmed ? subline : f.emptyBody}
        </p>
        {isTax && confirmed ? (
          <>
            <p className="mt-1 text-xs text-[#6b7385]">
              {fmt(f.taxIncluded, {
                rate: String(confirmed.value),
                sum: String(Math.round((100 + confirmed.value) * 100) / 100),
              })}
            </p>
            <p className="text-xs text-[#6b7385]">{f.taxNotFixed}</p>
          </>
        ) : null}
      </div>

      {confirmed && !writing ? (
        <div
          data-testid={`fixed-value-${category}`}
          className="flex flex-wrap items-center justify-end gap-x-3"
        >
          <p className="text-lg font-bold text-[#151c2c]">
            {isTax
              ? `${confirmed.value} %`
              : formatMoney(confirmed.value, currency, lang)}
          </p>
          <button
            type="button"
            onClick={() => {
              setText(formatTypedNumber(confirmed.value, lang));
              setWriting(true);
            }}
            aria-label={`${f.edit} ${label}`}
            className={TEXT_BTN}
          >
            {f.edit}
          </button>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-[#6b7385]">
            {f.repeatsRow}
            <input
              type="checkbox"
              role="switch"
              checked={confirmed.repeats === true}
              aria-label={`${f.repeatsRow}: ${label}`}
              onChange={(e) => {
                void onRepeat(e.target.checked).then((err) =>
                  err ? setError(err) : null
                );
              }}
              className="h-5 w-9 accent-[#1B40C8]"
            />
          </label>
        </div>
      ) : null}

      {!confirmed && !writing ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onUpload} className={TEXT_BTN}>
            {f.upload}
          </button>
          <button
            type="button"
            onClick={() => setWriting(true)}
            aria-label={`${f.write} ${label}`}
            className={BTN_LIGHT}
          >
            {f.write}
          </button>
        </div>
      ) : null}

      {writing ? field : null}

      {items.length > 0 && !writing ? (
        <ul
          data-testid={`fixed-items-${category}`}
          className="w-full space-y-1 rounded-lg bg-[#F7F8FB] px-4 py-2"
        >
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-baseline justify-between gap-3 text-sm text-[#151c2c]"
            >
              <span className="min-w-0 break-words">{i.raw || "—"}</span>
              <span className="flex shrink-0 items-baseline gap-4">
                <span className="text-xs text-[#6b7385]">{f.fromInvoice}</span>
                <span className="font-semibold">
                  {formatMoney(i.amount, currency, lang)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {text.trim() !== "" && !parsed.ok && writing ? (
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
