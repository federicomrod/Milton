"use client";

// Ingredientes › detail, under the price: the unit bridges of this ingredient
// («1 taza = 5 oz»). One price, several units. Defining one costs every dish
// that uses the ingredient in that unit; removing one puts them back to
// «Unidad distinta» (Sin precio), never a guess.

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

export function IngredientConversions({
  ingredientId,
  ingredientName,
  priceUnit,
  usedUnits,
  canEdit,
}: {
  ingredientId: string;
  ingredientName: string;
  /** The unit the price is in (null when it has no price yet). */
  priceUnit: string | null;
  /** Units of the recipe lines that use it. */
  usedUnits: readonly string[];
  canEdit: boolean;
}) {
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
