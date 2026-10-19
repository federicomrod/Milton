"use client";

// «Editar precio» for an ingredient, inside Revisar receta and the Cocina
// card. It saves through /api/restaurant/kitchen/ingredient-price, a thin
// wrapper over the ONE pricing path (a dated price entry every dish reads).
// Before saving it says what the change reaches: «Esto cambia el precio de X en
// todos los platos (N platos).»

import { useEffect, useState } from "react";

export interface PriceEditable {
  id: string;
  name: string;
  default_unit: string | null;
}

export function InlinePriceEditor({
  ingredient,
  initialPrice,
  initialUnit,
  onSaved,
  onCancel,
}: {
  ingredient: PriceEditable;
  initialPrice?: number | null;
  initialUnit?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(
    initialPrice !== null && initialPrice !== undefined
      ? String(initialPrice)
      : ""
  );
  const [unit, setUnit] = useState(
    initialUnit ?? ingredient.default_unit ?? "kg"
  );
  const [dishes, setDishes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/restaurant/kitchen/ingredients/${encodeURIComponent(ingredient.id)}/usage`
    )
      .then(async (res) =>
        res.ok ? ((await res.json()) as { dishes?: number }) : null
      )
      .then((json) => {
        if (!cancelled)
          setDishes(typeof json?.dishes === "number" ? json.dishes : 0);
      })
      .catch(() => {
        if (!cancelled) setDishes(0);
      });
    return () => {
      cancelled = true;
    };
  }, [ingredient.id]);

  const parsed = price.trim() === "" ? null : Number(price);
  const valid =
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    unit.trim() !== "";

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/kitchen/ingredient-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: ingredient.id,
          unit: unit.trim(),
          unit_cost: parsed,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "No pude guardar el precio.");
        return;
      }
      onSaved();
    } catch {
      setError("No pude guardar el precio. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-1 space-y-2 rounded-md border border-[#c6d3f5] bg-[#f6f8fe] p-2 text-[12px]"
      data-testid="inline-price-editor"
    >
      <p className="text-[#26314a]">
        Esto cambia el precio de <b>{ingredient.name}</b> en todos los platos (
        {dishes === null
          ? "…"
          : `${dishes} ${dishes === 1 ? "plato" : "platos"}`}
        ).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          Precio
          <input
            type="number"
            min="0"
            step="0.0001"
            aria-label={`Precio de ${ingredient.name}`}
            className="h-8 w-24 rounded-md border border-[#e3e7ee] bg-white px-2 focus:border-[#1B40C8] focus:outline-none"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1">
          por
          <input
            aria-label={`Unidad del precio de ${ingredient.name}`}
            className="h-8 w-16 rounded-md border border-[#e3e7ee] bg-white px-2 focus:border-[#1B40C8] focus:outline-none"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void save()}
          className="h-8 rounded-md border border-[#1B40C8] bg-white px-2 font-semibold text-[#1B40C8] hover:bg-[#f6f8fe] disabled:cursor-not-allowed disabled:border-[#b9c7f0] disabled:text-[#b9c7f0]"
        >
          {busy ? "Guardando…" : "Guardar precio"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-2 text-[#6b7385] underline"
        >
          Cancelar
        </button>
      </div>
      {error ? (
        <p className="text-[#c03535]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
