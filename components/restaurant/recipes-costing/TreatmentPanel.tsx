"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import type {
  RecipeCostingWorkspace,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import {
  clearIngredientOptionsCache,
  loadIngredientOptions,
  type IngredientOption,
} from "./ingredient-options";
import { KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import { PrimaryBtn } from "./ui";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export type PostFn = (url: string, body: Record<string, unknown>) => void;

export const TREATMENT_URL = "/api/restaurant/pos/links/treatment";

/** Vincular side panel: change one product's treatment; for reventa,
 *  pick what you buy (a one-line draft recipe). */
export function TreatmentControl({
  product,
  options,
  canEdit,
  canEditPrices,
  onPriceSaved,
  busy,
  onPost,
}: {
  product: VincularProductRow;
  options: RecipeCostingWorkspace["treatment_options"];
  canEdit: boolean;
  /** prices.edit, from the server-provided actor capabilities. */
  canEditPrices?: boolean;
  /** After an ingredient price is saved: refresh the open dish. */
  onPriceSaved?: () => void;
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
        <ResalePicker
          product={product}
          busy={busy}
          onPost={onPost}
          canEditPrices={canEditPrices ?? canEdit}
          onPriceSaved={onPriceSaved}
        />
      ) : null}
    </div>
  );
}

export const INGREDIENT_COSTS_URL = "/api/restaurant/ingredient-costs";
const DEFAULT_RESALE_UNIT = "unidad";

/** A unit from the stored value, or the default when it is not in the list. */
function pickUnit(raw: string | null | undefined): string {
  return KITCHEN_UNITS.some((u) => u.value === raw)
    ? (raw as string)
    : DEFAULT_RESALE_UNIT;
}

function ResalePicker({
  product,
  busy,
  onPost,
  canEditPrices,
  onPriceSaved,
}: {
  product: VincularProductRow;
  busy: boolean;
  onPost: PostFn;
  canEditPrices: boolean;
  onPriceSaved?: () => void;
}) {
  const [ingredients, setIngredients] = useState<IngredientOption[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState(DEFAULT_RESALE_UNIT);
  const [priceAmount, setPriceAmount] = useState("");
  const [priceUnit, setPriceUnit] = useState(DEFAULT_RESALE_UNIT);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricedIds, setPricedIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void loadIngredientOptions()
      .then((rows) => {
        if (!cancelled) setIngredients(rows);
      })
      .catch(() => {
        if (!cancelled) setError("No pude cargar tu lista de ingredientes.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const picked = useMemo(
    () => ingredients?.find((row) => row.id === ingredientId) ?? null,
    [ingredients, ingredientId]
  );

  const missingPrice =
    picked !== null &&
    picked.latest_unit_cost == null &&
    !pricedIds.has(picked.id);

  async function savePrice() {
    if (!picked || savingPrice) return;
    setSavingPrice(true);
    setPriceError(null);
    try {
      const res = await fetch(INGREDIENT_COSTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: picked.id,
          cost_date: new Date().toISOString().slice(0, 10),
          quantity: 1,
          unit: priceUnit,
          total_cost: Number(priceAmount),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPriceError(userErrorMessage(json, "No pude guardar el precio."));
        return;
      }
      clearIngredientOptionsCache();
      setPricedIds((prev) => new Set(prev).add(picked.id));
      setPriceAmount("");
      onPriceSaved?.();
    } catch {
      setPriceError("No pude guardar el precio.");
    } finally {
      setSavingPrice(false);
    }
  }

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
              setPriceError(null);
              if (row?.default_unit) {
                setUnit(pickUnit(row.default_unit));
                setPriceUnit(pickUnit(row.default_unit));
              }
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
          <select
            aria-label="Unidad de la cantidad"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded-md border border-[#d5dae3] bg-white px-1.5 py-1 text-[#5b6476]"
          >
            {KITCHEN_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <PrimaryBtn
            className={
              missingPrice
                ? "border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#f6f8fe]"
                : undefined
            }
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
      {missingPrice ? (
        <div className="mt-2" data-testid="resale-price">
          <div className="text-[12px] text-[#6b7280]">
            Sin precio: este producto aún no tiene precio.
          </div>
          {canEditPrices ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input
                value={priceAmount}
                inputMode="decimal"
                onChange={(event) => setPriceAmount(event.target.value)}
                className="w-20 rounded-md border border-[#d5dae3] px-1.5 py-1 text-right"
                aria-label="Precio"
                placeholder="Precio"
              />
              <span className="text-[#5b6476]">por</span>
              <select
                aria-label="Unidad del precio"
                value={priceUnit}
                onChange={(event) => setPriceUnit(event.target.value)}
                className="rounded-md border border-[#d5dae3] bg-white px-1.5 py-1 text-[#5b6476]"
              >
                {KITCHEN_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <PrimaryBtn
                disabled={
                  savingPrice ||
                  !(Number(priceAmount) >= 0) ||
                  !priceAmount.trim()
                }
                onClick={() => void savePrice()}
              >
                Guardar precio
              </PrimaryBtn>
            </div>
          ) : null}
          {priceError ? (
            <p className="mt-1 text-[12px] text-[#c03535]" role="alert">
              {priceError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 text-[12px] text-[#8a92a3]">
          Queda como borrador: confirma el vínculo y apruébalo como cualquier
          receta.
        </div>
      )}
    </div>
  );
}
