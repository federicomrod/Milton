"use client";

// components/restaurant/costs/FixedCostUpload.tsx
//
// «⇪ Subir archivo» in Costos fijos. A file (Excel/CSV, PDF or photo) is read
// into DRAFT lines that change nothing until approved. The review list sits at
// the top of the page; the cluster cards below are the only place amounts live.
//
// One tap on ✓ Aprobar moves the amount into its cluster card at once
// (optimistic, saved in the background, rolled back with a message on THAT line
// if the save fails). No accordion, no reload, no modal. A line Milton could
// not fully place says exactly what is missing — «⚑ Falta · ¿A qué
// restaurante?» — with the control to answer it, never a bare flag. When the
// cluster already has a confirmed amount that this upload did not write, the
// line shows the diff («Planilla hoy $21,400 · la factura propone $22,100»)
// and the person chooses Reemplazar or Sumar. Lines read by AI carry the
// lavender tag.

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
  nextRepeats,
  type DraftLine,
  type OverwriteConflict,
} from "@/lib/restaurant/fixed-cost-upload";
import {
  approvableAll,
  approvedItems,
  clusterAfter,
  conceptLabel,
  type ClusterItem,
  fileProposal,
  isHere,
  isOwnTotal,
  lineStatuses,
  sortForReview,
  vsLastMonth,
  type ApproveMode,
  type ClusterMap,
  type LineStatus,
  type Needs,
} from "@/lib/restaurant/fixed-cost-clusters";
import {
  formatTypedNumber,
  parseLocaleNumber,
} from "@/lib/restaurant/locale-number";

const ALERT_PILL =
  "inline-block rounded-full bg-[#FDE68A] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]";
const AI_PILL =
  "inline-block rounded-full bg-[#DDD6FE] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]";
const BTN =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const BTN_LIGHT =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#1B40C8] bg-white px-4 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";
const LINK =
  "inline-flex min-h-[44px] items-center text-sm font-semibold text-[#1B40C8] underline disabled:opacity-60";
const FIELD =
  "h-10 min-w-0 rounded-lg border border-[#c9cfdb] bg-white px-2 text-sm text-[#151c2c]";

interface Draft {
  id: string;
  fileName: string | null;
  lines: DraftLine[];
  status: string;
}

/** What a cluster card should show after an approval or an undo. */
export interface ClusterChange {
  category: FixedCostCategory;
  /** null = the cluster has no confirmed amount again. */
  total: number | null;
  source: string | null;
  label: string | null;
  /** «Se repite cada mes» of the row after the change. */
  repeats: boolean;
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
    repeats?: boolean | null;
  } | null;
  repeats: boolean;
  lineIds: string[];
}

interface Toast {
  text: string;
  applied: AppliedRow[] | null;
  /** The month the lines were saved to, when it is not the one on screen. */
  view?: { month: string; label: string };
}

const TOAST_MS = 5000;

export function FixedCostUpload({
  month,
  locationId,
  currency,
  restaurants,
  inputRef,
  lastMonth = {},
  clusters,
  showDrop = true,
  onReview,
  onConfirm,
  onSettled,
  onViewMonth,
  onRecalc,
}: {
  /** The month on screen (YYYY-MM-01): the default for lines without one. */
  month: string;
  /** null = the group's shared costs. */
  locationId: string | null;
  currency: string;
  /** The company's restaurants: to say where a line goes. */
  restaurants: Array<{ id: string; name: string }>;
  /** The file input, so the page's «Sube tus costos fijos» opens this same picker. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Last month's value per cluster, for «vs mes pasado». */
  lastMonth?: Partial<Record<FixedCostCategory, number>>;
  /** What each cluster holds on screen now (confirmed). */
  clusters: ClusterMap;
  /** Nothing confirmed yet: show the wide «Suelta una factura o PDF» zone. */
  showDrop?: boolean;
  /** The lines this upload approved per cluster (the card lists them). */
  onReview?: (info: {
    items: Partial<Record<FixedCostCategory, ClusterItem[]>>;
    falta: string[];
  }) => void;
  /** Called at once on approve/undo so the cards and break-even follow. */
  onConfirm?: (changes: ClusterChange[]) => void;
  /** Called a moment after the last change: the page may refresh quietly. */
  onSettled?: () => void;
  /** «Ver octubre»: opens the month a line was saved to. */
  onViewMonth?: (month: string) => void;
  /** True while a save that is not shown ahead of time is on its way: the figures wait. */
  onRecalc?: (recalculating: boolean) => void;
}) {
  const { d, lang, locale, fmt } = useT();
  const t = d.costs.fixedUpload;
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<OverwriteConflict[]>([]);
  const [pending, setPending] = useState<string[] | undefined>(undefined);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screen = { month, locationId };
  const names = new Map(restaurants.map((r) => [r.id, r.name]));

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

  useEffect(() => {
    const lines = draft?.lines ?? [];
    const sc = { month, locationId };
    const st = lineStatuses(lines, {}, sc);
    onReview?.({
      items: approvedItems(lines, sc),
      falta: lines
        .filter((l) => st.get(l.id)?.kind === "falta")
        .map((l) => l.raw.split(" · ")[0].trim() || "—"),
    });
  }, [draft, month, locationId, onReview]);

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
    setError(null);
    setLineErrors({});
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
    local: (lines: DraftLine[]) => DraftLine[],
    lineId?: string
  ) {
    if (!draft) return;
    const before = draft;
    setDraft({ ...draft, lines: local(draft.lines) });
    setLineErrors((e) => {
      const next = { ...e };
      if (lineId) delete next[lineId];
      return next;
    });
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
      if (lineId) setLineErrors((e) => ({ ...e, [lineId]: t.rollback }));
      else setError(t.rollback);
    }
  }

  const money = (c: FixedCostCategory, n: number) =>
    c === "impuestos" ? `${n}%` : formatMoney(n, currency, lang);

  const all = draft?.lines ?? [];
  const statuses = lineStatuses(all, clusters, screen);
  const list = sortForReview(all, statuses);
  const bulk = approvableAll(all, statuses);

  /**
   * Approves `ids` (default: every line that needs no decision). `mode` is the
   * person's choice on a diff: 'replace' confirms the overwrite, 'add' sums.
   */
  async function approve(ids?: string[], mode: ApproveMode = "auto") {
    if (!draft) return;
    const before = draft;
    const wanted = new Set(ids ?? bulk.ids);
    const ready = draft.lines.filter(
      (l) =>
        l.status === "pending" &&
        wanted.has(l.id) &&
        statuses.get(l.id)?.kind !== "falta"
    );
    if (ready.length === 0) {
      // Never a silent no-op: say why on the line.
      setLineErrors((e) => ({
        ...e,
        ...Object.fromEntries(
          [...wanted].map((id) => [id, t.nothingApproved] as const)
        ),
      }));
      return;
    }
    setLineErrors((e) => {
      const next = { ...e };
      ready.forEach((l) => delete next[l.id]);
      return next;
    });
    setConflicts([]);
    const cats = [
      ...new Set(ready.map((l) => l.category as FixedCostCategory)),
    ];
    const decided = (c: FixedCostCategory) =>
      mode !== "auto" ||
      !clusters[c] ||
      isOwnTotal(c, clusters[c], draft.lines, screen);
    const optimistic =
      ready.every((l) => isHere(l, screen)) && cats.every(decided);

    const labelFor = (c: FixedCostCategory): string | null => {
      const mine = ready.filter((l) => l.category === c);
      const own =
        mode !== "replace" && isOwnTotal(c, clusters[c], draft.lines, screen)
          ? draft.lines.filter(
              (l) =>
                l.status === "approved" && l.category === c && isHere(l, screen)
            )
          : [];
      const parts = conceptLabel([...own, ...mine]);
      const prior = clusters[c]?.label;
      if (c !== "impuestos" && mode === "add" && !own.length && prior)
        return `${prior} + ${parts ?? ""}`.slice(0, 120);
      return c === "impuestos" ? (parts?.split(" + ").pop() ?? null) : parts;
    };
    // ON for ordinary bills, OFF for one-offs; adding keeps the person's choice.
    const repeatsFor = (c: FixedCostCategory): boolean => {
      const adding =
        c !== "impuestos" &&
        !!clusters[c] &&
        (mode === "add" ||
          (mode !== "replace" &&
            isOwnTotal(c, clusters[c], draft.lines, screen)));
      return nextRepeats(
        ready.filter((l) => l.category === c),
        adding,
        clusters[c]?.repeats
      );
    };
    const change = (c: FixedCostCategory): ClusterChange => ({
      category: c,
      total: clusterAfter(
        c,
        clusters[c]?.value ?? null,
        ready.filter((l) => l.category === c),
        mode
      ),
      source: "upload",
      label: labelFor(c),
      repeats: repeatsFor(c),
    });
    const undoChanges = () =>
      cats.map(
        (c): ClusterChange => ({
          category: c,
          total: clusters[c]?.value ?? null,
          source: clusters[c]?.source ?? null,
          label: clusters[c]?.label ?? null,
          repeats: clusters[c]?.repeats === true,
        })
      );

    if (optimistic) {
      const set = new Set(ready.map((l) => l.id));
      setDraft({
        ...draft,
        lines: draft.lines.map((l) =>
          set.has(l.id) ? { ...l, status: "approved" as const } : l
        ),
      });
      onConfirm?.(cats.map(change));
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
      });
    }

    if (!optimistic) onRecalc?.(true);
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          lineIds: ready.map((l) => l.id),
          confirmed: mode === "replace" ? ready.map((l) => l.id) : undefined,
          adds: mode === "add" ? ready.map((l) => l.id) : undefined,
        }),
      },
      !optimistic
    );
    onRecalc?.(false);

    const unwind = () => {
      setDraft(before);
      if (optimistic) {
        onConfirm?.(undoChanges());
        setToast(null);
      }
    };
    const rollback = (message: string) => {
      unwind();
      setLineErrors((e) => ({
        ...e,
        ...Object.fromEntries(ready.map((l) => [l.id, message] as const)),
      }));
    };

    if (status === 409 && Array.isArray(body.conflicts)) {
      // The server found a value we did not foresee: ask here, on the list.
      unwind();
      setConflicts(body.conflicts as OverwriteConflict[]);
      setPending(ready.map((l) => l.id));
      return;
    }
    if (status === 200 && body.draft) {
      const next = body.draft as Draft;
      const applied = (
        Array.isArray(body.applied) ? body.applied : []
      ) as AppliedRow[];
      setDraft(next);
      const here = applied.filter(
        (a) =>
          a.month === month && (a.locationId ?? null) === (locationId ?? null)
      );
      // Optimistically confirmed but not actually applied (a line the server
      // refused, or left pending): the card goes back to what it was.
      if (optimistic) {
        const landed = new Set(here.map((a) => a.category));
        const restore = undoChanges().filter((c) => !landed.has(c.category));
        if (restore.length) onConfirm?.(restore);
        if (applied.length === 0) setToast(null);
      }
      onConfirm?.(
        here.map((a) => ({
          category: a.category,
          total: a.total,
          source: "upload",
          repeats: a.repeats === true,
          label:
            a.category === "impuestos"
              ? (conceptLabel(
                  next.lines.filter(
                    (l) =>
                      l.status === "approved" &&
                      l.category === "impuestos" &&
                      isHere(l, screen)
                  )
                )
                  ?.split(" + ")
                  .pop() ?? null)
              : (() => {
                  const names = conceptLabel(
                    next.lines.filter(
                      (l) =>
                        l.status === "approved" &&
                        l.category === a.category &&
                        isHere(l, screen)
                    )
                  );
                  const prior = a.previous?.label;
                  return a.previous && a.previous.source !== "upload" && prior
                    ? `${prior} + ${names ?? ""}`.slice(0, 120)
                    : names;
                })(),
        }))
      );
      const elsewhere = applied.filter((a) => !here.includes(a));
      if (!optimistic && applied.length) {
        const total = applied.reduce((n, a) => n + a.lineIds.length, 0);
        const months = [...new Set(elsewhere.map((a) => a.month))];
        const elsewhereN = elsewhere.reduce((n, a) => n + a.lineIds.length, 0);
        showToast({
          text: elsewhere.length
            ? fmt(elsewhereN === 1 ? t.savedElsewhereOne : t.savedElsewhere, {
                n: elsewhereN,
                where: [
                  ...new Set(
                    elsewhere.map((a) =>
                      a.locationId ? (names.get(a.locationId) ?? "") : t.group
                    )
                  ),
                ].join(", "),
                month: months.map((m) => monthText(m)).join(", "),
              })
            : fmt(total === 1 ? t.toastApprovedOne : t.toastApprovedMany, {
                n: total,
                categories: [...new Set(applied.map((a) => a.category))]
                  .map((c) => categoryLabel(c, lang))
                  .join(", "),
              }),
          applied,
          view:
            elsewhere.length > 0 &&
            months.length === 1 &&
            elsewhere.every(
              (a) => (a.locationId ?? null) === (locationId ?? null)
            )
              ? { month: months[0], label: monthText(months[0]) }
              : undefined,
        });
      } else if (applied.length) {
        setToast((cur) => (cur ? { ...cur, applied } : cur));
      }
      const failed = Array.isArray(body.issues)
        ? (body.issues as Array<{ lineId: string; error: string }>)
        : [];
      if (failed.length)
        setLineErrors((e) => ({
          ...e,
          ...Object.fromEntries(
            failed.map(
              (i) => [i.lineId, fmt(t.notApproved, { error: i.error })] as const
            )
          ),
        }));
      // A line that was asked for and neither saved nor failed says so.
      const stillPending = next.lines.filter(
        (l) =>
          l.status === "pending" &&
          ready.some((r) => r.id === l.id) &&
          !failed.some((f) => f.lineId === l.id)
      );
      if (stillPending.length)
        setLineErrors((e) => ({
          ...e,
          ...Object.fromEntries(
            stillPending.map((l) => [l.id, t.nothingApproved] as const)
          ),
        }));
      onSettled?.();
    } else {
      rollback(String(body.error ?? t.rollback));
    }
  }

  async function undo() {
    if (!draft || !toast?.applied) return;
    const applied = toast.applied;
    onRecalc?.(true);
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/undo",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, applied }),
      },
      false
    );
    onRecalc?.(false);
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
      onConfirm?.(
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
            source: a.previous?.source ?? null,
            label: a.previous?.label ?? null,
            repeats: a.previous?.repeats === true,
          }))
      );
      showToast({ text: t.undone, applied: null }, 2000);
      onSettled?.();
    } else {
      setToast(null);
      setError(String(body.error ?? t.errSave));
    }
  }

  const where = (l: DraftLine) =>
    l.scope?.kind === "restaurant"
      ? (names.get(l.scope.locationId) ?? "")
      : l.scope
        ? t.group
        : "";
  const monthText = (iso: string | null) =>
    iso
      ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "";

  const needsCopy: Record<Needs, string> = {
    restaurant: t.needsRestaurant,
    category: t.needsCategory,
    amount: t.needsAmount,
    month: t.needsMonth,
    duplicate: t.needsDuplicate,
  };

  const [dragging, setDragging] = useState(false);
  const drop = showDrop && list.length === 0;

  return (
    <div data-testid="fixed-cost-upload" className="min-w-0 space-y-3">
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
      {drop ? (
        <div
          data-testid="dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          className={
            "flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#1B40C8] px-4 py-8 text-center transition-colors " +
            (dragging ? "bg-[#E7EDFD]" : "bg-[#F8FAFF]")
          }
        >
          <p className="text-base font-semibold text-[#1B40C8]">
            {t.dropTitle}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className={BTN}
          >
            {t.dropButton}
          </button>
          <p className="text-[12px] text-[#6b7385]">{t.accepts}</p>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-[#4a5a85]">
          {t.reading}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[#151c2c]">
          <span aria-hidden="true">⚑</span> {error}
        </p>
      ) : null}

      {draft && list.length > 0 ? (
        <section
          data-testid="upload-review"
          className="min-w-0 rounded-xl border border-[#dbe3f7] bg-[#F8FAFF] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 className="text-[15px] font-bold text-[#0F172A]">{t.title}</h3>
            {draft.fileName ? (
              <p className="break-all text-[12px] text-[#6b7385]">
                {draft.fileName}
              </p>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[#4a5a85]">{t.intro}</p>

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
                      month: monthText(c.month),
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
                  onClick={() => void approve(pending, "replace")}
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

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {bulk.count > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve()}
                className={BTN}
              >
                {fmt(t.approveAllN, {
                  n: bulk.count,
                  total:
                    bulk.total > 0
                      ? formatMoney(bulk.total, currency, lang)
                      : "—",
                })}
              </button>
            ) : null}
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
          {bulk.deciding > 0 ? (
            <p className="mt-1 text-[12px] text-[#4a5a85]">
              {fmt(t.decide, { n: bulk.deciding })}
            </p>
          ) : null}

          <ul className="mt-3 space-y-2">
            {list.map((l) => {
              const st = statuses.get(l.id) as LineStatus;
              const cat = l.category;
              const proposal = cat
                ? fileProposal(all, cat, statuses, screen)
                : null;
              const vs =
                cat && proposal !== null && isHere(l, screen)
                  ? vsLastMonth(proposal, lastMonth[cat])
                  : null;
              return (
                <LineRow
                  key={`${l.id}:${l.amount}:${l.category}`}
                  line={l}
                  status={st}
                  busy={busy}
                  error={lineErrors[l.id]}
                  where={where(l)}
                  monthText={monthText(l.month)}
                  elsewhere={
                    l.month && l.month !== month
                      ? {
                          label: fmt(t.savesIn, { month: monthText(l.month) }),
                          use: fmt(t.useMonth, { month: monthText(month) }),
                        }
                      : null
                  }
                  screenMonth={month}
                  vsText={
                    vs === null
                      ? null
                      : fmt(t.vsLast, {
                          pct: `${vs > 0 ? "+" : ""}${Math.round(vs * 100)}%`,
                        })
                  }
                  needsText={st.kind === "falta" ? needsCopy[st.needs] : null}
                  restaurants={restaurants}
                  money={money}
                  currency={currency}
                  onCommit={(edit) =>
                    void patch(
                      { edits: [{ lineId: l.id, ...edit }] },
                      (ls) =>
                        ls.map((x) => (x.id === l.id ? { ...x, ...edit } : x)),
                      l.id
                    )
                  }
                  onApprove={(mode) => void approve([l.id], mode)}
                  onSkip={() =>
                    void patch(
                      { edits: [{ lineId: l.id, discard: true }] },
                      (ls) =>
                        ls.map((x) =>
                          x.id === l.id
                            ? { ...x, status: "discarded" as const }
                            : x
                        ),
                      l.id
                    )
                  }
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      {toast ? (
        <div
          role="status"
          data-testid="approve-toast"
          className="fixed bottom-20 left-4 right-4 z-40 flex max-w-sm items-center justify-between gap-3 rounded-xl border border-[#dfe3ea] bg-white px-4 py-3 text-sm font-medium text-[#151c2c] shadow-lg lg:bottom-6 lg:left-[256px] lg:right-auto"
        >
          <span className="min-w-0 break-words">{toast.text}</span>
          {toast.view && onViewMonth ? (
            <button
              type="button"
              onClick={() => onViewMonth(toast.view!.month)}
              className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-[#c9cfdb] bg-white px-3 text-sm font-semibold text-[#1B40C8] hover:bg-[#F1F3F7]"
            >
              {fmt(t.viewMonth, { month: toast.view.label })}
            </button>
          ) : null}
          {toast.applied ? (
            <button
              type="button"
              onClick={() => void undo()}
              className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-[#c9cfdb] bg-white px-3 text-sm font-semibold text-[#151c2c] hover:bg-[#F1F3F7]"
            >
              {t.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LineRow(props: {
  line: DraftLine;
  status: LineStatus;
  busy: boolean;
  error?: string;
  where: string;
  monthText: string;
  /** Set when the line is dated another month than the one on screen. */
  elsewhere: { label: string; use: string } | null;
  /** The month on screen: what «Usar {mes}» moves the line to. */
  screenMonth: string;
  vsText: string | null;
  needsText: string | null;
  restaurants: Array<{ id: string; name: string }>;
  money: (c: FixedCostCategory, n: number) => string;
  currency: string;
  onCommit: (edit: {
    category?: FixedCostCategory | null;
    amount?: number | null;
    scope?: DraftLine["scope"];
    month?: string;
  }) => void;
  onApprove: (mode: ApproveMode) => void;
  onSkip: () => void;
}) {
  const { d, lang, fmt } = useT();
  const t = d.costs.fixedUpload;
  const { line, status } = props;
  const falta = status.kind === "falta";
  const needs = falta ? status.needs : null;
  // «Asignar» opens the one control that answers what is missing.
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(
    line.amount === null ? "" : formatTypedNumber(line.amount, lang)
  );
  const isTax = line.category === "impuestos";
  const cat = line.category;
  const showAmountInput = editing || (needs === "amount" && assigning);
  const showChip = cat !== null || (needs === "category" && assigning);
  const commitAmount = () => {
    const p = parseLocaleNumber(amount, lang);
    if (!amount.trim()) return;
    if (p.ok && p.value !== null && p.value > 0 && p.value !== line.amount) {
      props.onCommit({ amount: p.value });
    }
    if (p.ok && p.value !== null && p.value > 0) {
      setEditing(false);
      setAssigning(false);
    }
  };
  return (
    <li
      data-testid="upload-line"
      data-status={status.kind}
      className="min-w-0 rounded-lg border border-[#e3e8f5] bg-white p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 break-words text-sm font-semibold text-[#0F172A]">
          {line.raw || "—"}
        </span>
        {showAmountInput ? (
          <input
            value={amount}
            inputMode="decimal"
            autoFocus
            aria-label={isTax ? t.rateLabel : t.amountLabel}
            placeholder={t.noPrice}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmount();
            }}
            className={FIELD + " w-28 text-right"}
          />
        ) : (
          <span className="text-sm font-semibold text-[#0F172A]">
            {line.amount === null || !cat
              ? line.amount === null
                ? t.noPrice
                : props.money("otros", line.amount)
              : props.money(cat, line.amount)}
          </span>
        )}
        {showChip ? (
          <select
            value={line.category ?? ""}
            aria-label={t.pickCategory}
            autoFocus={needs === "category"}
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
        ) : null}
        {line.from === "ai" ? <span className={AI_PILL}>{t.aiTag}</span> : null}
        {props.elsewhere ? (
          <span data-testid="month-tag" className={ALERT_PILL}>
            <span aria-hidden="true">⚑</span> {props.elsewhere.label}
          </span>
        ) : null}
        {props.needsText ? (
          <span data-testid="falta-tag" className={ALERT_PILL}>
            <span aria-hidden="true">⚑</span> {d.costs.fixed.missing} ·{" "}
            {props.needsText}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {status.kind === "ready" ? (
            <button
              type="button"
              onClick={() => props.onApprove("auto")}
              aria-label={t.approveLine}
              className={BTN}
            >
              {t.approveBtn}
            </button>
          ) : null}
          {status.kind === "diff" && cat ? (
            <>
              <button
                type="button"
                onClick={() => props.onApprove("replace")}
                className={BTN}
              >
                {t.replaceBtn}
              </button>
              {status.sum !== null ? (
                <button
                  type="button"
                  onClick={() => props.onApprove("add")}
                  className={BTN_LIGHT}
                >
                  {fmt(t.addBtn, { sum: props.money(cat, status.sum) })}
                </button>
              ) : null}
            </>
          ) : null}
          {props.elsewhere && !falta ? (
            <button
              type="button"
              onClick={() => props.onCommit({ month: props.screenMonth })}
              className={LINK}
            >
              {props.elsewhere.use}
            </button>
          ) : null}
          {falta && needs !== "duplicate" ? (
            <button
              type="button"
              onClick={() => setAssigning((a) => !a)}
              aria-expanded={assigning}
              className={BTN}
            >
              {t.assign}
            </button>
          ) : null}
          {!falta ? (
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className={LINK}
            >
              {editing ? t.doneEditing : t.editBtn}
            </button>
          ) : null}
          <button
            type="button"
            onClick={props.onSkip}
            className={falta ? BTN_LIGHT : LINK}
          >
            {t.skipBtn}
          </button>
        </div>
      </div>
      {needs === "restaurant" && assigning ? (
        <select
          aria-label={t.needsRestaurant}
          value=""
          autoFocus
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            props.onCommit({
              scope:
                v === "group"
                  ? { kind: "group" }
                  : { kind: "restaurant", locationId: v },
            });
          }}
          className={FIELD + " mt-2 w-full"}
        >
          <option value="">{t.pickRestaurant}</option>
          {props.restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value="group">{t.group}</option>
        </select>
      ) : null}
      {needs === "month" && assigning ? (
        <input
          type="month"
          aria-label={t.needsMonth}
          onChange={(e) =>
            e.target.value
              ? props.onCommit({ month: `${e.target.value}-01` })
              : undefined
          }
          className={FIELD + " mt-2 w-full"}
        />
      ) : null}
      {needs === "duplicate" ? (
        <p className="mt-1 text-[12px] text-[#4a5a85]">{t.dupTax}</p>
      ) : null}
      {status.kind === "diff" && cat ? (
        <p
          data-testid="line-diff"
          className="mt-2 rounded-lg bg-[#E7EDFD] px-3 py-2 text-sm font-medium text-[#0F172A]"
        >
          {fmt(t.diffToday, {
            category: categoryLabel(cat, lang),
            today: props.money(cat, status.today),
            proposes: props.money(cat, status.proposes),
          })}
        </p>
      ) : null}
      {[props.vsText, props.monthText, props.where].some(Boolean) ? (
        <p className="mt-1 text-[12px] text-[#6b7385]">
          {[props.vsText, props.monthText, props.where]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {props.error ? (
        <p role="alert" className="mt-1 text-[12px] text-[#0F172A]">
          <span aria-hidden="true">⚑</span> {props.error}
        </p>
      ) : null}
    </li>
  );
}
