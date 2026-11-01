"use client";

// «Merma de cocina» (kitchen buffer) per restaurant, on Costos. Shows the %
// in force today («5 % (predeterminado)» when no saved row applies) and, for
// owner / admin / manager only, one tap to change it (0–30) with the choice
// «Solo desde hoy» / «También meses anteriores». Everyone else reads it only.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  formatTypedNumber,
  parseLocaleNumber,
} from "@/lib/restaurant/locale-number";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface BufferLine {
  locationId: string;
  name: string;
  bufferPct: number;
  isDefault: boolean;
}

export function bufferPctText(n: number, lang: PreferredLanguage): string {
  const v = formatTypedNumber(n, lang);
  return lang === "en" ? `${v}%` : `${v} %`;
}

function Row({
  line,
  showName,
  canEdit,
}: {
  line: BufferLine;
  showName: boolean;
  canEdit: boolean;
}) {
  const { d, lang, fmt } = useT();
  const b = d.costs.buffer;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(formatTypedNumber(line.bufferPct, lang));
  const [scope, setScope] = useState<"today" | "all">("today");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseLocaleNumber(text, lang);
    if (!parsed.ok || parsed.value === null || parsed.value > 30) {
      setError(b.invalid);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/restaurant/kitchen-buffer", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId: line.locationId,
          bufferPct: parsed.value,
          scope,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? b.saveFailed);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(b.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="min-w-0 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showName ? (
          <span className="text-[13px] font-semibold text-[#0F172A]">
            {line.name}
          </span>
        ) : null}
        <span className="text-[14px] text-[#0F172A]">
          {fmt(b.line, { pct: bufferPctText(line.bufferPct, lang) })}
          {line.isDefault ? (
            <span className="ml-1.5 text-[12px] text-[#6b7385]">
              {b.defaultTag}
            </span>
          ) : null}
        </span>
        {canEdit && !open ? (
          <button
            type="button"
            onClick={() => {
              setText(formatTypedNumber(line.bufferPct, lang));
              setOpen(true);
            }}
            className="text-[13px] font-semibold text-[#1B40C8] underline"
          >
            {b.change}
          </button>
        ) : null}
      </div>
      {canEdit && open ? (
        <div className="mt-2 min-w-0 space-y-2 rounded-[12px] border border-[#dbe3f7] bg-[#F6F8FE] p-3">
          <label className="block text-[12px] font-semibold text-[#4a5a85]">
            {b.pctLabel}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              className="mt-1 block w-full min-w-0 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-2 text-[14px] font-bold text-[#1b2333] outline-none focus:border-[#1B40C8] sm:max-w-[10rem]"
            />
          </label>
          <fieldset className="space-y-1">
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
                  name={`buffer-scope-${line.locationId}`}
                  checked={scope === id}
                  onChange={() => setScope(id)}
                  className="accent-[#1B40C8]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p
              role="alert"
              className="text-[12px] font-semibold text-[#1B40C8]"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-[9px] bg-[#1B40C8] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {saving ? b.saving : b.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1B40C8]"
            >
              {b.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function KitchenBufferCard({
  lines,
  canEdit,
}: {
  lines: BufferLine[];
  canEdit: boolean;
}) {
  const { d } = useT();
  const b = d.costs.buffer;
  if (lines.length === 0) return null;
  return (
    <section
      aria-label={b.pctLabel}
      data-testid="kitchen-buffer"
      className="min-w-0 rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3"
    >
      <ul className="divide-y divide-[#eef1f8]">
        {lines.map((l) => (
          <Row
            key={l.locationId}
            line={l}
            showName={lines.length > 1}
            canEdit={canEdit}
          />
        ))}
      </ul>
      <p className="mt-1 text-[12px] text-[#8a92a3]">
        {b.help}
        {canEdit ? "" : ` ${b.readOnly}`}
      </p>
    </section>
  );
}
