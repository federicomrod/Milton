"use client";

// Ingredientes › detail, under the price: the unit bridges of this ingredient
// («1 taza = 5 oz»). One price, several units. Defining one costs every dish
// that uses the ingredient in that unit; removing one puts them back to
// «Unidad distinta» (Sin precio), never a guess.

import { NEW_PRICE_KEEPS_HISTORY } from "@/lib/restaurant/ui-copy";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UnitConversionForm,
  forgetCostCaches,
  listConversions,
  removeConversion,
  type ConversionRow,
} from "@/components/restaurant/recipes-costing/UnitConversionForm";
import { sameUnit } from "@/lib/restaurant/units";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export function IngredientConversions({
  ingredientId,
  ingredientName,
  priceUnit,
  usedUnits,
  canEdit,
  price = null,
  currency = "USD",
}: {
  ingredientId: string;
  ingredientName: string;
  /** The unit the price is in (null when it has no price yet). */
  priceUnit: string | null;
  /** Units of the recipe lines that use it. */
  usedUnits: readonly string[];
  canEdit: boolean;
  /** The latest price (its number), for «Corregir unidad del precio». */
  price?: number | null;
  currency?: string;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [correctUnit, setCorrectUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [rows, setRows] = useState<ConversionRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listConversions(ingredientId).then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ingredientId]);
  const load = useCallback(async () => {
    setRows(await listConversions(ingredientId));
  }, [ingredientId]);

  // The first unit a recipe uses that the price unit cannot be read in yet.
  const suggested =
    usedUnits.find(
      (u) =>
        priceUnit !== null &&
        !sameUnit(u, priceUnit) &&
        !(rows ?? []).some(
          (r) => sameUnit(u, r.from_unit) || sameUnit(u, r.to_unit)
        )
    ) ?? "";

  const changed = () => {
    void load();
    // The dishes that use it, and the «Se usa en» impact, are costed anew.
    forgetCostCaches();
    router.refresh();
  };

  if (!canEdit && (rows ?? []).length === 0) return null;
  return (
    <div className="mt-3" data-testid="ingredient-conversions">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-[#4a5a85]">
          Conversiones de unidad
        </span>
        {(rows ?? []).map((r) => (
          <span
            key={r.id}
            className="inline-flex items-center gap-1 rounded-full bg-[#eef2fc] px-2.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]"
          >
            1 {r.from_unit} = {Number(r.factor)} {r.to_unit}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Quitar 1 ${r.from_unit} = ${Number(r.factor)} ${r.to_unit}`}
                onClick={async () => {
                  const failure = await removeConversion(r.id);
                  setError(failure);
                  if (!failure) changed();
                }}
                className="text-[#6b7a9e] hover:text-[#c03535]"
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {canEdit && price !== null && priceUnit ? (
          <button
            type="button"
            onClick={() => {
              setCorrecting((v) => !v);
              setCorrectUnit(priceUnit);
            }}
            className="text-[12px] font-semibold text-[#1b40c8] underline"
          >
            Corregir unidad del precio
          </button>
        ) : null}
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[12px] font-semibold text-[#1b40c8] underline"
          >
            Definir conversión
          </button>
        ) : null}
      </div>
      {correcting && price !== null ? (
        <div
          className="mt-1 text-[12px]"
          data-testid="ingredient-correct-price-unit"
        >
          {formatMoney(price, currency)} por{" "}
          <select
            value={correctUnit}
            aria-label="Unidad del precio"
            onChange={(e) => setCorrectUnit(e.target.value)}
            className="rounded border border-[#c6d3f5] bg-white px-1 py-0.5"
          >
            {[
              ...new Set([
                priceUnit ?? "",
                ...usedUnits,
                "oz",
                "lb",
                "g",
                "kg",
                "ml",
                "l",
                "unit",
              ]),
            ]
              .filter(Boolean)
              .map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
          </select>{" "}
          <button
            type="button"
            disabled={!correctUnit || saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const res = await fetch("/api/restaurant/ingredient-costs", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ingredient_id: ingredientId,
                    cost_date: new Date().toISOString().slice(0, 10),
                    quantity: 1,
                    unit: correctUnit,
                    total_cost: price,
                    currency,
                    notes: "Unidad corregida",
                    keep_unit: true,
                  }),
                });
                const json = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                if (!res.ok) {
                  setError(
                    userErrorMessage(json, "No pude guardar el precio.")
                  );
                } else {
                  setCorrecting(false);
                  changed();
                }
              } catch {
                setError("No pude conectar. Intenta otra vez.");
              } finally {
                setSaving(false);
              }
            }}
            className="rounded bg-[#1b40c8] px-2 py-0.5 font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <span className="ml-2 text-[#8a92a3]">{NEW_PRICE_KEEPS_HISTORY}</span>
        </div>
      ) : null}
      {adding ? (
        <UnitConversionForm
          ingredientId={ingredientId}
          ingredientName={ingredientName}
          unitA={suggested}
          unitB={priceUnit ?? ""}
          editableUnits
          onSaved={() => {
            setAdding(false);
            changed();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-[#c03535]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
