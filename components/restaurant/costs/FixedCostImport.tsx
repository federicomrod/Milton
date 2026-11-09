"use client";

// ONE import review, ONE confirmation. A cost file is read into a draft (no
// money moves), the database previews exactly what each destination would become
// (a read), and this component shows that changeset once, grouped by month, with
// every question inline. A single confirmation sends the reviewed changeset to
// the canonical approve command, which commits all of it or none.
//
// The month on screen never changes by itself: an October file reviewed while
// November is open leaves November selected. "Ver meses actualizados" is an
// offer, not an automatic jump.

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  AMOUNT_CATEGORIES,
  categoryLabel,
  type AmountCategory,
} from "@/lib/restaurant/fixed-costs";
import type { UploadPreview } from "@/lib/restaurant/fixed-cost-commands";
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";
import {
  ASSIGNABLE,
  approvalBody,
  buildReview,
  isFullStatement,
  monthUnchanged,
  rowAfter,
  savedRows,
  undecided,
  type AssignableCategory,
  type OverlapChoice,
  type Review,
  type ReviewGroup,
  type SavedRow,
} from "@/lib/restaurant/fixed-cost-import-review";
import { monthText, type Overview } from "@/lib/restaurant/fixed-cost-overview";

interface Draft {
  id: string;
  version: number;
  fileName: string | null;
  lines: DraftLine[];
  status: string;
}

interface ApprovedCategory {
  key: string;
  category: string;
  month: string;
  location_id: string | null;
  outcome: string;
  total?: number | null;
  previous_total?: number | null;
}

export interface ImportApplied {
  /** `month|category` of every cell the command changed (any destination). */
  changed: string[];
  months: string[];
  commandId: string | null;
  /** Exactly what the database reported it saved, per destination. */
  saved: SavedRow[];
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "review" }
  | { kind: "saving" }
  | {
      kind: "done";
      months: string[];
      unchanged: boolean;
      commandId: string | null;
      commandKey: string;
      saved: SavedRow[];
    }
  | { kind: "undone" };

const BTN =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const BTN_LIGHT =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#1B40C8] bg-white px-4 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

export function FixedCostImport({
  month,
  locationId,
  restaurants,
  currency,
  overview,
  windowMonths,
  onApplied,
  onViewMonths,
  onUndone,
  onDismiss,
  refreshing = false,
  onRefresh,
  onViewDestination,
  canWrite,
}: {
  /** The month on screen: the default for lines that name none. */
  month: string;
  locationId: string | null;
  restaurants: Array<{ id: string; name: string }>;
  currency: string;
  overview: Overview;
  windowMonths: string[];
  onApplied: (a: ImportApplied) => void;
  onViewMonths: (months: string[]) => void;
  onUndone: () => void;
  /** The result card was closed: the temporary highlight can go. */
  onDismiss?: () => void;
  /** The server is re-reading the page after a save. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Open another destination (a restaurant, or null = the group). */
  onViewDestination?: (loc: string | null) => void;
  canWrite: boolean;
}) {
  const { d, lang, fmt } = useT();
  const r = d.costs.fixedReview;
  const o = d.costs.fixedOverview;
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, OverlapChoice>>({});
  const [error, setError] = useState<string | null>(null);
  // Group scope asks WHERE the costs go before a file is read; never a default.
  const [asking, setAsking] = useState(false);
  const [dest, setDest] = useState<string | null>(null);
  // Unclear lines the person chose to leave out (reversible until confirmed).
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // One idempotency key per review: a lost response can be retried safely.
  const commandKey = useRef<string>("");

  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const money = (n: number, cat?: string) =>
    cat === "impuestos" ? `${n}%` : formatMoney(n, currency, lang);
  const cat = (c: string) => categoryLabel(c as AmountCategory, lang);
  const names = useMemo(
    () => new Map(restaurants.map((x) => [x.id, x.name])),
    [restaurants]
  );

  // Resume an open draft (read only).
  useEffect(() => {
    let live = true;
    fetch("/api/restaurant/fixed-costs/upload")
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => {
        if (!live || !j?.draft) return;
        const dr = j.draft as Draft;
        if (dr.lines.some((l) => l.status === "pending")) {
          setDraft(dr);
          setPreview((j.preview as UploadPreview | null) ?? null);
          commandKey.current = crypto.randomUUID();
          setPhase({ kind: "review" });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const review: Review | null = useMemo(
    () => (draft && preview ? buildReview(draft.lines, preview) : null),
    [draft, preview]
  );

  async function upload(file: File) {
    setError(null);
    setPhase({ kind: "reading" });
    const form = new FormData();
    form.set("file", file);
    form.set("month", month);
    // The scope on screen, or the destination the person chose for the group.
    // An empty value is only ever sent when "shared group costs" was chosen.
    form.set(
      "location_id",
      locationId ?? (dest && dest !== "group" ? dest : "")
    );
    try {
      const res = await fetch("/api/restaurant/fixed-costs/upload", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.draft) {
        setDraft(body.draft as Draft);
        setPreview((body.preview as UploadPreview | null) ?? null);
        setChoices({});
        setExcluded(new Set());
        setAsking(false);
        commandKey.current = crypto.randomUUID();
        setPhase({ kind: "review" });
      } else {
        setError(String(body.error ?? r.failed));
        setPhase({ kind: "idle" });
      }
    } catch {
      setError(r.failed);
      setPhase({ kind: "idle" });
    }
    if (input.current) input.current.value = "";
  }

  /** Edits a draft line (a draft is not money): returns the fresh draft + review. */
  async function patch(edits: Array<Record<string, unknown>>) {
    if (!draft) return null;
    try {
      const res = await fetch("/api/restaurant/fixed-costs/upload", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, edits }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.draft) {
        setError(String(body.error ?? r.failed));
        return null;
      }
      return {
        draft: body.draft as Draft,
        preview: (body.preview as UploadPreview | null) ?? null,
      };
    } catch {
      setError(r.failed);
      return null;
    }
  }

  /** One click on an unclear line: nothing is guessed, the database re-previews. */
  async function assign(edit: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    const next = await patch([edit]);
    setBusy(false);
    if (next) {
      setDraft(next.draft);
      setPreview(next.preview);
    }
  }

  function toggleExclude(id: string) {
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (!review || !preview || !draft) return;
    setError(null);
    setPhase({ kind: "saving" });
    const key = commandKey.current;
    try {
      // Lines the person explicitly left out are discarded first, so the
      // approval sees exactly what the review showed (and nothing is hidden).
      let useReview = review;
      let usePreview = preview;
      if (excluded.size > 0) {
        const next = await patch(
          [...excluded].map((lineId) => ({ lineId, discard: true }))
        );
        if (!next || !next.preview) {
          setPhase({ kind: "review" });
          return;
        }
        setDraft(next.draft);
        setPreview(next.preview);
        useReview = buildReview(next.draft.lines, next.preview);
        usePreview = next.preview;
        setExcluded(new Set());
      }
      const res = await fetch("/api/restaurant/fixed-costs/upload/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody(useReview, usePreview, choices, key)),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Something changed (or an overlap appeared): nothing was written.
        setError(String(body.error ?? r.staleReload));
        const again = await fetch("/api/restaurant/fixed-costs/upload");
        const j = again.ok ? await again.json().catch(() => null) : null;
        if (j?.draft) {
          setDraft(j.draft as Draft);
          setPreview((j.preview as UploadPreview | null) ?? null);
        }
        commandKey.current = crypto.randomUUID();
        setPhase({ kind: "review" });
        return;
      }
      if (!res.ok) {
        setError(String(body.error ?? r.failed));
        setPhase({ kind: "review" });
        return;
      }
      const cats = (
        Array.isArray(body.categories) ? body.categories : []
      ) as ApprovedCategory[];
      const changedCats = cats.filter((c) => c.outcome !== "unchanged");
      const months = [...new Set(changedCats.map((c) => c.month))].sort();
      const commandId =
        typeof body.command_id === "string" &&
        Number(body.lines_approved ?? 0) > 0
          ? body.command_id
          : null;
      const saved = savedRows(cats);
      onApplied({
        changed: changedCats.map((c) => `${c.month}|${c.category}`),
        months,
        commandId,
        saved,
      });
      setDraft((body.draft as Draft) ?? null);
      setPreview(null);
      setPhase({
        kind: "done",
        months,
        // Said only when the database's own answer proves it.
        unchanged: monthUnchanged(month, locationId, cats),
        commandId,
        commandKey: key,
        saved,
      });
    } catch {
      setError(r.failed);
      setPhase({ kind: "review" });
    }
  }

  async function undo() {
    if (phase.kind !== "done" || !phase.commandId) return;
    try {
      const res = await fetch("/api/restaurant/fixed-costs/upload/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: phase.commandId,
          commandKey: crypto.randomUUID(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(body.error ?? r.failed));
        return;
      }
      setPhase({ kind: "undone" });
      onUndone();
    } catch {
      setError(r.failed);
    }
  }

  function scopeName(loc: string | null) {
    return loc ? (names.get(loc) ?? r.destination) : o.groupLabel;
  }
  const whereOf = (locs: ReadonlyArray<string | null>) =>
    [...new Set(locs.map((l) => l ?? ""))]
      .map((l) => scopeName(l || null))
      .join(", ");
  const whenOf = (months: readonly string[]) =>
    cap(
      [...new Set(months)]
        .sort()
        .map((m) => monthText(m, lang))
        .join(", ")
    );
  const monthName = (m: string) =>
    d.rentabilidad.months[Number(m.slice(5, 7)) - 1];

  /** The restaurant total a month would have after this review (window months only). */
  function resultingTotal(g: ReviewGroup): {
    amount: number;
    partial: boolean;
  } | null {
    if ((g.loc ?? null) !== (locationId ?? null)) return null;
    const m = overview.months.find((x) => x.month === g.month);
    if (!m) return null;
    let sum = 0;
    let known = 0;
    for (const c of AMOUNT_CATEGORIES) {
      const row = g.rows.find((x) => x.category === c);
      const v = row ? rowAfter(row, choices[row.key]) : m.cells[c].amount;
      if (v !== null && v !== undefined) {
        sum += v;
        known += 1;
      } else if (row) return null; // an undecided overlap: no total yet
    }
    return known === 0
      ? null
      : {
          amount: Math.round(sum * 100) / 100,
          partial: known < AMOUNT_CATEGORIES.length,
        };
  }

  const picker = (
    <>
      <input
        ref={input}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,image/*"
        className="sr-only"
        data-testid="import-input"
        aria-label={o.uploadButton}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        className={BTN_LIGHT}
        disabled={
          !canWrite || phase.kind === "reading" || phase.kind === "saving"
        }
        // In the group view the destination is asked FIRST; never assumed.
        onClick={() =>
          locationId === null ? setAsking(true) : input.current?.click()
        }
        data-testid="import-button"
      >
        {o.uploadButton}
      </button>
    </>
  );

  const scopeQuestion =
    asking && locationId === null ? (
      <fieldset
        data-testid="scope-question"
        className="order-last w-full basis-full space-y-3 rounded-xl border border-[#1B40C8] bg-white p-4"
      >
        <legend className="px-1 text-base font-bold text-[#151c2c]">
          {r.scopeQuestion}
        </legend>
        <p className="text-sm text-[#4a5266]">{r.scopeHint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {restaurants.map((x) => (
            <label
              key={x.id}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${dest === x.id ? "border-[#1B40C8] bg-[#E7EDFD] font-semibold" : "border-[#dfe3ea]"}`}
            >
              <input
                type="radio"
                name="fc-dest"
                checked={dest === x.id}
                onChange={() => setDest(x.id)}
                className="accent-[#1B40C8]"
              />
              {x.name}
            </label>
          ))}
          <label
            className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${dest === "group" ? "border-[#1B40C8] bg-[#E7EDFD] font-semibold" : "border-[#dfe3ea]"}`}
          >
            <input
              type="radio"
              name="fc-dest"
              checked={dest === "group"}
              onChange={() => setDest("group")}
              className="accent-[#1B40C8]"
            />
            <span>
              {o.groupLabel}
              <span className="block text-xs font-normal text-[#6b7385]">
                {r.scopeGroupHelp}
              </span>
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={dest === null}
            onClick={() => input.current?.click()}
            data-testid="scope-pick-file"
          >
            {r.scopePick}
          </button>
          <button
            type="button"
            className={BTN_LIGHT}
            onClick={() => {
              setAsking(false);
              setDest(null);
            }}
          >
            {r.cancel}
          </button>
        </div>
      </fieldset>
    ) : null;

  if (phase.kind === "idle" || phase.kind === "undone")
    return (
      <>
        <div className="space-y-2" data-testid="import">
          {picker}
          {phase.kind === "undone" ? (
            <p role="status" className="text-sm text-[#4a5266]">
              {r.undone}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[#b42318]">
              {error}
            </p>
          ) : null}
        </div>
        {scopeQuestion}
      </>
    );

  if (phase.kind === "reading")
    return (
      <div role="status" className="space-y-2" data-testid="import">
        {picker}
        <p className="text-sm text-[#4a5266]">{r.reading}</p>
      </div>
    );

  if (phase.kind === "done") {
    const here = locationId ?? null;
    const inView = phase.saved.filter((x) => x.loc === here);
    const elsewhere = phase.saved.filter((x) => x.loc !== here);
    const viewMonths = [...new Set(inView.map((x) => x.month))].sort();
    const off = viewMonths.filter((m) => !windowMonths.includes(m));
    // What the table shows NOW for a saved cell; undefined = outside the window.
    const shown = (x: SavedRow): number | null | undefined => {
      const m = overview.months.find((mm) => mm.month === x.month);
      if (!m) return undefined;
      if (x.category === "impuestos")
        return m.taxSource === "local" ? m.taxRate : null;
      return m.cells[x.category as AmountCategory].amount;
    };
    const mismatched = inView.filter((x) => {
      const a = shown(x);
      return a !== undefined && (a ?? null) !== (x.after ?? null);
    });
    const multi = new Set(phase.saved.map((x) => x.loc)).size > 1;
    return (
      <div
        role="status"
        data-testid="import-result"
        className="order-last w-full basis-full space-y-3 rounded-xl border border-[#1B40C8] bg-[#F8FAFF] p-4"
      >
        <h3 className="text-sm font-bold text-[#151c2c]">{r.doneTitle}</h3>
        {phase.saved.length > 0 ? (
          <>
            <p
              className="text-base font-bold text-[#1B40C8]"
              data-testid="saved-in"
            >
              {fmt(r.savedIn, {
                where: whereOf(phase.saved.map((x) => x.loc)),
                when: whenOf(phase.saved.map((x) => x.month)),
              })}
            </p>
            <ul className="space-y-0.5 text-sm" data-testid="saved-rows">
              {phase.saved.map((x) => (
                <li key={`${x.month}|${x.loc}|${x.category}`}>
                  <span className="text-[#6b7385]">
                    {cap(monthText(x.month, lang))}
                    {multi ? ` · ${scopeName(x.loc)}` : ""} ·{" "}
                  </span>
                  {fmt(r.savedRow, {
                    category: cat(x.category),
                    before:
                      x.before === null
                        ? r.nothingBefore
                        : money(x.before, x.category),
                    after: x.after === null ? "—" : money(x.after, x.category),
                  })}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-[#151c2c]">{r.nothingToChange}</p>
        )}
        {viewMonths.length > 0 ? (
          <p className="text-sm text-[#151c2c]">
            {fmt(r.doneChanged, { months: whenOf(viewMonths) })}{" "}
            {phase.unchanged
              ? fmt(r.doneUnchanged, { month: cap(monthText(month, lang)) })
              : null}
          </p>
        ) : null}
        {inView.length > 0 ? (
          refreshing ? (
            <p className="text-sm text-[#4a5266]" data-testid="table-status">
              {r.tableUpdating}
            </p>
          ) : mismatched.length > 0 ? (
            <div
              role="alert"
              data-testid="table-status"
              className="flex flex-wrap items-center gap-2 text-sm text-[#b42318]"
            >
              <span>{r.tableMismatch}</span>
              <button type="button" className={BTN_LIGHT} onClick={onRefresh}>
                {r.tableRefresh}
              </button>
            </div>
          ) : (
            <p className="text-sm text-[#4a5266]" data-testid="table-status">
              {r.tableMatches}
            </p>
          )
        ) : null}
        {elsewhere.length > 0 ? (
          <div
            data-testid="saved-elsewhere"
            className="space-y-2 rounded-lg bg-[#FEF3C7] p-3 text-sm text-[#0F172A]"
          >
            <p>
              {fmt(r.savedElsewhere, {
                view: scopeName(here),
                where: whereOf(elsewhere.map((x) => x.loc)),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {[...new Set(elsewhere.map((x) => x.loc ?? ""))].map((l) => (
                <button
                  key={l || "group"}
                  type="button"
                  className={BTN_LIGHT}
                  onClick={() => onViewDestination?.(l || null)}
                >
                  {fmt(r.viewDestination, { where: scopeName(l || null) })}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-[#6b7385]">
          {fmt(r.selectionKept, { month: cap(monthText(month, lang)) })}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-[#b42318]">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {off.length > 0 ? (
            <button
              type="button"
              className={BTN}
              onClick={() => onViewMonths(viewMonths)}
              data-testid="view-updated"
            >
              {r.viewUpdated}
            </button>
          ) : null}
          {phase.commandId ? (
            <button type="button" className={BTN_LIGHT} onClick={undo}>
              {r.undo}
            </button>
          ) : null}
          <button
            type="button"
            className={BTN_LIGHT}
            onClick={() => {
              setPhase({ kind: "idle" });
              onDismiss?.();
            }}
          >
            {r.dismiss}
          </button>
        </div>
      </div>
    );
  }

  // review | saving
  if (!review || !preview || !draft) return null;
  const pending = undecided(review, choices);
  const openLines = review.unresolved.filter((u) => !excluded.has(u.id));
  const hasRows = review.groups.some((g) => g.rows.length > 0);
  const lineCount = review.groups.flatMap((g) =>
    g.rows.flatMap((x) => x.lineIds)
  ).length;
  const saving = phase.kind === "saving";
  const where = whereOf(review.groups.map((g) => g.loc));
  const when = whenOf(review.groups.map((g) => g.month));
  const multiScope = new Set(review.groups.map((g) => g.loc)).size > 1;
  const reasonText = (
    b: NonNullable<Review["unresolved"][number]["blocker"]>
  ) =>
    ({
      amount: r.reasonAmount,
      month: r.reasonMonth,
      duplicate_tax: r.reasonDuplicateTax,
      other: r.reasonOther,
    })[b];
  const blocked =
    saving || busy || pending.length > 0 || openLines.length > 0 || !hasRows;

  return (
    <section
      aria-label={r.title}
      data-testid="import-review"
      className="order-last w-full basis-full space-y-4 rounded-xl border border-[#1B40C8] bg-white p-4 sm:p-5"
    >
      <header className="space-y-1">
        <h3 className="text-base font-bold text-[#151c2c]">{r.title}</h3>
        {hasRows ? (
          <p
            className="text-lg font-bold text-[#1B40C8]"
            data-testid="review-destination"
          >
            {fmt(r.destination, { restaurant: where })} · {when}
          </p>
        ) : null}
        {review.fileName ? (
          <p className="text-xs text-[#6b7385]">
            {fmt(r.file, { name: review.fileName })}
          </p>
        ) : null}
        {review.sameFileSeenBefore ? (
          <p className="text-xs text-[#4a5266]">{r.fileSeen}</p>
        ) : null}
        <p className="text-xs text-[#6b7385]">
          {fmt(r.summary, {
            lines: lineCount,
            months: new Set(review.groups.map((g) => g.month)).size,
          })}
        </p>
      </header>

      {review.groups.map((g) => {
        const total = resultingTotal(g);
        const full = isFullStatement(g);
        return (
          <div
            key={`${g.month}|${g.loc ?? "group"}`}
            data-testid={`review-month-${g.month}`}
            className="space-y-2"
          >
            <h4 className="text-sm font-bold text-[#151c2c]">
              {cap(monthText(g.month, lang))}
              {multiScope ? ` · ${scopeName(g.loc)}` : ""}
            </h4>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#dfe3ea] text-left text-xs text-[#6b7385]">
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    {o.category}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-semibold">
                    {r.before}
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    {r.after}
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => {
                  const after = rowAfter(row, choices[row.key]);
                  const same = row.kind === "noop";
                  const isTax = row.category === "impuestos";
                  return (
                    <tr
                      key={row.key}
                      className="border-b border-[#eef0f4] align-top"
                      data-testid={`review-row-${g.month}-${row.category}`}
                    >
                      <th
                        scope="row"
                        className="py-2 pr-3 text-left font-semibold text-[#151c2c]"
                      >
                        {cat(row.category)}
                        {row.incomingLines.length > 1 ? (
                          <ul className="mt-1 text-xs font-normal text-[#6b7385]">
                            {row.incomingLines.map((l) => (
                              <li key={l.id}>
                                {l.raw.split(" · ")[0]} ·{" "}
                                {money(l.cents / 100, row.category)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </th>
                      <td className="py-2 pr-3 text-[#4a5266]">
                        {row.before === null
                          ? r.nothingBefore
                          : money(row.before, row.category)}
                        {row.existing.length > 0 &&
                        row.detail === "legacy_total" ? (
                          <p className="text-xs text-[#6b7385]">
                            {r.existingNoDetail}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2">
                        {same ? (
                          <>
                            <span className="text-[#4a5266]">{r.same}</span>
                            <p className="text-xs text-[#6b7385]">
                              {r.exactAgain}
                            </p>
                          </>
                        ) : row.needsChoice ? (
                          <fieldset className="space-y-1.5">
                            <legend className="text-xs text-[#4a5266]">
                              {fmt(r.overlapQuestion, {
                                category: cat(row.category),
                                before: money(row.before ?? 0, row.category),
                                incoming: money(
                                  row.afterIfReplace,
                                  row.category
                                ),
                              })}
                            </legend>
                            {(["replace", "add"] as const).map((choice) =>
                              isTax && choice === "add" ? null : (
                                <label
                                  key={choice}
                                  className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm ${
                                    choices[row.key] === choice
                                      ? "border-[#1B40C8] bg-[#E7EDFD]"
                                      : choice === "replace" && full
                                        ? "border-[#1B40C8]"
                                        : "border-[#dfe3ea]"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`choice-${row.key}`}
                                    checked={choices[row.key] === choice}
                                    onChange={() =>
                                      setChoices((c) => ({
                                        ...c,
                                        [row.key]: choice,
                                      }))
                                    }
                                    disabled={saving}
                                    className="mt-0.5 accent-[#1B40C8]"
                                  />
                                  <span>
                                    {choice === "replace"
                                      ? isTax
                                        ? fmt(r.choiceTax, {
                                            before: money(
                                              row.before ?? 0,
                                              row.category
                                            ),
                                            incoming: money(
                                              row.afterIfReplace,
                                              row.category
                                            ),
                                          })
                                        : fmt(r.choiceReplace, {
                                            category: cat(row.category),
                                            month: monthName(g.month),
                                            before: money(row.before ?? 0),
                                            incoming: money(row.afterIfReplace),
                                          })
                                      : fmt(r.choiceAdd, {
                                          incoming: money(row.afterIfReplace),
                                          before: money(row.before ?? 0),
                                          total: money(row.afterIfAdd),
                                        })}
                                    {choice === "replace" && full ? (
                                      <span className="mt-0.5 block text-xs font-semibold text-[#1B40C8]">
                                        {r.recommended}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              )
                            )}
                            {!choices[row.key] ? (
                              <p className="text-xs font-semibold text-[#151c2c]">
                                {fmt(r.choiceNeeded, {
                                  category: cat(row.category),
                                })}
                              </p>
                            ) : null}
                          </fieldset>
                        ) : (
                          <span className="font-semibold text-[#151c2c]">
                            {money(after ?? 0, row.category)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {total ? (
              <p
                className="text-sm font-semibold text-[#151c2c]"
                data-testid={`review-total-${g.month}`}
              >
                {fmt(total.partial ? r.resultingPartial : r.resultingTotal, {
                  amount: money(total.amount),
                })}
              </p>
            ) : null}
          </div>
        );
      })}

      {review.unresolved.length > 0 ? (
        <div
          data-testid="review-unresolved"
          className="space-y-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3"
        >
          <div>
            <h4 className="text-sm font-bold text-[#0F172A]">
              {r.unclearTitle}
            </h4>
            <p className="text-xs text-[#0F172A]">{r.unclearIntro}</p>
          </div>
          <ul className="space-y-3">
            {review.unresolved.map((u) => {
              const out = excluded.has(u.id);
              return (
                <li
                  key={u.id}
                  data-testid={`unclear-${u.id}`}
                  className={`space-y-2 rounded-md bg-white p-3 ${out ? "opacity-70" : ""}`}
                >
                  <p className="text-sm font-semibold text-[#151c2c]">
                    {u.raw.split(" · ")[0]}
                    {u.amount !== null ? ` · ${money(u.amount)}` : ""}
                  </p>
                  {u.blocker ? (
                    <p className="text-xs text-[#4a5266]">
                      {fmt(r.onlyExclude, { reason: reasonText(u.blocker) })}
                    </p>
                  ) : null}
                  {!u.blocker && !out && u.missingCategory ? (
                    <div
                      role="group"
                      aria-label={`${r.pickCategory}: ${u.raw.split(" · ")[0]}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-xs font-semibold text-[#4a5266]">
                        {r.pickCategory}
                      </span>
                      {ASSIGNABLE.map((c: AssignableCategory) => (
                        <button
                          key={c}
                          type="button"
                          disabled={busy || saving}
                          onClick={() =>
                            void assign({ lineId: u.id, category: c })
                          }
                          data-testid={`pick-${u.id}-${c}`}
                          className={`min-h-[36px] rounded-lg border px-3 text-sm font-semibold ${
                            u.suggested === c
                              ? "border-[#1B40C8] bg-[#E7EDFD] text-[#1B40C8]"
                              : "border-[#dfe3ea] text-[#151c2c] hover:bg-[#F1F4F9]"
                          }`}
                        >
                          {cat(c)}
                          {u.suggested === c ? (
                            <span className="ml-1 text-xs font-normal">
                              · {r.suggested}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!u.blocker && !out && u.missingRestaurant ? (
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-xs font-semibold text-[#4a5266]">
                        {o.restaurantLabel}
                      </span>
                      <select
                        defaultValue=""
                        disabled={busy || saving}
                        aria-label={`${r.pickRestaurant}: ${u.raw.split(" · ")[0]}`}
                        data-testid={`restaurant-${u.id}`}
                        onChange={(e) => {
                          if (e.target.value)
                            void assign({
                              lineId: u.id,
                              scope: {
                                kind: "restaurant",
                                locationId: e.target.value,
                              },
                            });
                        }}
                        className="min-h-[36px] rounded-lg border border-[#dfe3ea] bg-white px-2 text-sm"
                      >
                        <option value="" disabled>
                          {r.pickRestaurant}
                        </option>
                        {restaurants.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExclude(u.id)}
                      aria-pressed={out}
                      disabled={saving}
                      data-testid={`exclude-${u.id}`}
                      className="min-h-[36px] rounded-lg border border-[#dfe3ea] px-3 text-sm font-semibold text-[#151c2c] hover:bg-[#F1F4F9]"
                    >
                      {out ? r.include : r.exclude}
                    </button>
                    {out ? (
                      <span className="text-xs text-[#4a5266]">
                        {r.excludedLine}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!hasRows ? (
        <p className="text-sm text-[#4a5266]">{r.nothingToChange}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN}
          disabled={blocked}
          onClick={confirm}
          data-testid="review-confirm"
        >
          {saving
            ? r.saving
            : hasRows
              ? fmt(r.confirmTo, { where, when })
              : r.confirm}
        </button>
        <button
          type="button"
          className={BTN_LIGHT}
          disabled={saving}
          onClick={() => setPhase({ kind: "idle" })}
        >
          {r.cancel}
        </button>
        {busy ? (
          <span className="text-xs text-[#4a5266]">{r.updatingTotals}</span>
        ) : openLines.length > 0 ? (
          <span className="text-xs text-[#151c2c]">{r.waitingLines}</span>
        ) : pending.length > 0 ? (
          <span className="text-xs text-[#151c2c]">{r.confirmWaiting}</span>
        ) : null}
      </div>
      {excluded.size > 0 ? (
        <p className="text-xs text-[#6b7385]" data-testid="excluded-note">
          {fmt(r.excludedNote, { n: excluded.size })}
        </p>
      ) : null}
    </section>
  );
}
