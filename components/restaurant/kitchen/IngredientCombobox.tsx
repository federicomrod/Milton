"use client";

// A searchable ingredient picker for Revisar receta: type to filter the
// company's ingredients, or «+ Crear "texto"» when nothing has that name. If a
// similar name already exists (a case/accent variant or a remembered alias)
// it asks «Ya existe "X". ¿Usarlo?» instead of creating a duplicate.

import { useMemo, useRef, useState } from "react";
import { normalizeKitchenName } from "@/lib/restaurant/kitchen-ingredient-match";
import { sentenceCase } from "@/lib/restaurant/sentence-case";

export interface ComboIngredient {
  id: string;
  name: string;
}

export type CreateOutcome =
  | { ok: true; ingredient: ComboIngredient }
  | { ok: false; similar?: ComboIngredient; error?: string };

const MAX_OPTIONS = 8;

export function IngredientCombobox({
  ingredients,
  value,
  placeholder,
  rawName,
  ariaLabel,
  onSelect,
  onCreate,
}: {
  ingredients: readonly ComboIngredient[];
  value: string | null;
  placeholder?: string;
  /** The cook's own word for a line nothing matched: shown in the box with a «+ Crear» chip. */
  rawName?: string;
  ariaLabel: string;
  onSelect: (ingredient: ComboIngredient) => void;
  /** Create «text» as a new ingredient (no price). */
  onCreate: (name: string) => Promise<CreateOutcome>;
}) {
  const selected = ingredients.find((i) => i.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<ComboIngredient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = normalizeKitchenName(text).trim();
  const options = useMemo(() => {
    const all = [...ingredients].sort((a, b) =>
      a.name.localeCompare(b.name, "es")
    );
    if (!query) return all.slice(0, MAX_OPTIONS);
    const starts: ComboIngredient[] = [];
    const contains: ComboIngredient[] = [];
    for (const ing of all) {
      const n = normalizeKitchenName(ing.name);
      if (n.startsWith(query)) starts.push(ing);
      else if (n.includes(query)) contains.push(ing);
    }
    return [...starts, ...contains].slice(0, MAX_OPTIONS);
  }, [ingredients, query]);
  const hasExact =
    query !== "" &&
    ingredients.some((i) => normalizeKitchenName(i.name).trim() === query);
  const canCreate = text.trim() !== "" && !hasExact;

  const pick = (ingredient: ComboIngredient) => {
    setOpen(false);
    setText("");
    setSimilar(null);
    setError(null);
    onSelect(ingredient);
  };

  const create = async (fixed?: string) => {
    const name = sentenceCase(fixed ?? text);
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await onCreate(name);
      if (outcome.ok) pick(outcome.ingredient);
      else if (outcome.similar) setSimilar(outcome.similar);
      else setError(outcome.error ?? "No pude crear el ingrediente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      {!selected && rawName?.trim() && !open ? (
        <button
          type="button"
          aria-label={`Crear "${sentenceCase(rawName)}"`}
          disabled={busy}
          className="absolute right-1.5 top-1.5 z-10 rounded-full bg-[#eef2fd] px-2 text-[12px] font-semibold text-[#1B40C8] hover:bg-[#dfe7fb] disabled:opacity-60"
          onClick={() => void create(rawName)}
        >
          + Crear
        </button>
      ) : null}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        className="h-9 w-full rounded-md border border-[#e3e7ee] bg-white px-2 pr-16 text-sm focus:border-[#1B40C8] focus:outline-none focus:ring-2 focus:ring-[#c6d3f5]"
        placeholder={selected ? sentenceCase(selected.name) : placeholder}
        value={
          open ? text : selected ? sentenceCase(selected.name) : (rawName ?? "")
        }
        onFocus={() => {
          setOpen(true);
          setText("");
        }}
        onChange={(e) => {
          setOpen(true);
          setText(e.target.value);
          setSimilar(null);
          setError(null);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            e.preventDefault();
            if (options.length > 0 && (hasExact || !canCreate))
              pick(options[0]);
            else if (canCreate) void create();
          }
        }}
      />
      {open ? (
        <ul
          role="listbox"
          aria-label={`${ariaLabel}: opciones`}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-[#dfe3ea] bg-white py-1 text-sm shadow-lg"
        >
          {options.map((ing) => (
            <li
              key={ing.id}
              role="option"
              aria-selected={ing.id === value}
              className="cursor-pointer px-2 py-1.5 hover:bg-[#f6f8fe]"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(ing);
              }}
            >
              {sentenceCase(ing.name)}
            </li>
          ))}
          {options.length === 0 && !canCreate ? (
            <li className="px-2 py-1.5 text-[#8a92a3]">Sin ingredientes</li>
          ) : null}
          {canCreate ? (
            <li
              role="option"
              aria-selected={false}
              className="cursor-pointer border-t border-[#eef0f4] px-2 py-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
              onMouseDown={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              + Crear &quot;{sentenceCase(text)}&quot;
            </li>
          ) : null}
        </ul>
      ) : null}
      {similar ? (
        <p className="mt-1 text-[12px] text-[#26314a]" role="status">
          Ya existe &quot;{sentenceCase(similar.name)}&quot;. ¿Usarlo?{" "}
          <button
            type="button"
            className="rounded border border-[#1B40C8] px-1.5 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe]"
            onClick={() => pick(similar)}
          >
            Usarlo
          </button>{" "}
          <button
            type="button"
            className="text-[#6b7385] underline"
            onClick={() => setSimilar(null)}
          >
            No
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-[12px] text-[#c03535]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
