"use client";

// One «merma» value with history (#406): the kitchen buffer of a restaurant
// and the yield of an ingredient share this. Read-only unless `canEdit`; one
// tap on «Cambiar» opens the value (range-checked), the choice «Solo desde
// hoy» / «Aplicar a semanas anteriores» and, for the retroactive choice, the
// confirmation «Esto cambia el costo de los meses anteriores. ¿Continuar?».
// Under it, a compact «Historial» built from the rows (date, who, old → new,
// desde hoy / retroactivo). Nothing here deletes or edits a past row.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  formatTypedNumber,
  parseLocaleNumber,
} from "@/lib/restaurant/locale-number";
import { pctText } from "@/lib/restaurant/merma-format";
import type { HistoryLine } from "@/lib/restaurant/kitchen-buffer-server";

export type MermaScope = "today" | "all";

export interface MermaStrings {
  change: string;
  pctLabel: string;
  invalid: string;
  saveFailed: string;
}

export function MermaField({
  endpoint,
  buildBody,
  valueNode,
  currentPct,
  max,
  canEdit,
  history,
  strings,
  idPrefix,
  placeholder,
}: {
  endpoint: string;
  /** The JSON body of the PUT for a value and a scope. */
  buildBody: (pct: number, scope: MermaScope) => Record<string, unknown>;
  /** What is shown today («Merma de cocina: 5 % (predeterminado)»). */
  valueNode: React.ReactNode;
  currentPct: number | null;
  /** The largest value allowed (30 for the buffer, 99.99 for a yield). */
  max: number;
  canEdit: boolean;
  history: HistoryLine[];
  strings: MermaStrings;
  idPrefix: string;
  placeholder?: string;
}) {
  const { d, lang, locale } = useT();
  const b = d.costs.buffer;
  const router = useRouter();
  const [step, setStep] = useState<"view" | "edit" | "confirm">("view");
  const [text, setText] = useState(
    currentPct === null ? "" : formatTypedNumber(currentPct, lang)
  );
  const [scope, setScope] = useState<MermaScope>("today");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = () => {
    const p = parseLocaleNumber(text, lang);
    return p.ok && p.value !== null && p.value >= 0 && p.value <= max
      ? p.value
      : null;
  };

  async function send(value: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody(value, scope)),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? strings.saveFailed);
        setStep("edit");
        return;
      }
      setStep("view");
      router.refresh();
    } catch {
      setError(strings.saveFailed);
      setStep("edit");
    } finally {
      setSaving(false);
    }
  }

  function onSave() {
    const v = parsed();
    if (v === null) {
      setError(strings.invalid);
      return;
    }
    setError(null);
    // The past changes: ask first.
    if (scope === "all") setStep("confirm");
    else void send(v);
  }

  const dateText = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const whoText = (h: HistoryLine) => (h.isSupport ? b.milton : (h.who ?? "—"));

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {valueNode}
        {canEdit && step === "view" ? (
          <button
            type="button"
            onClick={() => {
              setText(
                currentPct === null ? "" : formatTypedNumber(currentPct, lang)
              );
              setScope("today");
              setError(null);
              setStep("edit");
            }}
            className="text-[13px] font-semibold text-[#1B40C8] underline"
          >
            {strings.change}
          </button>
        ) : null}
      </div>

      {canEdit && step !== "view" ? (
        <div className="mt-2 min-w-0 space-y-2 rounded-[12px] border border-[#dbe3f7] bg-[#F6F8FE] p-3">
          <label className="block text-[12px] font-semibold text-[#4a5a85]">
            {strings.pctLabel}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              placeholder={placeholder}
              disabled={step === "confirm"}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              className="mt-1 block w-full min-w-0 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-2 text-[14px] font-bold text-[#1b2333] outline-none focus:border-[#1B40C8] sm:max-w-[10rem]"
            />
          </label>
          <fieldset className="space-y-1" disabled={step === "confirm"}>
            {(
              [
                ["today", b.scopeToday],
                ["all", b.scopeAll],
              ] as const
            ).map(([id, label]) => (
              <label
                key={id}
                className="flex items-center gap-2 text-[13px] text-[#0F172A]"
              >
                <input
                  type="radio"
                  name={`${idPrefix}-scope`}
                  checked={scope === id}
                  onChange={() => setScope(id)}
                  className="accent-[#1B40C8]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {step === "confirm" ? (
            <p
              role="alertdialog"
              data-testid="retro-confirm"
              className="rounded-[9px] bg-white p-2 text-[13px] font-semibold text-[#0F172A]"
            >
              {b.confirmRetro}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="text-[12px] font-semibold text-[#1B40C8]"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {step === "confirm" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const v = parsed();
                    if (v !== null) void send(v);
                  }}
                  disabled={saving}
                  className="rounded-[9px] bg-[#1B40C8] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {saving ? b.saving : b.confirmYes}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("edit")}
                  className="rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1B40C8]"
                >
                  {b.confirmBack}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="rounded-[9px] bg-[#1B40C8] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {saving ? b.saving : b.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("view");
                    setError(null);
                  }}
                  className="rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1B40C8]"
                >
                  {b.cancel}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-2 min-w-0" data-testid="merma-history">
          <p className="text-[12px] font-semibold text-[#4a5a85]">
            {b.history}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {history.slice(0, 6).map((h) => (
              <li
                key={h.id}
                className="break-words text-[12px] leading-snug text-[#6b7385]"
                title={h.effectiveFrom}
              >
                {dateText(h.createdAt)} · {whoText(h)} ·{" "}
                {h.oldPct === null ? "—" : pctText(h.oldPct, lang)} →{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pctText(h.newPct, lang)}
                </span>{" "}
                · {h.kind === "retroactive" ? b.kindRetro : b.kindToday}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
