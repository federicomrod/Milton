"use client";

// R1-15c: the pieces every grouping screen shares (mocks 7 and 9): the
// Todos / Agrupados / Sin agrupar filter, the dark action bar, the
// "Agrupar como…" popover, the existing-group picker, the suggestion chip and
// the "Deshacer" toast. Presentation only: no number is computed here.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupToast } from "./use-item-groups";

export type GroupingFilterValue = "todos" | "agrupados" | "sin_agrupar";

export interface GroupOption {
  id: string;
  name: string;
  /** "Bebidas › Refrescos". */
  path: string;
}

const SEG_ON = "bg-[#1b40c8] text-white shadow-sm";
const SEG_OFF = "text-[#4a5a85] hover:text-[#1b40c8]";

/** One shared control: "Todos · N / Agrupados · N / Sin agrupar · N" with live counts. */
export function GroupingFilter({
  value,
  onChange,
  counts,
  note,
}: {
  value: GroupingFilterValue;
  onChange: (next: GroupingFilterValue) => void;
  counts: { all: number; grouped: number; ungrouped: number };
  /** Next to "Sin agrupar": "$4,120 en ventas sin agrupar · 4.6%". */
  note?: string | null;
}) {
  const items: Array<[GroupingFilterValue, string, number]> = [
    ["todos", "Todos", counts.all],
    ["agrupados", "Agrupados", counts.grouped],
    ["sin_agrupar", "Sin agrupar", counts.ungrouped],
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="grouping-filter"
    >
      <div
        role="group"
        aria-label="Filtro de agrupación"
        className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px]"
      >
        {items.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={
              "rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold " +
              (value === id ? SEG_ON : SEG_OFF)
            }
          >
            {label} · {n}
          </button>
        ))}
      </div>
      {note ? <span className="text-[13px] text-[#6b7385]">{note}</span> : null}
    </div>
  );
}

/** The dark bar that appears with a selection. */
export function GroupActionBar({
  count,
  summary,
  suggestionName,
  canUngroup,
  onAcceptSuggestion,
  onAddToExisting,
  onGroupAs,
  onUngroup,
  onMerge,
  onClear,
  busy,
}: {
  count: number;
  /** "$2,700 · 30 d". */
  summary?: string | null;
  /** When every selected row shares one suggestion. */
  suggestionName?: string | null;
  canUngroup?: boolean;
  onAcceptSuggestion?: () => void;
  onAddToExisting: () => void;
  onGroupAs: () => void;
  onUngroup?: () => void;
  /** Ingredientes: «Unir…» (two or more selected). */
  onMerge?: () => void;
  onClear: () => void;
  busy?: boolean;
}) {
  if (count === 0) return null;
  const primary =
    "rounded-lg bg-[#2f5be0] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1b40c8] disabled:opacity-60";
  const secondary =
    "rounded-lg border border-[#3a4660] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#26314a] disabled:opacity-60";
  return (
    <div
      role="region"
      aria-label="Acciones de agrupación"
      data-testid="group-action-bar"
      className="flex flex-wrap items-center gap-2 rounded-[10px] border-l-4 border-[#2f5be0] bg-[#151c2c] px-4 py-2.5 text-white"
    >
      <b className="text-[13px]">
        {count} {count === 1 ? "seleccionado" : "seleccionados"}
      </b>
      {summary ? (
        <span className="text-[13px] text-[#c9d0de]">{summary}</span>
      ) : null}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {suggestionName && onAcceptSuggestion ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAcceptSuggestion}
            className={primary}
          >
            Añadir a {suggestionName}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onAddToExisting}
          className={suggestionName ? secondary : primary}
        >
          Añadir a grupo existente…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onGroupAs}
          className={secondary}
        >
          Agrupar como…
        </button>
        {onMerge ? (
          <button
            type="button"
            disabled={busy}
            onClick={onMerge}
            className={secondary}
          >
            Unir…
          </button>
        ) : null}
        {canUngroup && onUngroup ? (
          <button
            type="button"
            disabled={busy}
            onClick={onUngroup}
            className={secondary}
          >
            Desagrupar
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClear}
          aria-label="Quitar la selección"
          className="px-2 text-[16px] text-[#c9d0de] hover:text-white"
        >
          ×
        </button>
      </span>
    </div>
  );
}

/** "Agrupar como…": the new group's name and where it goes. */
export function GroupAsPopover({
  parents,
  initialName = "",
  onCreate,
  onCancel,
}: {
  parents: readonly GroupOption[];
  initialName?: string;
  onCreate: (name: string, parentId: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <Overlay onClose={onCancel} label="Agrupar como">
      <h3 className="text-[15px] font-bold text-[#151c2c]">Agrupar como…</h3>
      <input
        ref={input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim())
            onCreate(name, parentId || null);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Nombre del grupo"
        aria-label="Nombre del grupo"
        className="mt-2 w-full rounded-lg border border-[#1b40c8] px-3 py-2 text-[14px] outline-none"
      />
      <label className="mt-3 block text-[12px] text-[#8a92a3]">
        Dentro de
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#dfe3ea] bg-white px-3 py-2 text-[14px] text-[#151c2c]"
        >
          <option value="">Ninguno (grupo principal)</option>
          {parents.map((g) => (
            <option key={g.id} value={g.id}>
              {g.path}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[12px]">
          Opcional: ponlo dentro de otro grupo, p. ej. Limonadas dentro de
          Bebidas.
        </span>
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[#dfe3ea] px-3.5 py-1.5 text-[13px] font-semibold"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onCreate(name, parentId || null)}
          className="rounded-lg bg-[#151c2c] px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          Crear grupo
        </button>
      </div>
    </Overlay>
  );
}

/** A searchable list of the existing groups. */
export function GroupPicker({
  title,
  options,
  onPick,
  onCancel,
  allowTop,
}: {
  title: string;
  options: readonly GroupOption[];
  onPick: (groupId: string | null) => void;
  onCancel: () => void;
  /** "Ninguno (grupo principal)" as a choice (moving a group out of its parent). */
  allowTop?: boolean;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => o.path.toLowerCase().includes(q))
      : options;
  }, [options, query]);
  return (
    <Overlay onClose={onCancel} label={title}>
      <h3 className="text-[15px] font-bold text-[#151c2c]">{title}</h3>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar grupo…"
        aria-label="Buscar grupo"
        className="mt-2 w-full rounded-lg border border-[#dfe3ea] px-3 py-2 text-[14px] outline-none focus:border-[#1B40C8]"
      />
      <ul className="mt-2 max-h-[280px] overflow-auto">
        {allowTop ? (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="w-full rounded-md px-3 py-2 text-left text-[14px] text-[#5b6476] hover:bg-[#f4f6fb]"
            >
              Ninguno (grupo principal)
            </button>
          </li>
        ) : null}
        {shown.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick(o.id)}
              className="w-full rounded-md px-3 py-2 text-left text-[14px] hover:bg-[#f4f6fb]"
            >
              {o.path}
            </button>
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-[#8a92a3]">
            No hay grupos con ese nombre.
          </li>
        ) : null}
      </ul>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[#dfe3ea] px-3.5 py-1.5 text-[13px] font-semibold"
        >
          Cancelar
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={label}
        className="w-[360px] rounded-xl border border-[#dfe3ea] bg-white p-4 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
      >
        {children}
      </div>
    </div>
  );
}

/** "✦ ¿Añadir a Churrasco Típico?" + ✓ (one click), or "Sin sugerencia". */
export function SuggestionChip({
  targetName,
  onAccept,
  busy,
}: {
  targetName: string | null;
  onAccept: () => void;
  busy?: boolean;
}) {
  if (!targetName) {
    return <span className="text-[13px] text-[#8a92a3]">Sin sugerencia</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full border border-dashed border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-0.5 text-[12px] font-semibold text-[#6b7280]">
        ✦ ¿Añadir a {targetName}?
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onAccept}
        aria-label={`Añadir a ${targetName}`}
        className="rounded-md border border-[#dfe3ea] bg-white px-1.5 py-0.5 text-[12px] font-bold text-[#151c2c] hover:border-[#1b40c8] disabled:opacity-50"
      >
        ✓
      </button>
    </span>
  );
}

/** The "Deshacer" toast (or an error that stays until dismissed). */
export function GroupToastView({
  toast,
  onDismiss,
}: {
  toast: GroupToast | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  return (
    <div
      role={toast.error ? "alert" : "status"}
      aria-live="polite"
      data-testid="group-toast"
      className={
        "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[10px] px-4 py-2.5 text-[13px] shadow-lg " +
        (toast.error ? "bg-[#c03535] text-white" : "bg-[#151c2c] text-white")
      }
    >
      <span>{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
          className="font-bold text-[#d1d5db] hover:text-white"
        >
          Deshacer
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar"
        className="text-[#c9d0de] hover:text-white"
      >
        ×
      </button>
    </div>
  );
}

/** ⋯ menu of a group row: Renombrar, Mover dentro de…, Combinar con…, Desagrupar. */
export function GroupMenu({
  isAuto,
  onRename,
  onMove,
  onCombine,
  onUngroup,
}: {
  isAuto: boolean;
  onRename: () => void;
  onMove: () => void;
  onCombine: () => void;
  onUngroup: () => void;
}) {
  const [shown, setShown] = useState(false);
  const item =
    "block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#f1f3f7]";
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label="Acciones del grupo"
        onClick={() => setShown((v) => !v)}
        className="rounded-md px-1.5 text-[#6b7385] hover:bg-[#f1f3f7]"
      >
        ⋯
      </button>
      {shown ? (
        <span
          className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-[#dfe3ea] bg-white py-1 text-left font-normal shadow-lg"
          onMouseLeave={() => setShown(false)}
        >
          <button
            type="button"
            className={item}
            onClick={() => (setShown(false), onRename())}
          >
            Renombrar
          </button>
          <button
            type="button"
            className={item}
            onClick={() => (setShown(false), onMove())}
          >
            Mover dentro de…
          </button>
          {!isAuto ? (
            <>
              <button
                type="button"
                className={item}
                onClick={() => (setShown(false), onCombine())}
              >
                Combinar con…
              </button>
              <button
                type="button"
                className={item}
                onClick={() => (setShown(false), onUngroup())}
              >
                Desagrupar
              </button>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
