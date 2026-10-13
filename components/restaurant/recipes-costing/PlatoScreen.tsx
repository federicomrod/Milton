"use client";

import { useMemo, useState } from "react";
import type {
  PlatoQueueRow,
  RecipeCostingWorkspace,
  RecipeEditorView,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import { primaryAction } from "@/lib/restaurant/recipe-costing/plato";
import { RecipeLinesEditor } from "./RecipeLinesEditor";
import { TreatmentControl, type PostFn } from "./TreatmentPanel";
import { Card, Chip, DarkBtn, GhostBtn } from "./ui";

/**
 * Plato por plato: one dish at a time, top sellers first. The Excel recipe
 * comes prefilled as Sugerido; the person resolves only what Milton does
 * not know, then approves (or sends for approval) and moves on.
 */
export function PlatoScreen({
  data,
  locationId,
  busy,
  onSelect,
  onEdited,
  onPost,
  onConfirm,
  onSkip,
  onFixYield,
  onOpenPreparation,
}: {
  data: RecipeCostingWorkspace;
  locationId: string | null;
  busy: boolean;
  onSelect: (odooProductId: number) => void;
  /** After an ingredient edit: refresh the open dish only. */
  onEdited: () => void;
  onPost: PostFn;
  onConfirm: () => void;
  onSkip: () => void;
  onFixYield: (rawName: string, value: number) => void;
  onOpenPreparation: (componentId: string) => void;
}) {
  const editor = data.editor;
  const product = data.selected;
  const [showOthers, setShowOthers] = useState(false);
  const others = useMemo(
    () =>
      data.products.filter(
        (row) =>
          !data.plato_queue.some(
            (q) => q.odoo_product_id === row.odoo_product_id
          )
      ),
    [data.products, data.plato_queue]
  );

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[250px_1fr]">
      <Card className="p-2.5">
        <div className="mb-1.5 text-[11.5px] text-[#6b7385]">
          {data.plato_progress.label} · los que más venden primero
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {data.plato_queue.map((row) => (
            <QueueItem
              key={row.odoo_product_id}
              row={row}
              active={row.odoo_product_id === product?.odoo_product_id}
              onSelect={onSelect}
            />
          ))}
          {data.plato_queue.length === 0 ? (
            <p className="px-1 py-2 text-xs text-[#5b6476]">
              No hay platos que lleven receta todavía. Revisa en Resumen cómo se
              costea cada producto.
            </p>
          ) : null}
          {others.length > 0 ? (
            <button
              type="button"
              className="mt-2 px-1 text-[11px] font-semibold text-[#3557c9]"
              onClick={() => setShowOthers((v) => !v)}
            >
              {showOthers
                ? "Ocultar los demás productos"
                : `Ver los demás productos (${others.length})`}
            </button>
          ) : null}
          {showOthers
            ? others.map((row) => (
                <button
                  key={row.odoo_product_id}
                  type="button"
                  onClick={() => onSelect(row.odoo_product_id)}
                  className={
                    "block w-full border-b border-slate-100 px-1.5 py-1 text-left text-[11.5px] last:border-b-0 hover:bg-slate-50 " +
                    (row.odoo_product_id === product?.odoo_product_id
                      ? "bg-[#f4f6fb]"
                      : "")
                  }
                >
                  {row.odoo_name}
                  <span className="block text-[10.5px] text-[#8a92a3]">
                    {row.is_combo ? "Combo" : row.treatment_label}
                  </span>
                </button>
              ))
            : null}
        </div>
      </Card>

      {!product || !editor ? (
        <Card className="p-4 text-sm text-[#5b6476]">
          Elige un plato de la lista.
        </Card>
      ) : (
        <Dish
          key={product.odoo_product_id}
          data={data}
          product={product}
          editor={editor}
          locationId={locationId}
          busy={busy}
          onEdited={onEdited}
          onPost={onPost}
          onConfirm={onConfirm}
          onSkip={onSkip}
          onFixYield={onFixYield}
          onOpenPreparation={onOpenPreparation}
        />
      )}
    </div>
  );
}

function QueueItem({
  row,
  active,
  onSelect,
}: {
  row: PlatoQueueRow;
  active: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.odoo_product_id)}
      className={
        "flex w-full items-center gap-2 border-b border-slate-100 px-1.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50 " +
        (active ? "bg-[#f4f6fb]" : "")
      }
    >
      <span className="min-w-0 flex-1">
        <b className="block truncate">{row.odoo_name}</b>
        <span className="text-[10.5px] text-[#8a92a3]">
          {row.share_label} de ventas de comida
        </span>
      </span>
      <Chip tone={row.status_tone}>{row.status_label}</Chip>
    </button>
  );
}

function Dish({
  data,
  product,
  editor,
  locationId,
  busy,
  onEdited,
  onPost,
  onConfirm,
  onSkip,
  onFixYield,
  onOpenPreparation,
}: {
  data: RecipeCostingWorkspace;
  product: VincularProductRow;
  editor: RecipeEditorView;
  locationId: string | null;
  busy: boolean;
  onEdited: () => void;
  onPost: PostFn;
  onConfirm: () => void;
  onSkip: () => void;
  onFixYield: (rawName: string, value: number) => void;
  onOpenPreparation: (componentId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const takesRecipe =
    !product.is_combo && TREATMENT_RULES[product.treatment].needs_recipe;
  const hasRecipe = Boolean(product.menu_item_id && editor.recipe_version_id);
  const action = primaryAction(data.actor, editor, hasRecipe);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-[#6b7385]">
            Odoo #{product.odoo_product_id}
            {product.category ? ` · ${product.category}` : ""}
            {editor.review_index && editor.review_total
              ? ` · plato ${editor.review_index} de ${editor.review_total}`
              : ""}
          </div>
          <div className="text-[18px] font-extrabold text-[#1b2333]">
            {product.odoo_name}
          </div>
          <div className="text-xs text-[#5b6476]">
            {product.pos_price_label
              ? `Precio en el POS ${product.pos_price_label}`
              : "Sin precio en el POS"}
            {` · ${product.units_label}`}
            {product.in_food_sales
              ? ` · ${product.share_label} de las ventas de comida`
              : " · no cuenta en la cobertura"}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip tone={product.confirmed ? "ok" : "grey"}>
              {product.confirmed
                ? "Vínculo confirmado"
                : product.menu_item_id
                  ? "Vínculo sugerido"
                  : "Sin vínculo"}
            </Chip>
            <Chip tone={recipeTone(editor.recipe_status)}>
              {recipeLabel(editor.recipe_status)}
            </Chip>
            {editor.excel_match === "match" ? (
              <Chip tone="ok">Cuadra con Excel</Chip>
            ) : editor.excel_match === "mismatch" ? (
              <Chip tone="warn">No cuadra con Excel</Chip>
            ) : null}
            {editor.menu_source ? <Chip tone="sug">Del menú</Chip> : null}
          </div>
          {editor.excel_row_label ? (
            <div className="mt-1 text-[10.5px] text-[#8a92a3]">
              Sugerido desde tu Excel: {editor.excel_row_label}
            </div>
          ) : null}
          {editor.menu_source ? (
            <div className="mt-1.5 rounded-md border border-[#eef0f4] bg-[#fafbfc] px-2.5 py-1.5 text-[11.5px] text-[#5b6476]">
              <b className="text-[#1b2333]">
                En tu menú: {editor.menu_source.dish}
              </b>
              {editor.menu_source.price_label
                ? ` · ${editor.menu_source.price_label}`
                : ""}
              {editor.menu_source.description ? (
                <div className="mt-0.5 italic">
                  «{editor.menu_source.description}»
                </div>
              ) : null}
              <div className="mt-0.5 text-[10.5px] text-[#8a92a3]">
                El menú dice qué lleva, no cuánto. Escribe la cantidad de cada
                componente.
              </div>
            </div>
          ) : null}
        </div>
        <div className="w-full sm:w-64">
          <TreatmentControl
            product={product}
            options={data.treatment_options}
            canEdit={data.actor.can_submit}
            busy={busy}
            onPost={onPost}
          />
        </div>
      </Card>

      {!takesRecipe ? (
        <Card className="p-4 text-sm text-[#5b6476]">
          {product.is_combo
            ? "Este combo se costea por sus partes: cuenta cuando cada parte tiene su costo."
            : `Este producto no lleva receta (${product.treatment_label}).`}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.8fr_1fr]">
          <Card className="p-3">
            {hasRecipe ? (
              <RecipeLinesEditor
                odooProductId={product.odoo_product_id}
                locationId={locationId}
                portionCostLabel={editor.portion_cost_label}
                yieldValue={editor.yield_value}
                yieldAssumed={editor.yield_assumed}
                yieldNote={editor.yield_note}
                onEdited={onEdited}
                onOpenPreparation={onOpenPreparation}
                onYield={onFixYield}
              />
            ) : (
              <div className="space-y-2 text-sm text-[#5b6476]">
                <p>
                  Este plato todavía no tiene receta. Si tu Excel la trae,
                  súbelo en Resumen y se prepara solo; si no, créala aquí.
                </p>
                {data.actor.can_submit ? (
                  <div className="flex flex-wrap gap-1.5">
                    <GhostBtn
                      disabled={busy}
                      onClick={() =>
                        onPost("/api/restaurant/pos/links/create", {
                          odoo_product_id: product.odoo_product_id,
                          odoo_name: product.odoo_name,
                        })
                      }
                    >
                      Crear receta
                    </GhostBtn>
                    <GhostBtn disabled={busy} onClick={() => setPicking(true)}>
                      Usar la receta de otro plato
                    </GhostBtn>
                  </div>
                ) : null}
              </div>
            )}
            {data.actor.can_submit ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-[#eef0f4] pt-2 text-[11px]">
                {hasRecipe ? (
                  <button
                    type="button"
                    className="font-semibold text-[#3557c9]"
                    disabled={busy}
                    onClick={() => setPicking((v) => !v)}
                  >
                    Usar la receta de otro plato
                  </button>
                ) : null}
                {product.can_undo ? (
                  <button
                    type="button"
                    className="font-semibold text-[#c03535]"
                    disabled={busy}
                    onClick={() =>
                      onPost("/api/restaurant/pos/links/undo", {
                        odoo_product_id: product.odoo_product_id,
                      })
                    }
                  >
                    Deshacer el vínculo confirmado
                  </button>
                ) : null}
              </div>
            ) : null}
            {picking ? (
              <label className="mt-2 block text-xs font-semibold text-[#6b7385]">
                Elige la receta (solo si lleva lo mismo, en la misma cantidad)
                <select
                  className="mt-1 w-full rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm"
                  defaultValue=""
                  disabled={busy}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setPicking(false);
                    onPost("/api/restaurant/pos/links/change", {
                      odoo_product_id: product.odoo_product_id,
                      odoo_name: product.odoo_name,
                      menu_item_id: event.target.value,
                    });
                  }}
                >
                  <option value="">—</option>
                  {data.menu_items
                    .filter((item) => item.id !== product.menu_item_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
          </Card>

          <Card className="p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
                <div className="text-xs text-[#6b7385]">Costo por porción</div>
                <div className="text-xl font-bold">
                  {editor.milton_cost_label ?? "Pendiente"}
                </div>
              </div>
              <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
                <div className="text-xs text-[#6b7385]">Margen</div>
                <div className="text-xl font-bold">
                  {editor.margin_label ?? "—"}
                </div>
                {editor.margin_hint ? (
                  <div className="text-[10.5px] text-[#8a92a3]">
                    {editor.margin_hint}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 text-[11.5px] text-[#5b6476]">
              Tu Excel (COSTO TOTAL): {editor.excel_total_label ?? "—"}
              <span className="text-[#8a92a3]"> · referencia</span>
            </div>
            {editor.variance_note ? (
              <div className="mt-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-3 py-2 text-xs text-[#5b4515]">
                {editor.variance_note}
              </div>
            ) : null}
            <div className="mb-1 mt-2.5 text-xs font-semibold text-[#6b7385]">
              Antes de aprobar
            </div>
            {editor.checklist.items
              .filter((item) => item.id !== "linked")
              .map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-1.5 py-0.5 text-[11.8px]"
                >
                  <Dot ok={item.ok} />
                  {item.label}
                </div>
              ))}
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[#eef0f4] pt-2">
              {action ? (
                <DarkBtn
                  disabled={busy || !action.enabled}
                  onClick={action.navigateOnly ? onSkip : onConfirm}
                >
                  {action.label}
                </DarkBtn>
              ) : null}
              <GhostBtn disabled={busy} onClick={onSkip}>
                Saltar por ahora
              </GhostBtn>
            </div>
            <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
              {action?.hint ??
                "Solo el dueño o un admin aprueba. Al aprobar, la receta empieza a contar en los márgenes."}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function recipeLabel(status: RecipeEditorView["recipe_status"]): string {
  if (status === "aprobada" || status === "listo") return "Receta aprobada";
  if (status === "por_aprobar") return "Enviada a aprobación";
  if (status === "borrador") return "Receta sugerida";
  return "Sin receta";
}

function recipeTone(
  status: RecipeEditorView["recipe_status"]
): "ok" | "sug" | "warn" | "grey" {
  if (status === "aprobada" || status === "listo") return "ok";
  if (status === "por_aprobar") return "sug";
  if (status === "borrador") return "warn";
  return "grey";
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
        (ok ? "bg-[#e7f6ee] text-[#1f9d55]" : "bg-[#fff4e5] text-[#c2700a]")
      }
    >
      {ok ? "✓" : "!"}
    </span>
  );
}
