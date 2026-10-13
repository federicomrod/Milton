"use client";

import { useEffect, useState } from "react";
import type {
  RecipeCostingWorkspace,
  RecipeEditorView,
} from "@/lib/restaurant/recipe-costing/workspace";
import { Card, Chip, DarkBtn, GhostBtn } from "./ui";

interface IngredientOption {
  id: string;
  name: string;
  default_unit: string | null;
  current_unit_cost: number | null;
  currency: string | null;
}

export function ValidarScreen({
  data,
  onOpenProduct,
  onChangeLink,
  onFix,
  onApprove,
  onSubmit,
  busy,
}: {
  data: RecipeCostingWorkspace;
  onOpenProduct: (odooProductId: number) => void;
  onChangeLink: (odooProductId: number) => void;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    unit?: string;
    quantity?: number;
    yield_value?: number;
    unit_cost?: number;
    add_line?: boolean;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const editor = data.editor;

  if (!editor) {
    return (
      <Card className="p-4">
        <p className="text-sm text-[#5b6476]">
          No hay un plato ya vinculado para validar. Si un plato ya cuadra,
          apruébalo desde su receta. Si falta el vínculo, vuelve a Vincular.
        </p>
        {data.review_tabs[0]?.items[0] ? (
          <GhostBtn
            className="mt-3"
            onClick={() =>
              onOpenProduct(data.review_tabs[0].items[0].odoo_product_id)
            }
          >
            Abrir el primero por revisar
          </GhostBtn>
        ) : null}
      </Card>
    );
  }

  return (
    <Editor
      editor={editor}
      actor={data.actor}
      busy={busy}
      onChangeLink={() => onChangeLink(editor.odoo_product_id)}
      onFix={onFix}
      onApprove={onApprove}
      onSubmit={onSubmit}
    />
  );
}

function Editor({
  editor,
  actor,
  busy,
  onChangeLink,
  onFix,
  onApprove,
  onSubmit,
}: {
  editor: RecipeEditorView;
  actor: RecipeCostingWorkspace["actor"];
  busy: boolean;
  onChangeLink: () => void;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    unit?: string;
    quantity?: number;
    yield_value?: number;
    unit_cost?: number;
    add_line?: boolean;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [loadingIngredients, setLoadingIngredients] = useState(false);
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newUnit, setNewUnit] = useState("g");
  const [saved, setSaved] = useState(false);

  // Fetch ingredients when adding mode is activated
  useEffect(() => {
    if (!adding || ingredients.length > 0) return;
    setLoadingIngredients(true);
    fetch("/api/restaurant/ingredients", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setIngredients(data as IngredientOption[]);
        }
      })
      .catch(() => setIngredients([]))
      .finally(() => setLoadingIngredients(false));
  }, [adding, ingredients.length]);

  // Update unit and name when an ingredient is selected
  const handleIngredientSelect = (ingredientId: string) => {
    setSelectedIngredientId(ingredientId);
    const ingredient = ingredients.find((i) => i.id === ingredientId);
    if (ingredient) {
      setNewName(ingredient.name);
      if (ingredient.default_unit) {
        setNewUnit(ingredient.default_unit);
      }
    }
  };

  return (
    <div>
      <Card className="mb-2.5 flex flex-wrap items-center gap-3 p-2.5">
        <div className="h-11 w-11 rounded-[9px] bg-gradient-to-br from-[#f6c27a] to-[#c9772b]" />
        <div>
          <div className="text-[17px] font-extrabold">
            {editor.odoo_name} <Chip tone="warn">{editor.version_label}</Chip>
          </div>
          <div className="text-xs text-[#5b6476]">
            Odoo #{editor.odoo_product_id}
            {editor.category ? ` · ${editor.category}` : ""}
            {editor.pos_price_label
              ? ` · precio ${editor.pos_price_label}`
              : ""}
            {editor.units_label ? ` · ${editor.units_label}` : ""}
            {editor.share_label ? ` · ${editor.share_label}` : ""}
            {" · "}
            <button
              type="button"
              className="font-semibold text-[#3557c9]"
              onClick={onChangeLink}
            >
              cambiar vínculo
            </button>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11.5px] text-[#6b7385]">
            Margen con el costo actual
          </div>
          <div className="text-[15px] font-bold">
            {editor.margin_label ?? "—"}
          </div>
          {editor.margin_hint ? (
            <div className="text-[10.5px] text-[#8a92a3]">
              {editor.margin_hint}
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.8fr_1fr]">
        <Card className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">
              Ingredientes por porción
            </h2>
            <span className="text-[11.5px] text-[#8a92a3]">
              Edita cantidades, unidades o rendimientos
            </span>
            <GhostBtn className="ml-auto" onClick={() => setAdding((v) => !v)}>
              + Agregar ingrediente
            </GhostBtn>
          </div>
          {adding ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] p-2">
              {loadingIngredients ? (
                <span className="text-xs text-[#8a92a3]">
                  Cargando ingredientes...
                </span>
              ) : ingredients.length > 0 ? (
                <select
                  value={selectedIngredientId}
                  onChange={(event) => handleIngredientSelect(event.target.value)}
                  className="min-w-[200px] rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-xs"
                >
                  <option value="">Selecciona un ingrediente</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name}
                      {ingredient.default_unit ? ` (${ingredient.default_unit})` : ""}
                      {ingredient.current_unit_cost != null
                        ? ` · $${ingredient.current_unit_cost.toFixed(2)}`
                        : " · sin precio"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Ingrediente (no hay ingredientes en el catálogo)"
                  className="min-w-[200px] rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-xs"
                />
              )}
              <input
                value={newQty}
                onChange={(event) => setNewQty(event.target.value)}
                className="w-16 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right text-xs"
              />
              <input
                value={newUnit}
                onChange={(event) => setNewUnit(event.target.value)}
                className="w-16 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-xs"
              />
              <GhostBtn
                disabled={busy || !newName.trim()}
                onClick={() => {
                  onFix({
                    odoo_product_id: editor.odoo_product_id,
                    raw_name: newName.trim(),
                    quantity: Number(newQty) || 1,
                    unit: newUnit.trim() || "g",
                    add_line: true,
                  });
                  setNewName("");
                  setSelectedIngredientId("");
                  setAdding(false);
                }}
              >
                Agregar
              </GhostBtn>
              <GhostBtn
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setNewName("");
                  setSelectedIngredientId("");
                }}
              >
                Cancelar
              </GhostBtn>
            </div>
          ) : null}
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
                <th className="pb-1.5">Ingrediente</th>
                <th className="pb-1.5 text-right">Cantidad</th>
                <th className="pb-1.5">Unidad</th>
                <th className="pb-1.5 text-right">Costo unitario</th>
                <th className="pb-1.5 text-right">Aporte</th>
                <th className="pb-1.5 text-right">% plato</th>
              </tr>
            </thead>
            <tbody>
              {editor.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-sm text-[#5b6476]">
                    Esta receta no tiene ingredientes. No la apruebes. Vuelve a
                    Vincular, genera sugerencias desde tu archivo o créala a
                    mano.
                  </td>
                </tr>
              ) : null}
              {editor.lines.map((line) => (
                <LineRow
                  key={`${line.raw_name}-${line.source_row}`}
                  line={line}
                  yieldValue={editor.yield_value}
                  yieldAssumed={editor.yield_assumed}
                  yieldNote={editor.yield_note}
                  showYieldRow={shouldShowYieldRow(line, editor)}
                  busy={busy}
                  onFix={(patch) =>
                    onFix({
                      odoo_product_id: editor.odoo_product_id,
                      raw_name: line.raw_name,
                      source_row: line.source_row,
                      ...patch,
                    })
                  }
                />
              ))}
              {editor.portion_cost_label ? (
                <tr className="border-t border-[#f2f3f6]">
                  <td colSpan={4} className="py-2 text-right font-semibold">
                    Costo por porción vendible
                  </td>
                  <td className="py-2 text-right text-sm font-bold">
                    {editor.portion_cost_label}
                  </td>
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
            {editor.excel_row_label ? (
              <>
                Excel original: {editor.excel_row_label}
                <span className="ml-1 font-semibold text-[#3557c9]">
                  ver fila
                </span>
              </>
            ) : (
              "Sin fila de Excel vinculada · tus correcciones quedan protegidas en futuras importaciones"
            )}
            {editor.excel_row_label
              ? " · tus correcciones quedan protegidas en futuras importaciones"
              : null}
          </div>
        </Card>

        <Card className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
              <div className="text-xs text-[#6b7385]">Costo Milton</div>
              <div className="text-xl font-bold">
                {editor.milton_cost_label ?? "Pendiente"}
              </div>
              <div className="text-[10.5px] text-[#8a92a3]">por porción</div>
            </div>
            <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
              <div className="text-xs text-[#6b7385]">
                Tu Excel (COSTO TOTAL)
              </div>
              <div className="text-xl font-bold">
                {editor.excel_total_label ?? "—"}
              </div>
              <div className="text-[10.5px] text-[#8a92a3]">
                referencia, no verdad absoluta
              </div>
            </div>
          </div>
          {editor.variance_note ? (
            <div className="mt-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-3 py-2.5 text-xs text-[#5b4515]">
              {editor.variance_note}
            </div>
          ) : null}
          <div className="mb-1 mt-2.5 text-xs font-semibold text-[#6b7385]">
            Antes de aprobar
          </div>
          {editor.checklist.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 py-0.5 text-[11.8px]"
            >
              <CheckIcon
                ok={item.ok}
                warn={!item.ok && (item.warn || item.id === "yield")}
              />
              {item.label}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#eef0f4] pt-2">
            <GhostBtn
              disabled={busy}
              onClick={() => {
                setSaved(true);
              }}
            >
              {saved ? "Borrador guardado" : "Guardar borrador"}
            </GhostBtn>
            {actor.can_approve ? (
              <DarkBtn
                disabled={busy || !editor.checklist.ready}
                onClick={onApprove}
              >
                Aprobar receta
              </DarkBtn>
            ) : (
              <DarkBtn disabled={busy || !actor.can_submit} onClick={onSubmit}>
                Enviar a aprobación
              </DarkBtn>
            )}
          </div>
          <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
            Solo el dueño o un admin aprueba. Al aprobar, esta versión empieza a
            contar en los márgenes.
          </div>
        </Card>
      </div>
    </div>
  );
}

function CheckIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e7f6ee] text-[10px] font-bold text-[#1f9d55]">
        ✓
      </span>
    );
  }
  if (warn) {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#fff4e5] text-[10px] font-bold text-[#c2700a]">
        !
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#fdecec] text-[10px] font-bold text-[#d14343]">
      ×
    </span>
  );
}

function shouldShowYieldRow(
  line: RecipeEditorView["lines"][number],
  editor: RecipeEditorView
): boolean {
  if (!line.is_sub_recipe || editor.yield_value == null) return false;
  const mentioned = editor.lines.filter((row) => {
    if (!row.is_sub_recipe) return false;
    const haystack = `${editor.yield_note ?? ""} ${editor.variance_note ?? ""}`;
    return haystack.toLowerCase().includes(row.raw_name.toLowerCase());
  });
  if (mentioned.length > 0) {
    return mentioned[0]?.raw_name === line.raw_name;
  }
  return (
    editor.lines.find((row) => row.is_sub_recipe)?.raw_name === line.raw_name
  );
}

function LineRow({
  line,
  yieldValue,
  yieldAssumed,
  yieldNote,
  showYieldRow,
  busy,
  onFix,
}: {
  line: RecipeEditorView["lines"][number];
  yieldValue: number | null;
  yieldAssumed: boolean;
  yieldNote: string | null;
  showYieldRow: boolean;
  busy: boolean;
  onFix: (patch: {
    unit?: string;
    quantity?: number;
    yield_value?: number;
    unit_cost?: number;
  }) => void;
}) {
  const [qty, setQty] = useState(String(line.qty || ""));
  const [unit, setUnit] = useState(line.unit);
  const [price, setPrice] = useState("");
  const [yieldQty, setYieldQty] = useState(String(yieldValue ?? ""));

  return (
    <>
      <tr className="border-t border-[#f2f3f6]">
        <td className="py-1.5 pr-2">
          <b>{line.raw_name}</b>
          <div className="text-[10.5px] text-[#8a92a3]">
            {line.source_note
              ? line.is_sub_recipe
                ? `${line.source_note}${yieldNote ? ` · ${yieldNote}` : ""}`
                : line.source_note
              : line.pending
                ? "Pendiente"
                : line.is_sub_recipe
                  ? "Preparación"
                  : null}
          </div>
        </td>
        <td className="py-1.5 pr-2 text-right">
          <input
            value={qty}
            disabled={busy}
            onChange={(event) => setQty(event.target.value)}
            onBlur={() => {
              const n = Number(qty);
              if (Number.isFinite(n) && n > 0 && n !== line.qty) {
                onFix({ quantity: n });
              }
            }}
            className={
              "inline-block min-w-11 rounded-md border bg-white px-1.5 py-0.5 text-right " +
              (line.is_sub_recipe && yieldAssumed
                ? "border-[#f5a524] bg-[#fff8ec] font-bold"
                : "border-[#d5dae3]")
            }
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            value={unit}
            disabled={busy}
            onChange={(event) => setUnit(event.target.value)}
            onBlur={() => {
              if (unit.trim() && unit.trim() !== line.unit)
                onFix({ unit: unit.trim() });
            }}
            className="w-16 rounded-md border border-[#d5dae3] bg-white px-1.5 py-0.5"
          />
        </td>
        <td className="py-1.5 text-right">
          {line.pending ? (
            <input
              value={price}
              disabled={busy}
              placeholder="Pendiente"
              onChange={(event) => setPrice(event.target.value)}
              onBlur={() => {
                const n = Number(price);
                if (Number.isFinite(n) && n > 0) onFix({ unit_cost: n });
              }}
              className="w-20 rounded-md border border-[#f5a524] bg-[#fff8ec] px-1.5 py-0.5 text-right font-bold"
            />
          ) : (
            line.unit_cost_label
          )}
        </td>
        <td className="py-1.5 text-right font-semibold">
          {line.pending ? "Pendiente" : line.aporte_label}
        </td>
        <td className="py-1.5 text-right text-[#8a92a3]">
          {line.dish_pct_label}
        </td>
      </tr>
      {showYieldRow ? (
        <tr>
          <td
            colSpan={6}
            className="bg-[#fff8ec] px-2.5 py-1.5 pl-5 text-[11.5px]"
          >
            ↳ <b>Preparación {line.raw_name}:</b>
            {yieldNote ? ` ${yieldNote}` : ""}
            {yieldAssumed ? " · rendimiento por confirmar" : ""}
            {" · rinde "}
            <input
              value={yieldQty}
              disabled={busy}
              onChange={(event) => setYieldQty(event.target.value)}
              onBlur={() => {
                const n = Number(yieldQty);
                if (Number.isFinite(n) && n > 0) onFix({ yield_value: n });
              }}
              className="inline-block min-w-11 rounded-md border border-[#f5a524] bg-[#fff8ec] px-1.5 py-0.5 text-right font-bold"
            />{" "}
            porciones
          </td>
        </tr>
      ) : null}
    </>
  );
}
