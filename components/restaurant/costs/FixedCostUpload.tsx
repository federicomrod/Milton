"use client";

// components/restaurant/costs/FixedCostUpload.tsx
//
// #409 · «⇪ Subir archivo» in Costos fijos. A file (Excel/CSV, PDF or photo) is
// read into DRAFT lines that change nothing until approved. The review is
// inline: fix the category or amount of a line, approve all or one by one, or
// discard. A line Milton could not fully read keeps a ⚑ Falta tag (never
// dropped, never $0); a missing amount reads «Sin precio». Lines read by AI
// carry the lavender tag. Replacing a value that is already in the month asks
// first (old → new).

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  FIXED_COST_CATEGORIES,
  categoryLabel,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";
import {
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

export function FixedCostUpload({
  month,
  locationId,
  currency,
  locationNames,
}: {
  /** The month on screen (YYYY-MM-01): the default for lines without one. */
  month: string;
  /** null = the group's shared costs. */
  locationId: string | null;
  currency: string;
  /** id → name, to say where a line goes. */
  locationNames: Record<string, string>;
}) {
  const { d, lang, locale, fmt } = useT();
  const t = d.costs.fixedUpload;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OverwriteConflict[]>([]);
  const [pending, setPending] = useState<string[] | undefined>(undefined);

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
    };
  }, []);

  async function call(
    url: string,
    init: RequestInit
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setNote(null);
    setConflicts([]);
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

  async function patch(payload: Record<string, unknown>) {
    if (!draft) return;
    const { status, body } = await call("/api/restaurant/fixed-costs/upload", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, ...payload }),
    });
    if (status === 200 && body.draft) {
      const next = body.draft as Draft;
      setDraft(next.status === "draft" ? next : null);
    } else setError(String(body.error ?? t.errSave));
  }

  async function approve(lineIds?: string[], confirmed?: string[]) {
    if (!draft) return;
    setNote(null);
    const { status, body } = await call(
      "/api/restaurant/fixed-costs/upload/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, lineIds, confirmed }),
      }
    );
    if (status === 409 && Array.isArray(body.conflicts)) {
      setConflicts(body.conflicts as OverwriteConflict[]);
      setPending(lineIds);
      return;
    }
    if (status === 200 && body.draft) {
      const next = body.draft as Draft;
      setConflicts([]);
      setDraft(next.status === "draft" ? next : null);
      setNote(
        Number(body.approved) > 0
          ? fmt(t.approved, { n: Number(body.approved) })
          : t.nothingApproved
      );
      router.refresh();
    } else setError(String(body.error ?? t.errSave));
  }

  const lines = draft?.lines.filter((l) => l.status === "pending") ?? [];
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
  const money = (c: FixedCostCategory, n: number) =>
    c === "impuestos" ? `${n}%` : formatMoney(n, currency, lang);

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

      {draft && lines.length > 0 ? (
        <section
          data-testid="upload-review"
          className="min-w-0 rounded-xl border border-[#dbe3f7] bg-white p-4"
        >
          <h3 className="text-[15px] font-bold text-[#0F172A]">{t.title}</h3>
          <p className="mt-1 text-sm text-[#4a5a85]">{t.intro}</p>
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

          <ul className="mt-3 space-y-3">
            {lines.map((l) => (
              <LineRow
                key={`${l.id}-${l.category}-${l.amount}`}
                line={l}
                busy={busy}
                where={where(l)}
                monthText={monthText(l)}
                onCommit={(edit) =>
                  void patch({ edits: [{ lineId: l.id, ...edit }] })
                }
                onApprove={() => void approve([l.id])}
                onDiscard={() =>
                  void patch({ edits: [{ lineId: l.id, discard: true }] })
                }
              />
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void approve()}
              className={BTN}
            >
              {t.approveAll}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ discardAll: true })}
              className={LINK}
            >
              {t.discardAll}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LineRow(props: {
  line: DraftLine;
  busy: boolean;
  where: string;
  monthText: string;
  onCommit: (edit: {
    category?: FixedCostCategory | null;
    amount?: number | null;
  }) => void;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const { d, lang } = useT();
  const t = d.costs.fixedUpload;
  const { line } = props;
  const issues = issuesOf(line);
  const [amount, setAmount] = useState(
    line.amount === null ? "" : formatTypedNumber(line.amount, lang)
  );
  const isTax = line.category === "impuestos";
  return (
    <li
      data-testid="upload-line"
      className="min-w-0 rounded-lg border border-[#eef0f4] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-semibold text-[#0F172A]">
          {line.raw || "—"}
        </span>
        {line.from === "ai" ? <span className={AI_PILL}>{t.aiTag}</span> : null}
        {issues.length > 0 ? (
          <span className={ALERT_PILL}>{d.costs.fixed.missing}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-[#6b7385]">
        {[props.monthText, props.where].filter(Boolean).join(" · ")}
      </p>
      {issues.length > 0 ? (
        <p className="mt-1 text-[12px] text-[#4a5a85]">{t.unrecognized}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={line.category ?? ""}
          aria-label={t.pickCategory}
          onChange={(e) =>
            props.onCommit({
              category: (e.target.value || null) as FixedCostCategory | null,
            })
          }
          className={FIELD}
        >
          <option value="">{t.pickCategory}</option>
          {FIXED_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c, lang)}
            </option>
          ))}
        </select>
        <input
          value={amount}
          inputMode="decimal"
          aria-label={isTax ? t.rateLabel : t.amountLabel}
          placeholder={t.noPrice}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const p = parseLocaleNumber(amount, lang);
            if (!amount.trim()) return;
            if (p.ok && p.value !== null && p.value > 0)
              props.onCommit({ amount: p.value });
          }}
          className={FIELD + " w-28 text-right"}
        />
        {line.amount === null ? (
          <span className={ALERT_PILL}>{t.noPrice}</span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={props.busy || issues.length > 0}
          onClick={props.onApprove}
          className={BTN}
        >
          {t.approveLine}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onDiscard}
          className={LINK}
        >
          {t.discardLine}
        </button>
      </div>
    </li>
  );
}
