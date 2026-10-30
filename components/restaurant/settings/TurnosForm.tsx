"use client";

// R1-17a (mock 3): Configuración › Turnos. Per restaurant: a toggle, name,
// start/end and weekdays for each shift, a 24 h preview, and ONE primary
// button that saves them all (restaurant_shifts_save, migration 054). Every
// press of «Guardar turnos» answers: saved, nothing to save, or why not.

import { NOT_AVAILABLE_YET } from "@/lib/restaurant/ui-copy";
import { useEffect, useMemo, useRef, useState } from "react";
import { selectTicks } from "@/lib/restaurant/ui/axis-ticks";
import { useElementWidth } from "@/lib/restaurant/ui/use-element-width";
import { useRouter } from "next/navigation";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { fmt, getDictionary } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import {
  EditorButtons,
  useInlineEditor,
} from "@/components/restaurant/config/InlineEditCard";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  ALL_WEEKDAYS,
  crossingCutoff,
  cutoffMinutes,
  minutesToTime,
  timeToMinutes,
  validateShifts,
  type Shift,
} from "@/lib/restaurant/business-day";

export function weekdaysLabel(
  days: readonly number[],
  lang: PreferredLanguage = "es"
): string {
  const dict = getDictionary(lang);
  const DAY_LABEL = dict.common.weekdaysShort; // 1..7
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return dict.settings.shifts.allWeek;
  if (d.length === 0) return dict.settings.shifts.noDays;
  const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (contiguous && d.length > 2)
    return `${DAY_LABEL[d[0] - 1]}–${DAY_LABEL[d[d.length - 1] - 1]}`;
  return d.map((x) => DAY_LABEL[x - 1]).join(", ");
}

/** `<input type="time">` cannot show 24:00; an end at midnight is 00:00. */
const forInput = (t: string) => (t === "24:00" ? "00:00" : t);

interface Draft extends Shift {
  key: string;
}

export interface TurnosFormProps {
  restaurants: Array<{ id: string; name: string }>;
  shiftsByRestaurant: Record<string, Shift[]>;
  /** Migration 054 applied. */
  available: boolean;
  canEdit: boolean;
}

let counter = 0;
const draftsOf = (shifts: Shift[] | undefined): Draft[] =>
  (shifts ?? []).map((s) => ({
    ...s,
    end_time: forInput(s.end_time),
    key: `k${(counter += 1)}`,
  }));

const sameShifts = (a: Draft[], b: Shift[] | undefined) =>
  JSON.stringify(a.map(({ key: _k, id: _i, sort_order: _s, ...r }) => r)) ===
  JSON.stringify(
    (b ?? []).map(({ id: _i, sort_order: _s, ...r }) => ({
      ...r,
      end_time: forInput(r.end_time),
    }))
  );

export function TurnosForm(props: TurnosFormProps) {
  const { available, canEdit, restaurants } = props;
  const { d, lang } = useT();
  const ds = d.settings.shifts;
  const DAY_LABEL = d.common.weekdaysShort;
  const router = useRouter();
  const editor = useInlineEditor();
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>(() =>
    Object.fromEntries(
      restaurants.map((r) => [r.id, draftsOf(props.shiftsByRestaurant[r.id])])
    )
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; message: string }
    | { kind: "info"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const rows = drafts[restaurantId] ?? [];
  const setRows = (next: Draft[]) =>
    setDrafts((d) => ({ ...d, [restaurantId]: next }));
  const patch = (key: string, p: Partial<Draft>) => {
    setStatus({ kind: "idle" });
    setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  const disabled = !available || !canEdit || saving;
  const cutoff = useMemo(() => cutoffMinutes(rows), [rows]);
  const check = useMemo(() => validateShifts(rows), [rows]);
  const activeCount = rows.filter((r) => r.active).length;
  const dirty = !sameShifts(rows, props.shiftsByRestaurant[restaurantId]);

  // Unsaved edits warn before leaving the page.
  useEffect(() => {
    editor.setDirty(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function save() {
    if (!available) {
      setStatus({
        kind: "error",
        message: NOT_AVAILABLE_YET,
      });
      return;
    }
    if (!canEdit) {
      setStatus({
        kind: "error",
        message: d.settings.noEditShifts,
      });
      return;
    }
    if (!check.ok) {
      setStatus({ kind: "error", message: check.message });
      return;
    }
    if (!dirty) {
      setStatus({ kind: "info", message: ds.noChanges });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/restaurant/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          shifts: rows.map(({ key: _k, id: _i, sort_order: _s, ...r }) => r),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        cutoff?: string;
      };
      if (!res.ok) throw new Error(userErrorMessage(json, ds.saveFailed));
      const message = fmt(ds.saved, {
        cutoff: json.cutoff ?? minutesToTime(cutoff),
      });
      setStatus({ kind: "ok", message });
      editor.saved(message);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : ds.saveFailed;
      setStatus({ kind: "error", message });
      editor.failed(message);
    } finally {
      setSaving(false);
    }
  }

  const input =
    "h-8 rounded-lg border border-[#E5E7EB] bg-white px-2 text-[13px] text-[#151c2c] outline-none focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20 disabled:bg-[#f4f6fb] disabled:text-[#8a92a3]";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid grid-cols-1 gap-[14px]"
    >
      <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-[14px] font-bold">{ds.title}</h2>
          <label
            hidden={restaurants.length < 2}
            className="ml-auto inline-flex items-center gap-2 text-[12px] text-[#4a5a85]"
          >
            {ds.restaurant}
            <select
              aria-label={ds.restaurant}
              value={restaurantId}
              onChange={(e) => {
                setRestaurantId(e.target.value);
                setStatus({ kind: "idle" });
              }}
              className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-[13px] font-semibold outline-none focus:border-[#1b40c8]"
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!available ? (
          <p
            role="status"
            className="mb-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-[13px]"
          >
            {NOT_AVAILABLE_YET} {ds.unavailableNote}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="border-t border-[#eef0f4] py-3 text-[13px] text-[#6b7385]">
            {ds.noShifts}
          </p>
        ) : null}
        {rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-[110px_1fr] items-center gap-2.5 border-t border-[#eef0f4] py-2.5 text-[13px]"
          >
            <input
              aria-label={ds.shiftName}
              value={r.name}
              disabled={disabled}
              maxLength={40}
              onChange={(e) => patch(r.key, { name: e.target.value })}
              className={`${input} font-bold`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={r.active}
                aria-label={fmt(ds.active, { name: r.name || ds.shiftDefault })}
                disabled={disabled}
                onClick={() => patch(r.key, { active: !r.active })}
                className={`relative h-[19px] w-[34px] rounded-full transition ${r.active ? "bg-[#1b40c8]" : "bg-[#c9ced8]"}`}
              >
                <span
                  className={`absolute top-[2px] h-[15px] w-[15px] rounded-full bg-white transition-all ${r.active ? "left-[17px]" : "left-[2px]"}`}
                />
              </button>
              {r.active ? (
                <>
                  <input
                    type="time"
                    aria-label={ds.start}
                    value={r.start_time}
                    disabled={disabled}
                    onChange={(e) =>
                      patch(r.key, { start_time: e.target.value })
                    }
                    className={input}
                  />
                  <span>{ds.to}</span>
                  <input
                    type="time"
                    aria-label={ds.end}
                    value={r.end_time}
                    disabled={disabled}
                    onChange={(e) => patch(r.key, { end_time: e.target.value })}
                    className={input}
                  />
                  <details className="relative">
                    <summary className="cursor-pointer list-none text-[12px] text-[#6b7385]">
                      {weekdaysLabel(r.weekdays, lang)} ▾
                    </summary>
                    <div className="absolute z-10 mt-1 flex gap-1.5 rounded-lg border border-[#E5E7EB] bg-white p-2 shadow-md">
                      {ALL_WEEKDAYS.map((d) => (
                        <label
                          key={d}
                          className="flex flex-col items-center gap-0.5 text-[11px]"
                        >
                          {DAY_LABEL[d - 1]}
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={r.weekdays.includes(d)}
                            onChange={(e) =>
                              patch(r.key, {
                                weekdays: e.target.checked
                                  ? [...r.weekdays, d].sort((a, b) => a - b)
                                  : r.weekdays.filter((x) => x !== d),
                              })
                            }
                            className="accent-[#1b40c8]"
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  {timeToMinutes(r.end_time) !== null &&
                  timeToMinutes(r.start_time) !== null &&
                  (timeToMinutes(r.end_time) as number) <=
                    (timeToMinutes(r.start_time) as number) &&
                  r.end_time !== "00:00" ? (
                    <span className="text-[11px] text-[#6b7385]">
                      {ds.crossesMidnight}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-[12px] text-[#8a92a3]">
                  {ds.disabled}
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                aria-label={fmt(ds.removeNamed, {
                  name: r.name || ds.removeDefault,
                })}
                className="ml-auto text-[12px] text-[#8a92a3] hover:text-[#0F172A]"
              >
                {ds.remove}
              </button>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[110px_1fr] gap-2.5 border-t border-[#eef0f4] py-2.5 text-[12px]">
          <span className="text-[#8a92a3]">{ds.outsideShift}</span>
          <span className="text-[#8a92a3]">{ds.outsideShiftNote}</span>
        </div>
        <button
          type="button"
          disabled={disabled || rows.length >= 12}
          onClick={() => {
            setStatus({ kind: "idle" });
            setRows([
              ...rows,
              {
                key: `k${(counter += 1)}`,
                name: "",
                start_time: "11:00",
                end_time: "17:00",
                weekdays: [...ALL_WEEKDAYS],
                active: true,
              },
            ]);
          }}
          className="text-[12px] font-semibold text-[#1b40c8] disabled:opacity-50"
        >
          {ds.add}
        </button>

        <Timeline shifts={rows.filter((r) => r.active)} />

        <p
          className="mt-2 text-[12px] text-[#6b7385]"
          data-testid="turnos-cutoff"
        >
          {ds.cutoffPrefix}
          <b>{minutesToTime(cutoff)}</b>
          {crossingCutoff(rows) !== null ? ds.cutoffCrossing : ds.cutoffDefault}
          {ds.cutoffSuffix}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {status.kind === "ok" || status.kind === "info" ? (
            <span role="status" className="text-[12px] text-[#64748B]">
              {status.message}
            </span>
          ) : null}
          {status.kind === "error" || !check.ok ? (
            <span
              role="alert"
              className="rounded-md border border-[#0F172A] px-2 py-1 text-[12px] text-[#0F172A]"
            >
              ⚑{" "}
              {status.kind === "error"
                ? status.message
                : check.ok
                  ? ""
                  : check.message}
            </span>
          ) : null}
        </div>
        <EditorButtons saving={saving} onCancel={editor.close} />
      </section>

      <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4 text-[13px]">
        <h2 className="text-[14px] font-bold">{ds.howTitle}</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12px] text-[#6b7385]">
          <li>{ds.how1}</li>
          <li>{ds.how2}</li>
          <li>{ds.how3}</li>
        </ul>
        <p
          className="mt-3 text-[12px] text-[#8a92a3]"
          data-testid="turnos-active-count"
        >
          {activeCount === 0
            ? ds.nowNone
            : activeCount === 1
              ? ds.nowOne
              : fmt(ds.nowMany, { n: activeCount })}
        </p>
      </section>
    </form>
  );
}

/** The 24 h bar: each active shift as a block; a shift across midnight wraps. */
// Each hour label sits at its real position (first left, last right, rest centred).
const HOUR_MARKS = [0, 6, 12, 18, 24];

function Timeline({ shifts }: { shifts: Shift[] }) {
  const { d } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const ticks = useMemo(
    () =>
      selectTicks({
        count: HOUR_MARKS.length,
        positionOf: (i) => (HOUR_MARKS[i] / 24) * width,
        labelOf: (i) => `${HOUR_MARKS[i]}:00`,
        width,
        fontSize: 11,
      }),
    [width]
  );
  const palette = ["#1b40c8", "#151c2c", "#6b8bea", "#3a4256"];
  const blocks: Array<{
    left: number;
    width: number;
    name: string;
    color: string;
    key: string;
  }> = [];
  shifts.forEach((s, i) => {
    const a = timeToMinutes(s.start_time);
    let b = timeToMinutes(s.end_time);
    if (a === null || b === null || a === b) return;
    if (b <= a) b += 1440;
    const color = palette[i % palette.length];
    const first = Math.min(b, 1440);
    blocks.push({
      left: (a / 1440) * 100,
      width: ((first - a) / 1440) * 100,
      name: s.name,
      color,
      key: `${i}a`,
    });
    if (b > 1440)
      blocks.push({
        left: 0,
        width: ((b - 1440) / 1440) * 100,
        name: "",
        color,
        key: `${i}b`,
      });
  });
  return (
    <div className="mt-3" aria-label={d.settings.shifts.timeline} ref={wrapRef}>
      <div className="relative h-[22px] rounded-md bg-[#f2f3f6]">
        {blocks.map((b) => (
          <div
            key={b.key}
            title={b.name || undefined}
            className="absolute inset-y-0 truncate rounded-md px-2 py-[3px] text-[11px] font-semibold text-white"
            style={{
              left: `${b.left}%`,
              width: `${b.width}%`,
              background: b.color,
            }}
          >
            {b.name}
          </div>
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-[#8a92a3]">
        {ticks.map((t) => (
          <span
            key={t.index}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: `${t.x}px`,
              transform:
                t.anchor === "start"
                  ? "none"
                  : t.anchor === "end"
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
