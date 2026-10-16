"use client";

// Menú › Platos (R1-09b, C1–C9): the Preparaciones layout. List on the
// left (search, status chips, top sellers first), the dish on the right
// with its numbers from the shared loader, the one recipe editor
// (RecipeLinesEditor) and one primary button, "Aprobar".

import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  PlatoQueueRow,
  RecipeCostingWorkspace,
  RecipeEditorView,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import {
  DISH_STATUS_LABELS,
  type DishStatus,
} from "@/lib/restaurant/costing/dish-status";
import { primaryAction } from "@/lib/restaurant/recipe-costing/plato";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import { RecipeLinesEditor } from "./RecipeLinesEditor";
import { TreatmentControl, type PostFn } from "./TreatmentPanel";
import { Chip, GhostBtn } from "./ui";

/** "por_clasificar" filters on the treatment, not the cost status (B6). */
type ListFilter = DishStatus | "por_clasificar";

const FILTERS: Array<{ id: ListFilter | null; label: string }> = [
  { id: null, label: "Todos" },
  { id: "aprobado", label: DISH_STATUS_LABELS.aprobado },
  { id: "estimado", label: DISH_STATUS_LABELS.estimado },
  { id: "falta_precio", label: DISH_STATUS_LABELS.falta_precio },
  { id: "sin_receta", label: DISH_STATUS_LABELS.sin_receta },
  { id: "por_clasificar", label: "Por clasificar" },
];

interface ListRow {
  odoo_product_id: number;
  name: string;
  share_label: string;
  chip: { label: string; tone: PlatoQueueRow["status_tone"] };
  status: DishStatus | null;
  unclassified: boolean;
}

export function PlatoScreen({
  data,
  locationId,
  busy,
  onSelect,
  onPrefetch,
  onEdited,
  onPost,
  onConfirm,
  onOpenPreparation,
  statusFilter = [],
  onFilter,
  onEditorState,
}: {
  data: RecipeCostingWorkspace;
  locationId: string | null;
  busy: boolean;
  onSelect: (odooProductId: number) => void;
  /** Pointer or focus on a row: read that dish ahead of time (R1-12). */
  onPrefetch?: (odooProductId: number) => void;
  /** After an ingredient edit: refresh the open dish only. */
  onEdited: () => void;
  onPost: PostFn;
  onConfirm: () => void;
  onOpenPreparation: (componentId: string) => void;
  /** `?estado=…`: the statuses shown (KPI links land here). */
  statusFilter?: readonly string[];
  onFilter?: (filter: string | null) => void;
  /** Every editor answer: the dish's live cost and chip. */
  onEditorState?: (state: EditorState) => void;
}) {
  const [query, setQuery] = useState("");
  const product = data.selected;
  const editor = data.editor;

  const rows = useMemo<ListRow[]>(() => {
    const queue = new Map(data.plato_queue.map((r) => [r.odoo_product_id, r]));
    return data.products.map((p) => {
      const q = queue.get(p.odoo_product_id);
      return {
        odoo_product_id: p.odoo_product_id,
        name: p.odoo_name,
        share_label: p.share_label,
        chip: q
          ? { label: q.status_label, tone: q.status_tone }
          : {
              label: p.is_combo ? "Combo" : p.treatment_label,
              tone: "grey" as const,
            },
        status: q?.dish_status ?? null,
        unclassified: p.classification === "por_clasificar",
      };
    });
  }, [data.plato_queue, data.products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (statusFilter.length === 0) return true;
      return statusFilter.some((f) =>
        f === "por_clasificar"
          ? row.unclassified
          : row.status !== null && row.status === f
      );
    });
  }, [rows, query, statusFilter]);

  const activeFilter = statusFilter.length === 1 ? statusFilter[0] : null;

  return (
    <div className="grid grid-cols-[330px_1fr] gap-[14px]">
      <section className="flex max-h-[calc(100vh-190px)] flex-col overflow-hidden rounded-[14px] border border-[#eef0f4] bg-white">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar plato…"
          className="m-2.5 rounded-[9px] border border-[#dfe3ea] px-2.5 py-[7px] text-[13px] outline-none focus:border-[#f28c28]"
        />
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
          {FILTERS.map((f) => {
            const on =
              f.id === null ? statusFilter.length === 0 : activeFilter === f.id;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => onFilter?.(f.id)}
                className={
                  "rounded-full border px-2.5 py-0.5 text-[12px] " +
                  (on
                    ? "border-[#151c2c] bg-[#151c2c] font-semibold text-white"
                    : "border-[#dfe3ea] bg-white text-[#4b5466]")
                }
              >
                {f.label}
              </button>
            );
          })}
          {statusFilter.length > 1 ? (
            <span className="text-[12px] text-[#4b5466]">
              {statusFilter
                .map((s) =>
                  s === "por_clasificar"
                    ? "Por clasificar"
                    : (DISH_STATUS_LABELS[s as DishStatus] ?? s)
                )
                .join(" · ")}
            </span>
          ) : null}
        </div>
        <div className="flex-1 overflow-auto">
          {visible.map((row) => (
            <button
              key={row.odoo_product_id}
              type="button"
              onClick={() => onSelect(row.odoo_product_id)}
              onMouseEnter={() => onPrefetch?.(row.odoo_product_id)}
              onFocus={() => onPrefetch?.(row.odoo_product_id)}
              className={
                "flex w-full items-center justify-between gap-2 border-t border-[#f2f3f6] px-[14px] py-2.5 text-left text-[13px] " +
                (row.odoo_product_id === product?.odoo_product_id
                  ? "bg-[#fff6ec] shadow-[inset_3px_0_0_#f28c28]"
                  : "hover:bg-[#fafbfc]")
              }
            >
              <span className="min-w-0">
                <b className="block truncate font-semibold">{row.name}</b>
                <span className="text-[12px] text-[#8a92a3]">
                  {row.share_label} de ventas de comida
                </span>
              </span>
              <Chip tone={row.chip.tone}>{row.chip.label}</Chip>
            </button>
          ))}
          {visible.length === 0 ? (
            <p className="px-[14px] py-3 text-[13px] text-[#5b6476]">
              No hay platos con ese filtro.
            </p>
          ) : null}
        </div>
      </section>

      {product ? (
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
          onOpenPreparation={onOpenPreparation}
          onEditorState={onEditorState}
        />
      ) : (
        <section className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px] text-[13px] text-[#5b6476]">
          Elige un plato de la lista.
        </section>
      )}
    </div>
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
  onOpenPreparation,
  onEditorState,
}: {
  data: RecipeCostingWorkspace;
  product: VincularProductRow;
  /** Null while the dish's editor view loads (the lines load meanwhile). */
  editor: RecipeEditorView | null;
  onEditorState?: (state: EditorState) => void;
  locationId: string | null;
  busy: boolean;
  onEdited: () => void;
  onPost: PostFn;
  onConfirm: () => void;
  onOpenPreparation: (componentId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const dish = data.selected_dish;
  const money = (n: number) => formatMoneyEs(n, data.currency);
  const takesRecipe =
    !product.is_combo && TREATMENT_RULES[product.treatment].needs_recipe;
  const hasRecipe = Boolean(
    product.menu_item_id && (editor ? editor.recipe_version_id : true)
  );
  const action = editor ? primaryAction(data.actor, editor, hasRecipe) : null;
  const missing = dish?.lines_missing_price ?? 0;
  const costTip = [editor?.variance_note, editor?.yield_note]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="space-y-3 overflow-hidden rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-bold text-[#1b2333]">
            {product.odoo_name}
          </h2>
          <div className="text-[12px] text-[#8a92a3]">
            {[
              product.pos_price_label
                ? `Precio ${product.pos_price_label}`
                : null,
              product.in_food_sales
                ? `${product.share_label} de ventas de comida`
                : "No cuenta en ventas de comida",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <TreatmentControl
          product={product}
          options={data.treatment_options}
          canEdit={data.actor.can_submit}
          busy={busy}
          onPost={onPost}
        />
        {data.actor.can_submit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Más acciones"
                className="rounded-md p-1.5 text-[#6b7385] hover:bg-[#f1f3f7]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setPicking(true)}>
                Usar la receta de otro plato
              </DropdownMenuItem>
              {product.can_undo ? (
                <DropdownMenuItem
                  className="text-[#c03535]"
                  onClick={() =>
                    onPost("/api/restaurant/pos/links/undo", {
                      odoo_product_id: product.odoo_product_id,
                    })
                  }
                >
                  Deshacer el vínculo confirmado
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {action ? (
          <span title={action.hint ?? undefined}>
            <button
              type="button"
              disabled={busy || !action.enabled}
              onClick={onConfirm}
              className="rounded-lg bg-[#f28c28] px-3.5 py-[7px] text-[13px] font-semibold text-white hover:bg-[#e07b1a] disabled:opacity-45"
            >
              {action.label}
            </button>
          </span>
        ) : dish?.status === "aprobado" ? (
          <Chip tone={dish.state_reason ? "warn" : "ok"}>
            {dish.status_label}
          </Chip>
        ) : null}
      </div>

      {action && !action.enabled && missing > 0 ? (
        <div title={action.hint ?? undefined}>
          <Chip tone="warn">Falta precio · {missing}</Chip>
        </div>
      ) : null}

      {picking ? (
        <label className="block text-[13px] font-semibold text-[#6b7385]">
          Usar la receta de
          <select
            className="ml-2 rounded-md border border-[#d5dae3] px-2 py-1 text-[13px]"
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
            <option value="">Elige un plato…</option>
            {data.menu_items
              .filter((item) => item.id !== product.menu_item_id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          <GhostBtn className="ml-2" onClick={() => setPicking(false)}>
            Cancelar
          </GhostBtn>
        </label>
      ) : null}

      {takesRecipe ? (
        <>
          <div className="flex flex-wrap gap-10">
            <Big
              label="Costo"
              tip={costTip || undefined}
              value={
                dish?.unit_cost != null ? money(dish.unit_cost) : "Sin precio"
              }
              note={
                dish?.excel_total != null ? (
                  <span
                    className={
                      dish.excel_diff_flag
                        ? "font-semibold text-[#c03535]"
                        : "text-[#8a92a3]"
                    }
                  >
                    Excel: {money(dish.excel_total)}
                  </span>
                ) : null
              }
            />
            <Big
              label="Costo %"
              value={
                dish?.food_cost_pct != null
                  ? `${Math.round(dish.food_cost_pct)}%`
                  : "—"
              }
            />
            <Big
              label="Margen"
              value={dish?.unit_margin != null ? money(dish.unit_margin) : "—"}
            />
          </div>
          {hasRecipe ? (
            <RecipeLinesEditor
              odooProductId={product.odoo_product_id}
              locationId={locationId}
              portionCostLabel={editor?.portion_cost_label ?? null}
              onEdited={onEdited}
              onState={onEditorState}
              onOpenPreparation={onOpenPreparation}
            />
          ) : (
            <div className="flex items-center gap-3 text-[13px] text-[#5b6476]">
              <span>Este plato todavía no tiene receta.</span>
              {data.actor.can_submit ? (
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
              ) : null}
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] text-[#5b6476]">
          {product.is_combo
            ? "Este combo se costea por sus partes."
            : `No lleva receta (${product.treatment_label}).`}
        </p>
      )}
    </section>
  );
}

function Big({
  label,
  value,
  note,
  tip,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  tip?: string;
}) {
  return (
    <div>
      <div className="text-[12px] text-[#8a92a3]">
        {label}
        {tip ? (
          <span title={tip} className="ml-1 cursor-help">
            ⓘ
          </span>
        ) : null}
      </div>
      <div className="text-[34px] font-extrabold leading-tight tracking-[-0.6px] text-[#1b2333]">
        {value}
      </div>
      {note ? <div className="text-[12px]">{note}</div> : null}
    </div>
  );
}
