"use client";

import { useState } from "react";
import type {
  RecipeCostingWorkspace,
  RecipeEditorView,
} from "@/lib/restaurant/recipe-costing/workspace";
import { Card, Chip, DarkBtn, GhostBtn } from "./ui";

export function ValidarScreen({
  data,
  onOpenProduct,
  onFix,
  onApprove,
  onSubmit,
  busy,
}: {
  data: RecipeCostingWorkspace;
  onOpenProduct: (odooProductId: number) => void;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    unit?: string;
    quantity?: number;
    yield_value?: number;
    unit_cost?: number;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const [openTabs, setOpenTabs] = useState<Record<string, boolean>>({});
  const editor = data.editor;

  return (
    <div>
      <div className="mb-1.5 text-[10.5px] text-slate-400">
        Menú › Recetas y costeo ›{" "}
        <b className="text-slate-900">Paso 3 de 4 · Validar</b>
        {data.review_tabs.length > 0 ? (
          <span>
            {" "}
            · {data.review_tabs.reduce((n, tab) => n + tab.item_count, 0)} por
            revisar
          </span>
        ) : null}
      </div>

      <Card className="mb-3 p-3">
        <div className="mb-2 text-[15px] font-semibold">
          Solo lo incierto, por pestaña
        </div>
        {data.review_tabs.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay líneas inciertas. Si un plato ya cuadra, apruébalo desde su
            receta.
          </p>
        ) : (
          <div className="space-y-2">
            {data.review_tabs.map((tab) => {
              const open = openTabs[tab.tab] ?? false;
              return (
                <div
                  key={tab.tab}
                  className="rounded-lg border border-slate-100"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    onClick={() =>
                      setOpenTabs((prev) => ({ ...prev, [tab.tab]: !open }))
                    }
                  >
                    <span>
                      <b>{tab.tab}</b>
                      <span className="ml-2 text-[11px] text-slate-500">
                        {tab.summary}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {tab.item_count} {open ? "▾" : "▸"}
                    </span>
                  </button>
                  {open
                    ? tab.items.map((item) => (
                        <button
                          key={item.odoo_product_id}
                          type="button"
                          className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-left text-[12px] hover:bg-amber-50"
                          onClick={() => onOpenProduct(item.odoo_product_id)}
                        >
                          <span>
                            <b>{item.odoo_name}</b>
                            <span className="ml-2 text-slate-500">
                              {item.reason}
                            </span>
                          </span>
                          <span className="text-slate-400">
                            {item.pending
                              ? "Pendiente"
                              : item.milton_cost_label}
                          </span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {editor ? (
        <Editor
          editor={editor}
          actor={data.actor}
          busy={busy}
          onFix={onFix}
          onApprove={onApprove}
          onSubmit={onSubmit}
        />
      ) : null}
    </div>
  );
}

function Editor({
  editor,
  actor,
  busy,
  onFix,
  onApprove,
  onSubmit,
}: {
  editor: RecipeEditorView;
  actor: RecipeCostingWorkspace["actor"];
  busy: boolean;
  onFix: (input: {
    odoo_product_id: number;
    raw_name: string;
    source_row?: number | null;
    unit?: string;
    quantity?: number;
    yield_value?: number;
    unit_cost?: number;
  }) => void;
  onApprove: () => void;
  onSubmit: () => void;
}) {
  return (
    <div>
      <Card className="mb-2.5 flex items-center gap-3 p-2.5">
        <div className="h-11 w-11 rounded-lg bg-gradient-to-br from-amber-300 to-amber-700" />
        <div>
          <div className="text-[17px] font-extrabold">
            {editor.odoo_name} <Chip tone="warn">{editor.version_label}</Chip>
          </div>
          <div className="text-xs text-slate-500">
            Odoo #{editor.odoo_product_id}
            {editor.share_label ? ` · ${editor.share_label}` : ""}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.8fr_1fr]">
        <Card className="p-3">
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">
              Ingredientes por porción
            </h2>
            <span className="ml-2 text-[11.5px] text-slate-400">
              Edita cantidades, unidades o rendimientos
            </span>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-slate-400">
                <th className="pb-1.5">Ingrediente</th>
                <th className="pb-1.5 text-right">Cantidad</th>
                <th className="pb-1.5">Unidad</th>
                <th className="pb-1.5 text-right">Costo unitario</th>
              </tr>
            </thead>
            <tbody>
              {editor.lines.map((line) => (
                <LineRow
                  key={`${line.raw_name}-${line.source_row}`}
                  line={line}
                  yieldValue={editor.yield_value}
                  yieldAssumed={editor.yield_assumed}
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
            </tbody>
          </table>
          <div className="mt-1.5 text-[10.5px] text-slate-400">
            {editor.excel_row_label
              ? `Excel original: ${editor.excel_row_label}`
              : "Sin fila de Excel vinculada"}
            {" · tus correcciones quedan protegidas en futuras importaciones"}
          </div>
        </Card>

        <Card className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[9px] border border-slate-100 px-2.5 py-2">
              <div className="text-xs text-slate-500">Costo Milton</div>
              <div className="text-xl font-bold">
                {editor.milton_cost_label ?? "Pendiente"}
              </div>
              <div className="text-[10.5px] text-slate-400">por porción</div>
            </div>
            <div className="rounded-[9px] border border-slate-100 px-2.5 py-2">
              <div className="text-xs text-slate-500">
                Tu Excel (COSTO TOTAL)
              </div>
              <div className="text-xl font-bold">
                {editor.excel_total_label ?? "—"}
              </div>
              <div className="text-[10.5px] text-slate-400">
                referencia, no verdad absoluta
              </div>
            </div>
          </div>
          {editor.variance_note ? (
            <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
              {editor.variance_note}
            </div>
          ) : null}
          <div className="mb-1 mt-2.5 text-xs font-semibold text-slate-500">
            Antes de aprobar
          </div>
          {editor.checklist.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 py-0.5 text-[11.8px]"
            >
              <span
                className={
                  "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold " +
                  (item.ok
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-600")
                }
              >
                {item.ok ? "✓" : "×"}
              </span>
              {item.label}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
            <GhostBtn disabled={busy}>Guardar borrador</GhostBtn>
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
          <div className="mt-1.5 text-[10.5px] text-slate-400">
            Solo el dueño o un admin aprueba. Al aprobar, esta versión empieza a
            contar en los márgenes.
          </div>
        </Card>
      </div>
    </div>
  );
}

function LineRow({
  line,
  yieldValue,
  yieldAssumed,
  busy,
  onFix,
}: {
  line: RecipeEditorView["lines"][number];
  yieldValue: number | null;
  yieldAssumed: boolean;
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
      <tr className="border-t border-slate-100">
        <td className="py-1.5 pr-2">
          <b>{line.raw_name}</b>
          {line.pending ? (
            <div className="text-[10.5px] text-amber-700">Pendiente</div>
          ) : null}
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
            className="inline-block min-w-11 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right"
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
            className="w-16 rounded-md border border-slate-200 bg-white px-1.5 py-0.5"
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
              className="w-20 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-right font-bold"
            />
          ) : (
            line.cost_label
          )}
        </td>
      </tr>
      {line.is_sub_recipe ? (
        <tr>
          <td colSpan={4} className="bg-amber-50 px-2.5 py-1.5 text-[11.5px]">
            ↳ Preparación {line.raw_name}
            {yieldAssumed ? " · rendimiento por confirmar" : ""}
            {": rinde "}
            <input
              value={yieldQty}
              disabled={busy}
              onChange={(event) => setYieldQty(event.target.value)}
              onBlur={() => {
                const n = Number(yieldQty);
                if (Number.isFinite(n) && n > 0) onFix({ yield_value: n });
              }}
              className="inline-block min-w-11 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-right font-bold"
            />{" "}
            porciones
          </td>
        </tr>
      ) : null}
    </>
  );
}
