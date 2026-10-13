"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import type {
  ClassifyQueueRow,
  RecipeCostingWorkspace,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import { Card, GhostBtn, PrimaryBtn } from "./ui";

export type PostFn = (url: string, body: Record<string, unknown>) => void;

const TREATMENT_URL = "/api/restaurant/pos/links/treatment";
const FIRST_ROWS = 12;

/**
 * Resumen: products nobody has classified yet, top sellers first, each
 * with Milton's suggestion preselected. One click saves the visible
 * choices; nothing is saved without it.
 */
export function ClassifyQueuePanel({
  rows,
  options,
  canEdit,
  busy,
  onPost,
}: {
  rows: ClassifyQueueRow[];
  options: RecipeCostingWorkspace["treatment_options"];
  canEdit: boolean;
  busy: boolean;
  onPost: PostFn;
}) {
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<
    Record<number, PosProductClassification>
  >({});
  const visible = showAll ? rows : rows.slice(0, FIRST_ROWS);
  const choice = (row: ClassifyQueueRow) =>
    picked[row.odoo_product_id] ?? row.suggested;

  if (rows.length === 0) return null;

  function save() {
    const items = visible.map((row) => ({
      odoo_product_id: row.odoo_product_id,
      odoo_name: row.odoo_name,
      treatment: choice(row),
      source: choice(row) === row.suggested ? "sugerencia" : "manual",
    }));
    onPost(TREATMENT_URL, { items });
    setPicked({});
  }

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">
          ¿Cómo se costea cada producto?
        </h2>
        <span className="text-[11.5px] text-[#8a92a3]">
          {rows.length} por clasificar · Milton sugiere, tú decides
        </span>
      </div>
      <p className="mb-2 text-[11.5px] text-[#6b7385]">
        Lo que marques como «no es comida» sale de la cobertura. Revisa la
        sugerencia y cámbiala si no es así.
      </p>
      <table className="w-full text-[11.8px]">
        <thead>
          <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
            <th className="pb-1.5 pr-2">Producto del POS</th>
            <th className="pb-1.5 pr-2 text-right">% ventas</th>
            <th className="pb-1.5">Cómo se costea</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.odoo_product_id} className="border-t border-[#f2f3f6]">
              <td className="py-1.5 pr-2">
                <b>{row.odoo_name}</b>
                <div className="text-[10.5px] text-[#8a92a3]">
                  {choice(row) === row.suggested
                    ? `Sugerido: ${row.reason}`
                    : "Elegido por ti"}
                </div>
              </td>
              <td className="py-1.5 pr-2 text-right">{row.share_label}</td>
              <td className="py-1.5">
                <select
                  disabled={!canEdit || busy}
                  value={choice(row)}
                  onChange={(event) =>
                    setPicked((prev) => ({
                      ...prev,
                      [row.odoo_product_id]: event.target
                        .value as PosProductClassification,
                    }))
                  }
                  className="w-full rounded-md border border-[#d5dae3] bg-white px-1.5 py-1 text-[11.5px]"
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <PrimaryBtn disabled={busy} onClick={save}>
            Guardar {visible.length}{" "}
            {visible.length === 1 ? "producto" : "productos"}
          </PrimaryBtn>
        ) : (
          <span className="text-[11px] text-[#8a92a3]">
            Solo el dueño, un admin o un gerente clasifica productos.
          </span>
        )}
        {rows.length > FIRST_ROWS ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-[#3557c9]"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Ver menos" : `Ver los ${rows.length}`}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

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
  const [value, setValue] = useState<PosProductClassification>(
    current === "por_clasificar"
      ? (product.suggested_treatment ?? "plato_preparado")
      : current
  );
  const needsResalePick = current === "reventa" && !product.menu_item_id;

  return (
    <div className="mb-2.5 rounded-[10px] border border-[#eef0f4] p-2.5 text-[11.8px]">
      <div className="text-[11.5px] text-[#6b7385]">Cómo se costea</div>
      {canEdit ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <select
            disabled={busy}
            value={value}
            onChange={(event) =>
              setValue(event.target.value as PosProductClassification)
            }
            className="rounded-md border border-[#d5dae3] bg-white px-1.5 py-1"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <GhostBtn
            disabled={busy || value === current}
            onClick={() =>
              onPost(TREATMENT_URL, {
                items: [
                  {
                    odoo_product_id: product.odoo_product_id,
                    odoo_name: product.odoo_name,
                    treatment: value,
                  },
                ],
                source:
                  value === product.suggested_treatment
                    ? "sugerencia"
                    : "manual",
              })
            }
          >
            Guardar
          </GhostBtn>
        </div>
      ) : (
        <b>{product.treatment_label}</b>
      )}
      <div className="mt-1 text-[10.8px] text-[#8a92a3]">
        {current === "por_clasificar"
          ? product.suggested_treatment_reason
            ? `Sin clasificar. Milton sugiere: ${product.suggested_treatment_reason.toLowerCase()}.`
            : "Sin clasificar."
          : (options.find((o) => o.id === value)?.hint ?? "")}
      </div>
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
      <div className="mt-1 text-[10.8px] text-[#8a92a3]">
        {picked && picked.current_unit_cost == null
          ? "Este producto aún no tiene precio: agrégalo en Validar."
          : "Queda como borrador: confirma el vínculo y apruébalo como cualquier receta."}
      </div>
    </div>
  );
}
