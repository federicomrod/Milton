"use client";

// «Definir conversión»: «1 taza de PAPAS FRANCESAS = [ ] oz». One price, several
// units (migration 056). The person types the equivalence once; nothing is
// guessed (no density tables). Used on a «Unidad distinta» line, on the price
// error of a dish line, and on the ingredient detail.

import { useState } from "react";
import { clearEditors } from "@/lib/restaurant/recipe-costing/editor-cache";
import { invalidatePickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";
import { clearIngredientOptionsCache } from "./ingredient-options";

export interface ConversionRow {
  id: string;
  ingredient_id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
}

const URL = "/api/restaurant/ingredients/unit-conversions";

/** A saved conversion changes every dish that uses the ingredient. */
export function forgetCostCaches(): void {
  clearEditors();
  invalidatePickerOptions();
  clearIngredientOptionsCache();
}

export async function listConversions(
  ingredientId: string
): Promise<ConversionRow[]> {
  const res = await fetch(`${URL}?ingredient_id=${ingredientId}`);
  const json = (await res.json().catch(() => ({}))) as {
    conversions?: ConversionRow[];
  };
  return res.ok ? (json.conversions ?? []) : [];
}

export async function removeConversion(id: string): Promise<string | null> {
  const res = await fetch(URL, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (res.ok) {
    forgetCostCaches();
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? "No pude quitar la conversión.";
}

export function UnitConversionForm({
  ingredientId,
  ingredientName,
  unitA,
  unitB,
  editableUnits = false,
  onSaved,
  onCancel,
}: {
  ingredientId: string;
  ingredientName: string;
  /** «1 {unitA} de NOMBRE» */
  unitA: string;
  /** «= [ ] {unitB}» */
  unitB: string;
  /** The ingredient detail lets the person choose both units. */
  editableUnits?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [a, setA] = useState(unitA);
  const [b, setB] = useState(unitB);
  const [factor, setFactor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Migration 056 is not applied in this environment. */
  const [unavailable, setUnavailable] = useState(false);
  const n = Number(factor.replace(",", "."));
  const valid =
    n > 0 && Number.isFinite(n) && a.trim() !== "" && b.trim() !== "";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: ingredientId,
          from_unit: a,
          to_unit: b,
          factor: n,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        unavailable?: boolean;
      };
      if (!res.ok) {
        if (res.status === 409 && json.unavailable === true) {
          setUnavailable(true);
          return;
        }
        setError(json.error ?? "No pude guardar la conversión.");
        return;
      }
      forgetCostCaches();
      onSaved();
    } catch {
      setError("No pude conectar. Intenta otra vez.");
    } finally {
      setSaving(false);
    }
  }

  const unitInput =
    "w-16 rounded-md border border-[#c6d3f5] bg-white px-1.5 py-1 text-[13px]";
  return (
    <div
      className="mt-1 space-y-1 rounded-lg border border-[#dbe3f7] bg-[#f6f8fe] p-2 text-[13px]"
      data-testid="unit-conversion-form"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span>1</span>
        {editableUnits ? (
          <input
            value={a}
            onChange={(e) => setA(e.target.value)}
            aria-label="Unidad que usas"
            className={unitInput}
          />
        ) : (
          <b>{a}</b>
        )}
        <span className="min-w-0 break-words">de {ingredientName} =</span>
        <input
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          inputMode="decimal"
          aria-label={`Cuántos ${b}`}
          placeholder="0"
          className="w-16 rounded-md border border-[#c6d3f5] bg-white px-1.5 py-1 text-right text-[13px] tabular-nums"
        />
        {editableUnits ? (
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            aria-label="Unidad del precio"
            className={unitInput}
          />
        ) : (
          <b>{b}</b>
        )}
        {unavailable ? null : (
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void save()}
            className="rounded-md bg-[#1b40c8] px-2.5 py-1 font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        )}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 font-semibold text-[#4a5a85]"
          >
            Cancelar
          </button>
        ) : null}
      </div>
      {unavailable ? (
        <p
          className="text-[12px] text-gray-500"
          data-testid="conversion-unavailable"
        >
          Las conversiones aún no están activas en este ambiente.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-[#c03535]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
