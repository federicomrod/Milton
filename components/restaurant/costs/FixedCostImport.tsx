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
  approvalBody,
  buildReview,
  monthUnchanged,
  rowAfter,
  undecided,
  type OverlapChoice,
  type Review,
  type ReviewGroup,
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
}

export interface ImportApplied {
  /** `month|category` of every cell the command changed. */
  changed: string[];
  months: string[];
  commandId: string | null;
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
    form.set("location_id", locationId ?? "");
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

  async function confirm() {
    if (!review || !preview) return;
    setError(null);
    setPhase({ kind: "saving" });
    const key = commandKey.current;
    try {
      const res = await fetch("/api/restaurant/fixed-costs/upload/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody(review, preview, choices, key)),
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
      onApplied({
        changed: changedCats.map((c) => `${c.month}|${c.category}`),
        months,
        commandId,
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
        onClick={() => input.current?.click()}
        data-testid="import-button"
      >
        {o.uploadButton}
      </button>
    </>
  );

  if (phase.kind === "idle" || phase.kind === "undone")
    return (
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
    );

  if (phase.kind === "reading")
    return (
      <div role="status" className="space-y-2" data-testid="import">
        {picker}
        <p className="text-sm text-[#4a5266]">{r.reading}</p>
      </div>
    );

  if (phase.kind === "done") {
    const off = phase.months.filter((m) => !windowMonths.includes(m));
    return (
      <div
        role="status"
        data-testid="import-result"
        className="order-last w-full basis-full space-y-3 rounded-xl border border-[#1B40C8] bg-[#F8FAFF] p-4"
      >
        <h3 className="text-sm font-bold text-[#151c2c]">{r.doneTitle}</h3>
        <p className="text-sm text-[#151c2c]">
          {phase.months.length > 0
            ? fmt(r.doneChanged, {
                months: cap(
                  phase.months.map((m) => monthText(m, lang)).join(", ")
                ),
              })
            : r.nothingToChange}{" "}
          {phase.months.length > 0 && phase.unchanged
            ? fmt(r.doneUnchanged, { month: cap(monthText(month, lang)) })
            : null}
        </p>
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
              onClick={() => onViewMonths(phase.months)}
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
  const hasRows = review.groups.some((g) => g.rows.length > 0);
  const lineCount = review.groups.flatMap((g) =>
    g.rows.flatMap((x) => x.lineIds)
  ).length;
  const locs = new Set(review.groups.map((g) => g.loc));
  const singleScope = locs.size <= 1;
  const firstLoc = review.groups[0]?.loc ?? locationId;
  const saving = phase.kind === "saving";
  const left = review.unresolved.length;

  return (
    <section
      aria-label={r.title}
      data-testid="import-review"
      className="order-last w-full basis-full space-y-4 rounded-xl border border-[#1B40C8] bg-white p-4 sm:p-5"
    >
      <header className="space-y-1">
        <h3 className="text-base font-bold text-[#151c2c]">{r.title}</h3>
        {singleScope ? (
          <p
            className="text-lg font-bold text-[#1B40C8]"
            data-testid="review-destination"
          >
            {firstLoc
              ? fmt(r.destination, { restaurant: scopeName(firstLoc) })
              : r.destinationGroup}
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
        return (
          <div
            key={`${g.month}|${g.loc ?? "group"}`}
            data-testid={`review-month-${g.month}`}
            className="space-y-2"
          >
            <h4 className="text-sm font-bold text-[#151c2c]">
              {cap(monthText(g.month, lang))}
              {!singleScope ? ` · ${scopeName(g.loc)}` : ""}
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
                          <fieldset className="space-y-1">
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
                              row.category === "impuestos" &&
                              choice === "add" ? null : (
                                <label
                                  key={choice}
                                  className="flex items-center gap-2 text-sm"
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
                                    className="accent-[#1B40C8]"
                                  />
                                  {fmt(
                                    choice === "replace"
                                      ? r.choiceReplace
                                      : r.choiceAdd,
                                    {
                                      amount: money(
                                        choice === "replace"
                                          ? row.afterIfReplace
                                          : row.afterIfAdd,
                                        row.category
                                      ),
                                    }
                                  )}
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

      {left > 0 ? (
        <div
          data-testid="review-unresolved"
          className="space-y-1 rounded-lg bg-[#FEF3C7] p-3"
        >
          <h4 className="text-sm font-bold text-[#0F172A]">
            {r.unresolvedTitle}
          </h4>
          <p className="text-xs text-[#0F172A]">{r.unresolvedIntro}</p>
          <ul className="text-sm text-[#0F172A]">
            {review.unresolved.map((u) => (
              <li key={u.id}>
                {u.raw} ·{" "}
                {
                  {
                    category: r.reasonCategory,
                    amount: r.reasonAmount,
                    month: r.reasonMonth,
                    restaurant: r.reasonRestaurant,
                    duplicate_tax: r.reasonDuplicateTax,
                    other: r.reasonOther,
                  }[u.reason]
                }
              </li>
            ))}
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
          disabled={saving || !hasRows || pending.length > 0}
          onClick={confirm}
          data-testid="review-confirm"
        >
          {saving
            ? r.saving
            : left > 0
              ? fmt(r.confirmWithLeft, { n: left })
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
        {pending.length > 0 ? (
          <span className="text-xs text-[#151c2c]">{r.confirmWaiting}</span>
        ) : null}
      </div>
    </section>
  );
}
