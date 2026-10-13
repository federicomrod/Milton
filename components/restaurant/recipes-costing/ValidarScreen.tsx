"use client";

import { useState } from "react";
import type {
  RecipeCostingWorkspace,
  RecipeEditorView,
} from "@/lib/restaurant/recipe-costing/workspace";
import { RecipeLinesEditor } from "./RecipeLinesEditor";
import { Card, Chip, DarkBtn, GhostBtn } from "./ui";

export function ValidarScreen({
  data,
  onOpenProduct,
  onChangeLink,
  onFix,
  onApprove,
  onSubmit,
  onEdited,
  busy,
}: {
  data: RecipeCostingWorkspace;
  onOpenProduct: (odooProductId: number) => void;
  onChangeLink: (odooProductId: number) => void;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    yield_value?: number;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
  onEdited: () => void;
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
      onEdited={onEdited}
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
  onEdited,
}: {
  editor: RecipeEditorView;
  actor: RecipeCostingWorkspace["actor"];
  busy: boolean;
  onChangeLink: () => void;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    yield_value?: number;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
  onEdited: () => void;
}) {
  const [saved, setSaved] = useState(false);

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
          <RecipeLinesEditor
            odooProductId={editor.odoo_product_id}
            portionCostLabel={editor.portion_cost_label}
            yieldValue={editor.yield_value}
            yieldAssumed={editor.yield_assumed}
            yieldNote={editor.yield_note}
            onEdited={onEdited}
            onYield={(rawName, value) =>
              onFix({
                odoo_product_id: editor.odoo_product_id,
                raw_name: rawName,
                yield_value: value,
              })
            }
          />
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
