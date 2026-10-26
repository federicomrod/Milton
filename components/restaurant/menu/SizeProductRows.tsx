"use client";

// Menú › Platos: the rows under an opened size («6 oz»), one per Odoo product,
// each with its own chip, «Abrir» and, for a product with no recipe of its
// own, «Usar la receta de {hermano}» (a shared link, confirmed first).

import { useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/restaurant/recipes-costing/ui";
import { dishHref } from "@/lib/restaurant/menu-links";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";
import {
  canUseSiblingRecipe,
  pickApprovedSibling,
  productStatusLabel,
  productsOf,
  type SizeProduct,
} from "@/lib/restaurant/menu-dishes/size-products";

const TONES: Record<string, "ok" | "pur" | "warn" | "grey"> = {
  aprobado: "ok",
  estimado: "pur",
  falta_precio: "warn",
  sin_receta: "grey",
  borrador: "grey",
};

const BTN =
  "inline-flex items-center justify-center rounded-lg border border-[#1B40C8] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] focus:outline-none focus:ring-2 focus:ring-[#1B40C8] focus:ring-opacity-40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const BTN_FILLED =
  "inline-flex items-center justify-center rounded-lg bg-[#1B40C8] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#1533A3] focus:outline-none focus:ring-2 focus:ring-[#1B40C8] focus:ring-opacity-40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

const pct = (n: number | null) =>
  n === null ? "Sin precio" : `${Math.round(n)}%`;

function ProductRow({
  product,
  sibling,
  canLink,
  money,
  onLinked,
}: {
  product: SizeProduct;
  sibling: SizeProduct | null;
  canLink: boolean;
  money: (n: number) => string;
  onLinked?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const offer = canLink && sibling !== null && canUseSiblingRecipe(product);

  async function confirm() {
    if (busy || !sibling?.menu_item_id) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/restaurant/pos/links/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          odoo_product_id: product.odoo_product_id,
          odoo_name: product.name,
          menu_item_id: sibling.menu_item_id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote(json.error ?? "No pude cambiar el vínculo.");
        return;
      }
      setConfirming(false);
      onLinked?.();
    } catch {
      setNote("No pude cambiar el vínculo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr
      data-testid="size-product-row"
      className="border-b border-[#f2f3f6] bg-[#f4f6fb] text-[#4a5263]"
    >
      <td className="py-2 pl-[58px] pr-2">
        <div>{product.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Link
            href={dishHref(product.odoo_product_id)}
            aria-label={`Abrir ${product.name}`}
            className={BTN}
          >
            Abrir
          </Link>
          {offer && !confirming ? (
            <button
              type="button"
              className={BTN_FILLED}
              onClick={() => setConfirming(true)}
            >
              Usar la receta de {sibling.name}
            </button>
          ) : null}
        </div>
        {offer && confirming ? (
          <div
            role="group"
            aria-label="Confirmar receta compartida"
            className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[#151c2c]"
          >
            <span>
              {product.name} usará la receta de {sibling.name}. Comparten la
              misma receta.
            </span>
            <button
              type="button"
              disabled={busy}
              className={BTN_FILLED}
              onClick={() => void confirm()}
            >
              {busy ? "Guardando…" : "Confirmar"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={BTN}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </button>
          </div>
        ) : null}
        {note ? (
          <div role="status" className="mt-1 text-[12px] text-[#151c2c]">
            {note}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {money(product.sums.net_sales)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {pct(product.sums.margin_pct)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {pct(product.sums.food_cost_pct)}
      </td>
      <td />
      <td className="px-2 py-2">
        <Chip tone={TONES[product.status] ?? "grey"}>
          {productStatusLabel(product)}
        </Chip>
      </td>
      <td />
    </tr>
  );
}

/** The product rows of one size. `dishVariants` = every variant of the dish (siblings). */
export function SizeProductRows({
  variants,
  dishVariants,
  canLink,
  money,
  onLinked,
}: {
  variants: readonly MenuDishVariant[];
  dishVariants: readonly MenuDishVariant[];
  canLink: boolean;
  money: (n: number) => string;
  onLinked?: () => void;
}) {
  return (
    <>
      {productsOf(variants).map((product) => (
        <ProductRow
          key={product.odoo_product_id}
          product={product}
          sibling={
            canUseSiblingRecipe(product)
              ? pickApprovedSibling(dishVariants, product)
              : null
          }
          canLink={canLink}
          money={money}
          onLinked={onLinked}
        />
      ))}
    </>
  );
}
