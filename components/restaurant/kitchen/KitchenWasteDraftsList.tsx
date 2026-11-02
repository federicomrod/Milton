"use client";

// The inline confirm list of KitchenWasteDrafts. Lavender marks the AI draft;
// the blue button confirms. No amounts anywhere.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  KITCHEN_UNITS,
  kitchenUnitLabel,
  mapKitchenUnit,
} from "@/lib/restaurant/kitchen-units";
import { parseLocaleNumber } from "@/lib/restaurant/locale-number";
import type { WasteDraftRow } from "./KitchenWasteDrafts";

const FIELD =
  "h-9 min-w-0 rounded-md border border-[#c6d3f5] bg-white px-2 text-[14px] text-[#0F172A]";

export function KitchenWasteDraftsList({
  rows: initial,
  ingredients,
}: {
  rows: WasteDraftRow[];
  ingredients: Array<{ id: string; name: string }>;
}) {
  const { d, lang } = useT();
  const w = d.rentabilidad.waste;
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  if (!rows.length) return null;
  return (
    <section
      data-testid="waste-drafts"
      className="rounded-[14px] border border-[#dbe3f7] bg-white p-4"
    >
      <h2 className="text-[15px] font-bold text-[#0F172A]">{w.cocinaTitle}</h2>
      <p className="mt-1 text-[13px] text-[#4a5a85]">{w.cocinaIntro}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <DraftItem
            key={r.id}
            row={r}
            ingredients={ingredients}
            lang={lang}
            onDone={() => {
              setRows((prev) => prev.filter((x) => x.id !== r.id));
              router.refresh();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function DraftItem({
  row,
  ingredients,
  lang,
  onDone,
}: {
  row: WasteDraftRow;
  ingredients: Array<{ id: string; name: string }>;
  lang: Parameters<typeof parseLocaleNumber>[1];
  onDone: () => void;
}) {
  const { d } = useT();
  const w = d.rentabilidad.waste;
  const [qty, setQty] = useState(
    row.quantity === null ? "" : String(row.quantity).replace(".", ",")
  );
  const [unit, setUnit] = useState(mapKitchenUnit(row.unit) ?? "");
  const [ingredientId, setIngredientId] = useState(row.ingredient_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "confirm" | "discard") {
    setError(null);
    let quantity: number | null = null;
    if (action === "confirm" && qty.trim()) {
      const p = parseLocaleNumber(qty, lang);
      if (!p.ok || p.value === null || !(p.value > 0)) {
        setError(w.invalid);
        return;
      }
      quantity = p.value;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/restaurant/kitchen/waste-lines", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "discard"
            ? { id: row.id, action }
            : {
                id: row.id,
                action,
                quantity,
                unit: unit || null,
                ingredientId: ingredientId || undefined,
              }
        ),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? w.saveFailed);
        return;
      }
      onDone();
    } catch {
      setError(w.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid="waste-draft"
      className="min-w-0 rounded-lg border border-[#eef0f4] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words text-[14px] font-semibold text-[#0F172A]">
          {row.item_name}
        </span>
        <span className="rounded-full bg-[#D8D0F8] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]">
          {w.aiTag}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="decimal"
          aria-label={w.quantity}
          placeholder={w.noQuantity}
          className={FIELD + " w-24"}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          aria-label={w.unit}
          className={FIELD}
        >
          <option value="">—</option>
          {KITCHEN_UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {kitchenUnitLabel(u, lang)}
            </option>
          ))}
        </select>
        {!row.ingredient_id ? (
          <select
            value={ingredientId}
            onChange={(e) => setIngredientId(e.target.value)}
            aria-label={w.pickIngredient}
            className={FIELD + " max-w-full"}
          >
            <option value="">{w.pickIngredient}</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send("confirm")}
          className="rounded-md bg-[#1B40C8] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {w.confirm}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send("discard")}
          className="text-sm font-semibold text-[#1B40C8] underline disabled:opacity-60"
        >
          {w.discard}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-[#4a5a85]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
