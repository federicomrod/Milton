"use client";

// components/restaurant/costs/FixedCostUpload.tsx
//
// #409 · «⇪ Subir archivo» in Costos fijos. A file (Excel/CSV, PDF or photo) is
// read into DRAFT lines that change nothing until approved. The review is
// inline: fix the category or amount of a line, approve all or one by one, or
// discard. A line Milton could not fully read keeps a ⚑ Falta tag (never
// dropped, never $0); a missing amount reads «Sin precio». Lines read by AI
// carry the lavender tag. Replacing a value that is already in the month asks
// first (old → new), inline (no pop-up).
//
// Inline approval: no reload and no modal. ✓ Aprobar updates the list and the
// cluster totals at once (optimistic), saves in the background and rolls back
// with a message if the save fails; «Deshacer» (~5 s) puts the cluster back.
// An approved line moves into «Aprobadas (n)» under its cluster, not away.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/lib/i18n/client";
import { FIXED_UPLOAD_PARAM } from "@/lib/restaurant/costs-tabs";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  FIXED_COST_CATEGORIES,
  categoryLabel,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";
import {
  bulkApprovable,
  changeVsLastMonth,
  clusterTotalAfter,
  duplicateTaxIds,
  inlineReview,
  isApprovable,
  issuesOf,
  type DraftLine,
  type OverwriteConflict,
} from "@/lib/restaurant/fixed-cost-upload";
import {
  formatTypedNumber,
  parseLocaleNumber,
} from "@/lib/restaurant/locale-number";

const ALERT_PILL =
  "inline-block rounded-full bg-[#FDE68A] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]";
const AI_PILL =
  "inline-block rounded-full bg-[#DDD6FE] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]";
const BTN =
  "inline-flex min-h-[40px] items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const LINK =
  "text-sm font-semibold text-[#1B40C8] underline disabled:opacity-60";
const FIELD =
  "h-10 min-w-0 rounded-lg border border-[#c9cfdb] bg-white px-2 text-sm text-[#151c2c]";

interface Draft {
  id: string;
  fileName: string | null;
  lines: DraftLine[];
  status: string;
}

/** What the page's cluster fields should show after an approval or an undo. */
export interface ClusterChange {
  category: FixedCostCategory;
  /** null = the cluster has no value again. */
  total: number | null;
  /** true: the total is the sum of this upload's approved lines. */
  fromLines: boolean;
}

interface AppliedRow {
  category: FixedCostCategory;
  month: string;
  locationId: string | null;
  total: number;
  previous: {
    amount: number | null;
    pct_of_sales: number | null;
    label: string | null;
    source: string | null;
  } | null;
  lineIds: string[];
}

interface Toast {
  text: string;
  applied: AppliedRow[] | null;
  undoable: boolean;
}

const TOAST_MS = 5000;

export function FixedCostUpload({
  month,
  locationId,
  currency,
  locationNames,
  inputRef,
  lastMonth = {},
  currentTotals = {},
  onTotals,
  onSettled,
}: {
  /** The month on screen (YYYY-MM-01): the default for lines without one. */
  month: string;
  /** null = the group's shared costs. */
  locationId: string | null;
  currency: string;
  /** id → name, to say where a line goes. */
  locationNames: Record<string, string>;
  /** The file input, so the page's «Sube tus costos fijos» opens this same picker. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Last month's value per cluster, for the small grey text and the ±20% tag. */
  lastMonth?: Partial<Record<FixedCostCategory, number>>;
  /** What each cluster holds on screen now (null/absent = nothing). */
  currentTotals?: Partial<Record<FixedCostCategory, number | null>>;
  /** Called at once on approve/undo so the page recalculates live. */
  onTotals?: (changes: ClusterChange[]) => void;
  /** Called a moment after the last change: the page may refresh quietly. */
  onSettled?: () => void;
}) {
  const { d, lang, locale, fmt } = useT();
  const t = d.costs.fixedUpload;
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OverwriteConflict[]>([]);
  const [pending, setPending] = useState<string[] | undefined>(undefined);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/restaurant/fixed-costs/upload")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.draft) setDraft(j.draft as Draft);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ?subir=1 (from Rentabilidad): open the picker once, then take the param
  // out of the URL (other params stay) so a reload does not reopen it.
  const consumedPicker = useRef(false);
  useEffect(() => {
    if (consumedPicker.current) return;
    consumedPicker.current = true;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.get(FIXED_UPLOAD_PARAM)) return;
      url.searchParams.delete(FIXED_UPLOAD_PARAM);
      const query = url.searchParams.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${query ? `?${query}` : ""}${url.hash}`
      );
      input.current?.click();
    } catch {
      // no URL to read (tests / odd embeds): nothing to open
    }
  }, [input]);

  function showToast(next: Toast, ms = TOAST_MS) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  async function call(
    url: string,
    init: RequestInit,
    spin = true
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (spin) setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return { status: res.status, body };
    } catch {
      return { status: 0, body: { error: t.errSave } };
    } finally {
      if (spin) setBusy(false);
    }
  }

  async function upload(file: File) {
    setNote(null);
    setConflicts([]);
    setToast(null);
    const form = new FormData();
    form.set("file", file);
    form.set("month", month);
    form.set("location_id", locationId ?? "");
    const { status, body } = await call("/api/restaurant/fixed-costs/upload", {
      method: "POST",
      body: form,
    });
    if (status === 200 && body.draft) setDraft(body.draft as Draft);
    else setError(String(body.error ?? t.errSave));
    if (input.current) input.current.value = "";
  }

  /** Edits and skips: applied on screen first, put back if the save fails. */
  async function patch(
    payload: Record<string, unknown>,
    local: (lines: DraftLine[]) => DraftLine[]
  ) {
    if (!draft) return;
    const before = draft;
    setDraft({ ...draft, lines: local(draft.lines) });
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, ...payload }),
      },
      false
    );
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
    } else {
      setDraft(before);
      setError(t.rollback);
    }
  }

  const isHere = (l: DraftLine) =>
    l.month === month &&
    (locationId
      ? l.scope?.kind === "restaurant" && l.scope.locationId === locationId
      : l.scope?.kind === "group");

  const money = (c: FixedCostCategory, n: number) =>
    c === "impuestos" ? `${n}%` : formatMoney(n, currency, lang);

  /** A cluster whose value on screen is nothing, or only this upload's own lines. */
  function safeCluster(c: FixedCostCategory, all: DraftLine[]): boolean {
    const now = currentTotals[c];
    if (now === null || now === undefined || now === 0) return true;
    if (c === "impuestos") return false;
    const mine = all
      .filter((l) => l.status === "approved" && l.category === c && isHere(l))
      .reduce((sum, l) => sum + (l.amount ?? 0), 0);
    return Math.round(mine * 100) === Math.round(now * 100);
  }

  async function approve(lineIds?: string[], confirmed?: string[]) {
    if (!draft) return;
    setNote(null);
    const before = draft;
    const wanted = lineIds ? new Set(lineIds) : null;
    const dup = duplicateTaxIds(
      draft.lines.filter((l) => l.status === "pending")
    );
    const ready = draft.lines.filter(
      (l) => isApprovable(l) && !dup.has(l.id) && (!wanted || wanted.has(l.id))
    );
    if (ready.length === 0) return;

    const cats = [
      ...new Set(ready.map((l) => l.category as FixedCostCategory)),
    ];
    const optimistic =
      !confirmed &&
      ready.every(isHere) &&
      cats.every((c) => safeCluster(c, draft.lines));

    if (optimistic) {
      const ids = new Set(ready.map((l) => l.id));
      setDraft({
        ...draft,
        lines: draft.lines.map((l) =>
          ids.has(l.id) ? { ...l, status: "approved" as const } : l
        ),
      });
      onTotals?.(
        cats.map((c) => ({
          category: c,
          total: clusterTotalAfter(
            c,
            currentTotals[c] ?? null,
            ready.filter((l) => l.category === c)
          ),
          fromLines: true,
        }))
      );
      const one = ready.length === 1 ? ready[0] : null;
      showToast({
        text: one
          ? fmt(t.toastApproved, {
              concept: one.raw || "—",
              amount: money(one.category as FixedCostCategory, one.amount ?? 0),
              category: categoryLabel(one.category as FixedCostCategory, lang),
            })
          : fmt(t.toastApprovedMany, {
              n: ready.length,
              categories: cats.map((c) => categoryLabel(c, lang)).join(", "),
            }),
        applied: null,
        undoable: false,
      });
    }

    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          lineIds: lineIds ?? ready.map((l) => l.id),
          confirmed,
        }),
      },
      !optimistic
    );

    const rollback = (message: string | null) => {
      setDraft(before);
      if (optimistic) {
        onTotals?.(
          cats.map((c) => ({
            category: c,
            total: currentTotals[c] ?? null,
            fromLines: false,
          }))
        );
        setToast(null);
      }
      if (message) setError(message);
    };

    if (status === 409 && Array.isArray(body.conflicts)) {
      rollback(null);
      setConflicts(body.conflicts as OverwriteConflict[]);
      setPending(lineIds);
      return;
    }
    if (status === 200 && body.draft) {
      const next = body.draft as Draft;
      const applied = (
        Array.isArray(body.applied) ? body.applied : []
      ) as AppliedRow[];
      setConflicts([]);
      // Keep showing the draft even when everything is approved: the lines move
      // into «Aprobadas», they do not disappear.
      setDraft(next);
      onTotals?.(
        applied
          .filter(
            (a) =>
              a.month === month &&
              (a.locationId ?? null) === (locationId ?? null)
          )
          .map((a) => ({
            category: a.category,
            total: a.total,
            fromLines: true,
          }))
      );
      if (!optimistic && applied.length) {
        const first = applied[0];
        showToast({
          text: fmt(t.toastApprovedMany, {
            n: applied.reduce((n, a) => n + a.lineIds.length, 0),
            categories: [...new Set(applied.map((a) => a.category))]
              .map((c) => categoryLabel(c, lang))
              .join(", "),
          }),
          applied,
          undoable: !!first,
        });
      } else if (applied.length) {
        setToast((cur) => (cur ? { ...cur, applied, undoable: true } : cur));
      }
      if (!applied.length) setNote(t.nothingApproved);
      const failed = Array.isArray(body.issues)
        ? (body.issues as Array<{ lineId: string; error: string }>)
        : [];
      if (failed.length)
        setError(
          failed
            .map((i) =>
              fmt(t.notSaved, {
                line: before.lines.find((l) => l.id === i.lineId)?.raw ?? "",
                error: i.error,
              })
            )
            .join(" · ")
        );
      onSettled?.();
    } else {
      rollback(optimistic ? t.rollback : String(body.error ?? t.errSave));
    }
  }

  async function undo() {
    if (!draft || !toast?.applied) return;
    const applied = toast.applied;
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/undo",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, applied }),
      },
      false
    );
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
      onTotals?.(
        applied
          .filter(
            (a) =>
              a.month === month &&
              (a.locationId ?? null) === (locationId ?? null)
          )
          .map((a) => ({
            category: a.category,
            total: a.previous
              ? a.category === "impuestos"
                ? a.previous.pct_of_sales
                : a.previous.amount
              : null,
            fromLines: a.previous?.source === "upload",
          }))
      );
      showToast({ text: t.undone, applied: null, undoable: false }, 2000);
      onSettled?.();
    } else {
      setToast(null);
      setError(String(body.error ?? t.errSave));
    }
  }

  const all = draft?.lines ?? [];
  const pendingLines = all.filter((l) => l.status === "pending");
  const review = inlineReview(all);
  const bulk = bulkApprovable(pendingLines);
  const dupTax = duplicateTaxIds(pendingLines);
  const hasAnything =
    review.fix.length > 0 ||
    review.clusters.some((c) => c.pending.length + c.approved.length > 0);
  const where = (l: DraftLine) =>
    l.scope?.kind === "restaurant"
      ? (locationNames[l.scope.locationId] ?? "")
      : l.scope
        ? t.group
        : "";
  const monthText = (l: DraftLine) =>
    l.month
      ? new Date(`${l.month}T00:00:00Z`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "";
  const lastText = (c: FixedCostCategory | null) => {
    if (!c) return null;
    const v = lastMonth[c];
    return v === undefined
      ? t.lastMonthNone
      : fmt(t.lastMonth, { amount: money(c, v) });
  };
  const pctText = (change: number) =>
    `${change > 0 ? "+" : ""}${Math.round(change * 100)}%`;

  const lineProps = (l: DraftLine) => ({
    line: l,
    busy,
    dupTax: dupTax.has(l.id),
    where: where(l),
    monthText: monthText(l),
    lastText: lastText(l.category),
    money,
    onCommit: (edit: {
      category?: FixedCostCategory | null;
      amount?: number | null;
    }) =>
      void patch({ edits: [{ lineId: l.id, ...edit }] }, (ls) =>
        ls.map((x) => (x.id === l.id ? { ...x, ...edit } : x))
      ),
    onApprove: () => void approve([l.id]),
    onSkip: () =>
      void patch({ edits: [{ lineId: l.id, discard: true }] }, (ls) =>
        ls.map((x) =>
          x.id === l.id ? { ...x, status: "discarded" as const } : x
        )
      ),
  });

  return (
    <div data-testid="fixed-cost-upload" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className={BTN}
        >
          {t.button}
        </button>
        <span className="text-[12px] text-[#6b7385]">{t.accepts}</span>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={t.button}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {busy ? (
          <span role="status" className="text-sm text-[#4a5a85]">
            {t.reading}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[#151c2c]">
          <span aria-hidden="true">⚑</span> {error}
        </p>
      ) : null}
      {note ? <p className="text-sm text-[#4a5a85]">{note}</p> : null}

      {draft && hasAnything ? (
        <section
          data-testid="upload-review"
          className="min-w-0 rounded-xl border border-[#dbe3f7] bg-white p-3 sm:p-4"
        >
          <h3 className="text-[15px] font-bold text-[#0F172A]">{t.title}</h3>
          {pendingLines.length > 0 ? (
            <p className="mt-1 text-sm text-[#4a5a85]">{t.intro}</p>
          ) : null}
          {draft.fileName ? (
            <p className="mt-1 break-words text-[12px] text-[#6b7385]">
              {draft.fileName}
            </p>
          ) : null}

          {conflicts.length > 0 ? (
            <div
              data-testid="overwrite-confirm"
              className="mt-3 rounded-lg border border-[#1B40C8] bg-[#E7EDFD] p-3"
            >
              <p className="text-sm font-semibold text-[#0F172A]">
                {t.overwriteTitle}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#0F172A]">
                {conflicts.map((c) => (
                  <li key={c.lineId} className="break-words">
                    {fmt(t.overwriteRow, {
                      category: categoryLabel(c.category, lang),
                      month: monthText({ month: c.month } as DraftLine),
                      old: money(c.category, c.old),
                      new: money(c.category, c.new),
                    })}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void approve(
                      pending,
                      conflicts.map((c) => c.lineId)
                    )
                  }
                  className={BTN}
                >
                  {t.overwriteConfirm}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConflicts([])}
                  className={LINK}
                >
                  {t.overwriteCancel}
                </button>
              </div>
            </div>
          ) : null}

          {pendingLines.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || bulk.count === 0}
                onClick={() => void approve()}
                className={BTN}
              >
                {fmt(t.approveAllN, {
                  n: bulk.count,
                  total: formatMoney(bulk.total, currency, lang),
                })}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void patch({ discardAll: true }, (ls) =>
                    ls.map((x) =>
                      x.status === "pending"
                        ? { ...x, status: "discarded" as const }
                        : x
                    )
                  )
                }
                className={LINK}
              >
                {t.discardAll}
              </button>
            </div>
          ) : null}

          {review.fix.length > 0 ? (
            <div data-testid="fix-first" className="mt-4">
              <h4 className="text-sm font-semibold text-[#0F172A]">
                <span aria-hidden="true">⚑</span> {t.fixFirst}
              </h4>
              <ul className="mt-2 space-y-2">
                {review.fix.map((l) => (
                  <LineRow key={l.id} {...lineProps(l)} />
                ))}
              </ul>
            </div>
          ) : null}

          {review.clusters.map((g) => {
            const projected =
              g.category === "impuestos"
                ? (g.pending[g.pending.length - 1]?.amount ?? undefined)
                : round2(g.approvedTotal + g.pendingTotal);
            const change =
              g.pending.length > 0 && projected !== undefined
                ? changeVsLastMonth(projected, lastMonth[g.category])
                : null;
            return (
              <div
                key={g.category}
                data-testid={`cluster-${g.category}`}
                className="mt-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4
                    data-testid={`cluster-head-${g.category}`}
                    className="text-sm font-semibold text-[#0F172A]"
                  >
                    {categoryLabel(g.category, lang)}
                    {g.pending.length > 1 && g.category !== "impuestos"
                      ? ` · ${fmt(t.pendingCount, { n: g.pending.length })} · ${money(g.category, g.pendingTotal)}`
                      : ""}
                  </h4>
                  {change !== null ? (
                    <span
                      data-testid={`change-${g.category}`}
                      className={ALERT_PILL}
                    >
                      {fmt(t.changeVsLast, { pct: pctText(change) })}
                    </span>
                  ) : null}
                </div>
                {g.pending.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {g.pending.map((l) => (
                      <LineRow key={l.id} {...lineProps(l)} />
                    ))}
                  </ul>
                ) : null}
                {g.approved.length > 0 ? (
                  <details
                    data-testid={`approved-${g.category}`}
                    className="mt-2 rounded-lg bg-[#F5F7FD] px-3 py-2"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-[#1B40C8]">
                      {fmt(t.approvedHeader, { n: g.approved.length })}
                      {g.category !== "impuestos"
                        ? ` · ${money(g.category, g.approvedTotal)}`
                        : ""}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {g.approved.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-baseline justify-between gap-3 text-sm text-[#0F172A]"
                        >
                          <span className="min-w-0 break-words">
                            {l.raw || "—"}
                          </span>
                          <span className="shrink-0">
                            {money(g.category, l.amount ?? 0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {toast ? (
        <div
          role="status"
          data-testid="approve-toast"
          className="fixed bottom-20 left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-[#1B40C8] px-4 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-6"
        >
          <span className="min-w-0 break-words">{toast.text}</span>
          {toast.undoable ? (
            <button
              type="button"
              onClick={() => void undo()}
              className="shrink-0 rounded-md px-2 py-1 underline"
            >
              {t.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function LineRow(props: {
  line: DraftLine;
  busy: boolean;
  /** Another tax line has the same month and restaurant: keep one. */
  dupTax: boolean;
  where: string;
  monthText: string;
  lastText: string | null;
  money: (c: FixedCostCategory, n: number) => string;
  onCommit: (edit: {
    category?: FixedCostCategory | null;
    amount?: number | null;
  }) => void;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const { d, lang } = useT();
  const t = d.costs.fixedUpload;
  const { line } = props;
  const issues = issuesOf(line);
  const flagged = issues.length > 0 || props.dupTax;
  const [editing, setEditing] = useState(line.amount === null);
  const [amount, setAmount] = useState(
    line.amount === null ? "" : formatTypedNumber(line.amount, lang)
  );
  const isTax = line.category === "impuestos";
  const commitAmount = () => {
    const p = parseLocaleNumber(amount, lang);
    if (!amount.trim()) return;
    if (p.ok && p.value !== null && p.value > 0 && p.value !== line.amount) {
      props.onCommit({ amount: p.value });
    }
    if (p.ok && p.value !== null && p.value > 0) setEditing(false);
  };
  return (
    <li
      data-testid="upload-line"
      className="min-w-0 rounded-lg border border-[#eef0f4] p-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-sm font-semibold text-[#0F172A]">
          {line.raw || "—"}
        </span>
        {editing ? (
          <input
            value={amount}
            inputMode="decimal"
            autoFocus={line.amount !== null}
            aria-label={isTax ? t.rateLabel : t.amountLabel}
            placeholder={t.noPrice}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmount();
            }}
            className={FIELD + " w-28 shrink-0 text-right"}
          />
        ) : (
          <span className="shrink-0 text-sm font-semibold text-[#0F172A]">
            {line.amount === null || !line.category
              ? "—"
              : props.money(line.category, line.amount)}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={line.category ?? ""}
          aria-label={t.pickCategory}
          onChange={(e) =>
            props.onCommit({
              category: (e.target.value || null) as FixedCostCategory | null,
            })
          }
          className="h-8 max-w-full rounded-full border border-[#1B40C8] bg-[#E7EDFD] px-3 text-[13px] font-semibold text-[#1B40C8]"
        >
          <option value="">{t.pickCategory}</option>
          {FIXED_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c, lang)}
            </option>
          ))}
        </select>
        {line.from === "ai" ? <span className={AI_PILL}>{t.aiTag}</span> : null}
        {flagged ? (
          <span className={ALERT_PILL}>{d.costs.fixed.missing}</span>
        ) : null}
        {line.amount === null ? (
          <span className={ALERT_PILL}>{t.noPrice}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-[#6b7385]">
        {[props.lastText, props.monthText, props.where]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {issues.length > 0 ? (
        <p className="mt-1 text-[12px] text-[#4a5a85]">{t.unrecognized}</p>
      ) : props.dupTax ? (
        <p className="mt-1 text-[12px] text-[#4a5a85]">{t.dupTax}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={props.busy || flagged}
          onClick={props.onApprove}
          aria-label={t.approveLine}
          className={BTN}
        >
          {t.approveBtn}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => setEditing((e) => !e)}
          className={LINK}
        >
          {editing && line.amount !== null ? t.doneEditing : t.editBtn}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onSkip}
          className={LINK}
        >
          {t.skipBtn}
        </button>
      </div>
    </li>
  );
}
