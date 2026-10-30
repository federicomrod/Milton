"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import type {
  RecipeCostingWorkspace,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import {
  clearIngredientOptionsCache,
  kitchenUnitLabel,
  loadIngredientOptions,
  type IngredientOption,
} from "./ingredient-options";
import { KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import { PrimaryBtn } from "./ui";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { useT } from "@/lib/i18n/client";
import { formatTypedNumber, inputNumber } from "@/lib/restaurant/locale-number";
import { fmt } from "@/lib/i18n";

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
  const { d: dict } = useT();
  const d = dict.menu.editor.treatment;
  const current = product.treatment;
  const hint =
    current === "por_clasificar"
      ? product.suggested_treatment_reason
        ? fmt(d.unclassifiedSuggest, {
            reason: product.suggested_treatment_reason.toLowerCase(),
          })
        : d.unclassified
      : (options.find((o) => o.id === current)?.hint ?? "");
  const needsResalePick = current === "reventa" && !product.menu_item_id;

  // C1: a compact selector in the dish header that saves on change.
  return (
    <div className="text-[13px]">
      {canEdit ? (
        <select
          aria-label={d.howCosted}
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
            <option value="por_clasificar">{d.toClassify}</option>
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
  const { d: dict, lang } = useT();
  const d = dict.menu.editor.treatment;
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
        if (!cancelled) setError(d.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [d]);

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
          total_cost: inputNumber(priceAmount, lang),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPriceError(userErrorMessage(json, d.priceSaveFailed));
        return;
      }
      clearIngredientOptionsCache();
      setPricedIds((prev) => new Set(prev).add(picked.id));
      setPriceAmount("");
      onPriceSaved?.();
    } catch {
      setPriceError(d.priceSaveFailed);
    } finally {
      setSavingPrice(false);
    }
  }

  return (
    <div className="mt-2 border-t border-[#eef0f4] pt-2">
      <div className="mb-1 font-semibold">{d.whatYouBuy}</div>
      {error ? (
        <p className="text-[#c03535]">{error}</p>
      ) : !ingredients ? (
        <p className="text-[#8a92a3]">{d.loadingList}</p>
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
            <option value="">{d.chooseFromList}</option>
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
            aria-label={d.quantityPerSale}
          />
          <select
            aria-label={d.quantityUnit}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded-md border border-[#d5dae3] bg-white px-1.5 py-1 text-[#5b6476]"
          >
            {KITCHEN_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {kitchenUnitLabel(u, dict.menu.editor.units)}
              </option>
            ))}
          </select>
          <PrimaryBtn
            className={
              missingPrice
                ? "border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#f6f8fe]"
                : undefined
            }
            disabled={busy || !ingredientId || !(inputNumber(qty, lang) > 0)}
            onClick={() =>
              onPost("/api/restaurant/pos/links/resale", {
                odoo_product_id: product.odoo_product_id,
                odoo_name: product.odoo_name,
                ingredient_id: ingredientId,
                quantity: inputNumber(qty, lang),
                unit,
              })
            }
          >
            {d.useAsCost}
          </PrimaryBtn>
        </div>
      )}
      {missingPrice ? (
        <div className="mt-2" data-testid="resale-price">
          <div className="text-[12px] text-[#6b7280]">{d.noPriceNote}</div>
          {canEditPrices ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input
                value={priceAmount}
                inputMode="decimal"
                onChange={(event) => setPriceAmount(event.target.value)}
                className="w-20 rounded-md border border-[#d5dae3] px-1.5 py-1 text-right"
                aria-label={d.price}
                placeholder={d.price}
              />
              <span className="text-[#5b6476]">{d.per}</span>
              <select
                aria-label={d.priceUnit}
                value={priceUnit}
                onChange={(event) => setPriceUnit(event.target.value)}
                className="rounded-md border border-[#d5dae3] bg-white px-1.5 py-1 text-[#5b6476]"
              >
                {KITCHEN_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {kitchenUnitLabel(u, dict.menu.editor.units)}
                  </option>
                ))}
              </select>
              <PrimaryBtn
                disabled={
                  savingPrice ||
                  !(inputNumber(priceAmount, lang) >= 0) ||
                  !priceAmount.trim()
                }
                onClick={() => void savePrice()}
              >
                {d.savePrice}
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
        <div className="mt-1 text-[12px] text-[#8a92a3]">{d.draftNote}</div>
      )}
    </div>
  );
}
