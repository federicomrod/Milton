"use client";

// components/restaurant/costs/FixedCostUpload.tsx
//
// «⇪ Subir archivo» in Costos fijos. A file (Excel/CSV, PDF or photo) is read
// into DRAFT lines that change nothing until approved. The review list sits at
// the top of the page; the cluster cards below are the only place amounts live.
//
// One tap on ✓ Aprobar sends the lines to the database as ONE command (items +
// aggregate + history + draft together, or nothing). The cards change when the
// server answers — «Recalculando…» until then, never a final-looking number
// from a guess. The review shows WHERE each line will be saved (month and
// restaurant) before anything is written. No accordion, no reload, no modal. A line Milton could
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
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";
import type {
  ApprovedCategory,
  DraftConflict,
  UploadPreview,
} from "@/lib/restaurant/fixed-cost-commands";
import {
  approvableAll,
  approvedItems,
  conceptLabel,
  type ClusterItem,
  fileProposal,
  isHere,
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
  /** Moves on every change; the approval sends the one that was reviewed. */
  version: number;
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

interface Toast {
  text: string;
  /** The command that can be undone from the toast; null = nothing to undo. */
  commandId: string | null;
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
  onRefresh,
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
  /** Re-read the page now (after an undo, or a save into another month). */
  onRefresh?: () => void;
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
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
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
        if (live && j?.draft) {
          setDraft(j.draft as Draft);
          setPreview((j.preview as UploadPreview | null) ?? null);
        }
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
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
      setPreview((body.preview as UploadPreview | null) ?? null);
    } else setError(String(body.error ?? t.errSave));
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
      setPreview((body.preview as UploadPreview | null) ?? null);
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

  /** Re-reads the draft and its review (after a stale answer). */
  async function reload() {
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload",
      { method: "GET" },
      false
    );
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
      setPreview((body.preview as UploadPreview | null) ?? null);
    }
  }

  /**
   * Approves `ids` (default: every line that needs no decision). `mode` is the
   * person's choice on an overlap: 'replace' swaps the existing items for these
   * lines, 'add' keeps them and adds, 'add_duplicate' also accepts an exact repeat.
   * Nothing on screen changes until the server has committed.
   */
  async function approve(ids?: string[], mode: ApproveMode = "auto") {
    if (!draft) return;
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
    setError(null);
    // The versions this review was built on: the database refuses a stale one.
    const expected = Object.fromEntries(
      (preview?.keys ?? []).map((k) => [k.key, k.version] as const)
    );
    const decisions =
      mode === "auto"
        ? {}
        : Object.fromEntries(ready.map((l) => [l.id, mode] as const));

    onRecalc?.(true);
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          draftVersion: draft.version,
          expected,
          commandKey: crypto.randomUUID(),
          lineIds: ready.map((l) => l.id),
          decisions,
        }),
      },
      true
    );
    onRecalc?.(false);

    if (status === 409 && Array.isArray(body.conflicts)) {
      // An overlap with what is already saved: ask here, on the list. Nothing was written.
      setConflicts(body.conflicts as DraftConflict[]);
      setPending(ready.map((l) => l.id));
      return;
    }
    if (status === 409 && body.stale) {
      setError(String(body.error ?? t.staleDraft));
      await reload();
      return;
    }
    if (status !== 200 || !body.draft) {
      const message = String(body.error ?? t.rollback);
      setLineErrors((e) => ({
        ...e,
        ...Object.fromEntries(ready.map((l) => [l.id, message] as const)),
      }));
      return;
    }

    const next = body.draft as Draft;
    setDraft(next);
    setPreview((body.preview as UploadPreview | null) ?? null);
    const cats = (
      Array.isArray(body.categories) ? body.categories : []
    ) as ApprovedCategory[];
    const created = Number(body.lines_approved ?? 0);
    const already = Number(body.lines_already_approved ?? 0);
    const commandId =
      typeof body.command_id === "string" && created > 0
        ? body.command_id
        : null;
    const here = cats.filter(
      (c) =>
        c.month === month && (c.location_id ?? null) === (locationId ?? null)
    );
    // The cards follow what the server says it now holds.
    onConfirm?.(
      here
        .filter((c) => c.outcome !== "unchanged")
        .map((c) => ({
          category: c.category,
          total: c.total,
          source: "upload",
          repeats: c.repeats === true,
          label:
            c.category === "impuestos"
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
              : conceptLabel(
                  next.lines.filter(
                    (l) =>
                      l.status === "approved" &&
                      l.category === c.category &&
                      isHere(l, screen)
                  )
                ),
        }))
    );
    const elsewhere = cats.filter(
      (c) => !here.includes(c) && c.outcome !== "unchanged"
    );
    const months = [...new Set(elsewhere.map((c) => c.month))];
    if (created === 0 && already > 0) {
      showToast({ text: t.nothingNew, commandId: null });
    } else if (elsewhere.length > 0 && months.length === 1) {
      // Say where it went AND that the month on screen did not change.
      showToast({
        text:
          fmt(t.savedInMonth, {
            month: monthText(months[0]),
            screen: monthText(month),
          }) +
          " " +
          (already > 0
            ? fmt(t.countsAlready, { n: created, m: already })
            : fmt(created === 1 ? t.countsLineOne : t.countsLine, {
                n: created,
              })),
        commandId,
        view: elsewhere.every(
          (c) => (c.location_id ?? null) === (locationId ?? null)
        )
          ? { month: months[0], label: monthText(months[0]) }
          : undefined,
      });
    } else if (created > 0) {
      showToast({
        text:
          (already > 0
            ? fmt(t.countsAlready, { n: created, m: already })
            : fmt(created === 1 ? t.countsLineOne : t.countsLine, {
                n: created,
              })) +
          " → " +
          [...new Set(cats.map((c) => categoryLabel(c.category, lang)))].join(
            ", "
          ),
        commandId,
      });
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
    // Re-read the page now: the breakdown under a card is the canonical items,
    // not the draft. (A save into another month leaves this month as it was.)
    if (onRefresh) onRefresh();
    else onSettled?.();
  }

  async function undo() {
    if (!draft || !toast?.commandId) return;
    onRecalc?.(true);
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/undo",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The browser names the command only. What to restore is the server's.
        body: JSON.stringify({
          commandId: toast.commandId,
          commandKey: crypto.randomUUID(),
        }),
      },
      false
    );
    if (status === 200 && body.draft) {
      setDraft(body.draft as Draft);
      setPreview((body.preview as UploadPreview | null) ?? null);
      showToast({ text: t.undone, commandId: null }, 2000);
      onRefresh?.();
    } else {
      onRecalc?.(false);
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

  // WHERE each pending line will be saved, before anything is written. The month
  // on screen is only where the person is looking, never an instruction.
  const destGroups = (() => {
    const by = new Map<
      string,
      { month: string; where: string; ids: string[] }
    >();
    for (const l of all) {
      if (l.status !== "pending" || !l.month || !l.scope) continue;
      const key = `${l.month}|${l.scope.kind === "restaurant" ? l.scope.locationId : "group"}`;
      const g = by.get(key) ?? { month: l.month, where: where(l), ids: [] };
      g.ids.push(l.id);
      by.set(key, g);
    }
    return [...by.entries()].map(([key, g]) => ({ key, ...g }));
  })();
  const monthChoices = (current: string) => {
    const out = new Set<string>([current]);
    const [y, m] = month.split("-").map(Number);
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.add(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
      );
    }
    return [...out].sort().reverse();
  };
  const destMonths = [...new Set(destGroups.map((g) => g.month))];

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

          {destGroups.length > 0 ? (
            <div
              data-testid="upload-destination"
              className="mt-3 rounded-lg border border-[#dbe3f7] bg-white p-3"
            >
              <p className="text-[13px] font-bold text-[#0F172A]">
                {t.destTitle}
              </p>
              <ul className="mt-1 space-y-1">
                {destGroups.map((g) => (
                  <li
                    key={g.key}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-[#0F172A]"
                  >
                    <span data-testid="dest-line">
                      {fmt(g.ids.length === 1 ? t.destLineOne : t.destLine, {
                        n: g.ids.length,
                        where: g.where || t.group,
                        month: monthText(g.month),
                      })}
                    </span>
                    <label className="flex items-center gap-2 text-[12px] text-[#4a5a85]">
                      {t.destChange}
                      <select
                        aria-label={`${t.destChange}: ${monthText(g.month)}`}
                        value={g.month}
                        disabled={busy}
                        onChange={(e) => {
                          const m = e.target.value;
                          void patch(
                            {
                              edits: g.ids.map((id) => ({
                                lineId: id,
                                month: m,
                              })),
                            },
                            (ls) =>
                              ls.map((x) =>
                                g.ids.includes(x.id) ? { ...x, month: m } : x
                              )
                          );
                        }}
                        className={FIELD}
                      >
                        {monthChoices(g.month).map((m) => (
                          <option key={m} value={m}>
                            {monthText(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
              <p
                data-testid="dest-note"
                className="mt-2 text-[12px] text-[#4a5a85]"
              >
                {destMonths.length > 1
                  ? t.destMixed
                  : destMonths[0] === month
                    ? t.destSame
                    : fmt(t.destViewing, {
                        screen: monthText(month),
                        dest: destMonths.map(monthText).join(", "),
                      })}
              </p>
              {preview?.same_file_seen_before ? (
                <p className="mt-1 text-[12px] text-[#4a5a85]">
                  {t.sameFileSeen}
                </p>
              ) : null}
            </div>
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
                      month: monthText(c.month),
                      old: money(c.category, c.old ?? 0),
                      new: money(c.category, c.new),
                    })}
                    {c.kind === "duplicate" ? (
                      <span className="block text-[12px] text-[#4a5a85]">
                        {fmt(t.duplicateNote, {
                          category: categoryLabel(c.category, lang),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {conflicts.every((c) => c.kind === "duplicate") ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve(pending, "add_duplicate")}
                    className={BTN}
                  >
                    {t.addAnyway}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void approve(pending, "replace")}
                      className={BTN}
                    >
                      {t.overwriteConfirm}
                    </button>
                    {conflicts.every((c) => c.category !== "impuestos") ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void approve(pending, "add")}
                        className={BTN_LIGHT}
                      >
                        {t.addBtn.replace("(→ {sum})", "").trim()}
                      </button>
                    ) : null}
                  </>
                )}
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
          {toast.commandId ? (
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
