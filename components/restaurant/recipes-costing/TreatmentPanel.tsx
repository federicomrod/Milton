"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import type {
  RecipeCostingWorkspace,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import { PrimaryBtn } from "./ui";

export type PostFn = (url: string, body: Record<string, unknown>) => void;

const TREATMENT_URL = "/api/restaurant/pos/links/treatment";

interface IngredientOption {
  id: string;
  name: string;
  default_unit: string | null;
  current_unit_cost: number | null;
}

/** Vincular side panel: change one product's treatment; for reventa,
 *  pick what you buy (a one-line draft recipe). */
export function TreatmentControl({
  product,
  options,
  canEdit,
  busy,
  onPost,
}: {
  product: VincularProductRow;
  options: RecipeCostingWorkspace["treatment_options"];
  canEdit: boolean;
  busy: boolean;
  onPost: PostFn;
}) {
  const current = product.treatment;
  const hint =
    current === "por_clasificar"
      ? product.suggested_treatment_reason
        ? `Sin clasificar. Milton sugiere: ${product.suggested_treatment_reason.toLowerCase()}.`
        : "Sin clasificar."
      : (options.find((o) => o.id === current)?.hint ?? "");
  const needsResalePick = current === "reventa" && !product.menu_item_id;

  // C1: a compact selector in the dish header that saves on change.
  return (
    <div className="text-[13px]">
      {canEdit ? (
        <select
          aria-label="Cómo se costea"
          title={hint}
          disabled={busy}
          value={current}
          onChange={(event) => {
            const value = event.target.value as PosProductClassification;
            if (value === current) return;
            onPost(TREATMENT_URL, {
              items: [
                {
                  odoo_product_id: product.odoo_product_id,
                  odoo_name: product.odoo_name,
                  treatment: value,
                },
              ],
              source:
                value === product.suggested_treatment ? "sugerencia" : "manual",
            });
          }}
          className="rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-[13px]"
        >
          {current === "por_clasificar" ? (
            <option value="por_clasificar">Por clasificar</option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <b title={hint}>{product.treatment_label}</b>
      )}
      {needsResalePick && canEdit ? (
        <ResalePicker product={product} busy={busy} onPost={onPost} />
      ) : null}
    </div>
  );
}

function ResalePicker({
  product,
  busy,
  onPost,
}: {
  product: VincularProductRow;
  busy: boolean;
  onPost: PostFn;
}) {
  const [ingredients, setIngredients] = useState<IngredientOption[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("unit");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/restaurant/ingredients");
      const json = (await res.json().catch(() => ({}))) as {
        ingredients?: IngredientOption[];
      };
      if (cancelled) return;
      if (!res.ok) setError("No pude cargar tu lista de ingredientes.");
      else setIngredients(json.ingredients ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const picked = useMemo(
    () => ingredients?.find((row) => row.id === ingredientId) ?? null,
    [ingredients, ingredientId]
  );

  return (
    <div className="mt-2 border-t border-[#eef0f4] pt-2">
      <div className="mb-1 font-semibold">¿Qué compras para venderlo?</div>
      {error ? (
        <p className="text-[#c03535]">{error}</p>
      ) : !ingredients ? (
        <p className="text-[#8a92a3]">Cargando tu lista…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={ingredientId}
            disabled={busy}
            onChange={(event) => {
              setIngredientId(event.target.value);
              const row = ingredients.find((r) => r.id === event.target.value);
              if (row?.default_unit) setUnit(row.default_unit);
            }}
            className="min-w-0 flex-1 rounded-md border border-[#d5dae3] bg-white px-1.5 py-1"
          >
            <option value="">Elige de tu lista…</option>
            {ingredients.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <input
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            className="w-14 rounded-md border border-[#d5dae3] px-1.5 py-1 text-right"
            aria-label="Cantidad por venta"
          />
          <span className="text-[#5b6476]">{unit}</span>
          <PrimaryBtn
            disabled={busy || !ingredientId || !(Number(qty) > 0)}
            onClick={() =>
              onPost("/api/restaurant/pos/links/resale", {
                odoo_product_id: product.odoo_product_id,
                odoo_name: product.odoo_name,
                ingredient_id: ingredientId,
                quantity: Number(qty),
                unit,
              })
            }
          >
            Usar como costo
          </PrimaryBtn>
        </div>
      )}
      <div className="mt-1 text-[12px] text-[#8a92a3]">
        {picked && picked.current_unit_cost == null
          ? "Este producto aún no tiene precio: agrégalo en la receta del plato."
          : "Queda como borrador: confirma el vínculo y apruébalo como cualquier receta."}
      </div>
    </div>
  );
}
