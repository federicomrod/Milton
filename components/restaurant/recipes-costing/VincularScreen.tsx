"use client";

import { useMemo, useState } from "react";
import type {
  VincularFilter,
  VincularProductRow,
  RecipeCostingWorkspace,
} from "@/lib/restaurant/recipe-costing/workspace";
import { matchesVincularFilter } from "@/lib/restaurant/recipe-costing/workspace";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import { TreatmentControl, type PostFn } from "./TreatmentPanel";
import { Card, Chip, GhostBtn, PrimaryBtn } from "./ui";

const FILTERS: Array<{ id: VincularFilter; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "por_resolver", label: "Por resolver" },
  { id: "confirmados", label: "Confirmados" },
  { id: "combos_otros", label: "Combos y otros" },
];

export function VincularScreen({
  data,
  selectedId,
  onSelect,
  onConfirm,
  onChange,
  onCreate,
  onUndo,
  onShare,
  onGenerateSuggestions,
  generateBusy,
  busy,
  onPost,
}: {
  data: RecipeCostingWorkspace;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onConfirm: (product: VincularProductRow) => void;
  onChange: (product: VincularProductRow, menuItemId: string) => void;
  onCreate: (product: VincularProductRow) => void;
  onUndo: (product: VincularProductRow) => void;
  onShare: (target: VincularProductRow, menuItemId: string) => void;
  onGenerateSuggestions: () => void;
  generateBusy: boolean;
  busy: boolean;
  onPost: PostFn;
}) {
  const [filter, setFilter] = useState<VincularFilter>("por_resolver");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.products.filter((row) => {
      if (!matchesVincularFilter(row, filter)) return false;
      if (!q) return true;
      return (
        row.odoo_name.toLowerCase().includes(q) ||
        String(row.odoo_product_id).includes(q) ||
        (row.recipe_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [data.products, filter, query]);
  const selected =
    rows.find((row) => row.odoo_product_id === selectedId) ??
    data.products.find((row) => row.odoo_product_id === selectedId) ??
    rows[0] ??
    null;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <GhostBtn disabled={generateBusy} onClick={onGenerateSuggestions}>
          {generateBusy
            ? "Generando sugerencias…"
            : "Generar sugerencias desde tu archivo"}
        </GhostBtn>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="🔍 Buscar"
              className="h-8 w-[170px] rounded-lg border border-[#d5dae3] bg-white px-2.5 text-xs text-[#8a92a3]"
            />
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={
                    "rounded-full border px-3 py-1 text-xs " +
                    (filter === item.id
                      ? "border-[#151c2c] bg-[#151c2c] font-semibold text-white"
                      : "border-[#dfe3ea] bg-white text-[#4b5466]")
                  }
                >
                  {item.label} {data.filter_counts[item.id]}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
                <th className="pb-1.5 pr-2">Producto del POS</th>
                <th className="pb-1.5 pr-2 text-right">Ventas</th>
                <th className="pb-1.5 pr-2">Receta</th>
                <th className="pb-1.5 pr-2">Evidencia</th>
                <th className="pb-1.5 pr-2">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const active =
                  selected?.odoo_product_id === row.odoo_product_id;
                return (
                  <tr
                    key={row.odoo_product_id}
                    className={
                      "cursor-pointer border-t border-[#f2f3f6] " +
                      (active ? "bg-[#fffaf3]" : "")
                    }
                    onClick={() => onSelect(row.odoo_product_id)}
                  >
                    <td className="py-1.5 pr-2">
                      <b>{row.odoo_name}</b>
                      <div className="text-[10.5px] text-[#8a92a3]">
                        Odoo #{row.odoo_product_id} · {row.kind_label}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {row.net_sales_label}
                      <div className="text-[10.5px] text-[#8a92a3]">
                        {row.units_label}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      {row.is_combo
                        ? "Por sus partes"
                        : !TREATMENT_RULES[row.treatment].needs_recipe
                          ? row.treatment_label
                          : (row.recipe_name ?? "—")}
                    </td>
                    <td className="py-1.5 pr-2 text-[10.8px] text-[#5b6476]">
                      {row.evidence_label}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Chip tone={row.display_state_tone}>
                        {row.display_state_label}
                      </Chip>
                    </td>
                    <td className="py-1.5 text-right">
                      <RowAction
                        row={row}
                        busy={busy}
                        onSelect={onSelect}
                        onConfirm={onConfirm}
                        onCreate={onCreate}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
            Milton nunca vincula solo un caso ambiguo: lo deja aquí hasta que
            alguien lo elija.
          </div>
        </Card>

        <Card className="p-3.5">
          {selected ? (
            <SidePanel
              key={selected.odoo_product_id}
              treatment={
                <TreatmentControl
                  product={selected}
                  options={data.treatment_options}
                  canEdit={data.actor.can_submit}
                  busy={busy}
                  onPost={onPost}
                />
              }
              product={selected}
              products={data.products}
              menuItems={data.menu_items}
              picking={picking}
              busy={busy}
              onPicking={setPicking}
              onConfirm={() => onConfirm(selected)}
              onChange={(id) => onChange(selected, id)}
              onCreate={() => onCreate(selected)}
              onUndo={() => onUndo(selected)}
              onShare={(target) => {
                if (selected.menu_item_id)
                  onShare(target, selected.menu_item_id);
              }}
            />
          ) : (
            <p className="text-sm text-[#5b6476]">Elige un producto del POS.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function RowAction({
  row,
  busy,
  onSelect,
  onConfirm,
  onCreate,
}: {
  row: VincularProductRow;
  busy: boolean;
  onSelect: (id: number) => void;
  onConfirm: (product: VincularProductRow) => void;
  onCreate: (product: VincularProductRow) => void;
}) {
  if (row.action_label === "Cambiar" || row.action_label === "Ver partes") {
    return (
      <button
        type="button"
        className="text-[10.5px] text-[#8a92a3]"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(row.odoo_product_id);
        }}
      >
        {row.action_label}
      </button>
    );
  }
  if (row.can_confirm_suggestion || row.action_label === "Confirmar") {
    return (
      <PrimaryBtn
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onConfirm(row);
        }}
      >
        Confirmar
      </PrimaryBtn>
    );
  }
  if (row.action_label === "Crear receta") {
    return (
      <GhostBtn
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onCreate(row);
        }}
      >
        Crear receta
      </GhostBtn>
    );
  }
  return (
    <GhostBtn
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(row.odoo_product_id);
      }}
    >
      {row.action_label}
    </GhostBtn>
  );
}

function SidePanel({
  treatment,
  product,
  products,
  menuItems,
  picking,
  busy,
  onPicking,
  onConfirm,
  onChange,
  onCreate,
  onUndo,
  onShare,
}: {
  treatment: React.ReactNode;
  product: VincularProductRow;
  products: VincularProductRow[];
  menuItems: Array<{ id: string; name: string; selling_price?: number | null }>;
  picking: boolean;
  busy: boolean;
  onPicking: (v: boolean) => void;
  onConfirm: () => void;
  onChange: (menuItemId: string) => void;
  onCreate: () => void;
  onUndo: () => void;
  onShare: (target: VincularProductRow) => void;
}) {
  const ev = product.evidence;
  const bound = product.suggestion_bound;
  const canConfirm = product.can_confirm_suggestion;
  const others = menuItems
    .filter((item) => item.id !== product.menu_item_id)
    .slice(0, 4);
  const shareTargets = products.filter(
    (row) =>
      row.odoo_product_id !== product.odoo_product_id &&
      row.menu_item_id !== product.menu_item_id
  );
  return (
    <div>
      <div className="text-[11.5px] text-[#6b7385]">
        Odoo #{product.odoo_product_id} · {product.kind_label}
        {product.category ? ` · ${product.category}` : ""}
      </div>
      <div className="text-[17px] font-bold text-[#1b2333]">
        {product.odoo_name}
      </div>
      <div className="text-xs text-[#5b6476]">
        {product.pos_price_label
          ? `Precio POS ${product.pos_price_label} · `
          : ""}
        {product.units_label} ·{" "}
        {product.in_food_sales
          ? `${product.share_label} de las ventas de comida`
          : "no cuenta en la cobertura"}
      </div>
      {treatment}
      <div className="my-2.5 rounded-[10px] border border-[#c9d4ef] bg-[#f6f8ff] p-2.5">
        <div className="text-[11.5px] text-[#6b7385]">Sugerencia de Milton</div>
        <div>
          <b className="text-sm">
            {ev.block_name ?? product.recipe_name ?? "Sin receta"}
          </b>
          {product.source_label ? (
            <span className="text-[10.5px] text-[#8a92a3]">
              {" "}
              · {product.source_label}
            </span>
          ) : ev.tab ? (
            <span className="text-[10.5px] text-[#8a92a3]">
              {" "}
              · hoja {ev.tab}
            </span>
          ) : null}
        </div>
        {product.evidence_checks.map((item) => (
          <div key={item.label} className="mt-1 flex gap-1.5 text-[11.8px]">
            <CheckDot ok={item.ok} warn={item.warn} />
            {item.label}
          </div>
        ))}
        {!bound ? (
          <div className="mt-1 flex gap-1.5 text-[11.8px]">
            <CheckDot ok={false} warn />
            {product.preview_lines.length === 0
              ? "Esta sugerencia no trae ingredientes. No confirmes un nombre vacío."
              : "Esta sugerencia no está atada a un bloque de tu Excel."}
          </div>
        ) : null}
      </div>

      {product.preview_lines.length > 0 ? (
        <div className="mb-2.5 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-[#8a92a3]">
                <th className="pb-1 pr-2">Ingrediente</th>
                <th className="pb-1 pr-2 text-right">Cant.</th>
                <th className="pb-1 pr-2">Unidad</th>
                <th className="pb-1 pr-2 text-right">Costo unit.</th>
                <th className="pb-1 text-right">Aporte</th>
              </tr>
            </thead>
            <tbody>
              {product.preview_lines.map((line) => (
                <tr
                  key={`${line.raw_name}-${line.source_row}`}
                  className="border-t border-[#f2f3f6]"
                >
                  <td className="py-1 pr-2">
                    <b>{line.raw_name}</b>
                    {line.pending ? (
                      <div className="text-[10px] text-amber-700">
                        Pendiente
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 text-right">{line.qty || "—"}</td>
                  <td className="py-1 pr-2">{line.unit || "—"}</td>
                  <td className="py-1 pr-2 text-right">
                    {line.unit_cost_label}
                  </td>
                  <td className="py-1 text-right font-semibold">
                    {line.aporte_label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-2.5 text-[12px] text-[#5b6476]">
          No hay líneas de receta para mostrar. Genera sugerencias desde tu
          archivo o crea la receta a mano.
        </p>
      )}

      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
          <div className="text-[10.5px] text-[#6b7385]">Costo Milton</div>
          <div className="text-sm font-bold">
            {product.milton_cost_label ?? "Pendiente"}
          </div>
        </div>
        <div className="rounded-[9px] border border-[#eef0f4] px-2.5 py-2">
          <div className="text-[10.5px] text-[#6b7385]">
            Tu Excel (COSTO TOTAL)
          </div>
          <div className="text-sm font-bold">
            {product.excel_total_label ?? "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {canConfirm ? (
          <PrimaryBtn
            disabled={busy || !product.menu_item_id}
            onClick={onConfirm}
          >
            Confirmar vínculo
          </PrimaryBtn>
        ) : null}
        <GhostBtn disabled={busy} onClick={() => onPicking(!picking)}>
          Elegir otra
        </GhostBtn>
        <GhostBtn disabled={busy} onClick={onCreate}>
          Crear receta
        </GhostBtn>
        {product.can_undo ? (
          <GhostBtn disabled={busy} onClick={onUndo}>
            Deshacer
          </GhostBtn>
        ) : null}
      </div>
      {others.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[#6b7385]">
            Otras opciones
          </div>
          {others.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              onClick={() => onChange(item.id)}
              className="flex w-full items-center justify-between py-1 text-left text-[11.8px] hover:text-[#3557c9]"
            >
              <span>{item.name}</span>
              <span className="text-[#8a92a3]">
                {item.selling_price
                  ? `precio $${item.selling_price.toFixed(2)}`
                  : "elegir"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {picking ? (
        <label className="mt-3 block text-xs font-semibold text-[#6b7385]">
          Elige otra receta
          <select
            className="mt-1 w-full rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="">—</option>
            {menuItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {product.is_combo ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[#6b7385]">
            Partes del combo
          </div>
          {product.components.map((part) => (
            <div
              key={part.odoo_product_id}
              className="flex justify-between py-1 text-[11.8px]"
            >
              <span>
                {part.odoo_name}{" "}
                <span className="text-[#8a92a3]">#{part.odoo_product_id}</span>
              </span>
              <span className="text-[#8a92a3]">{part.net_sales_label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2.5 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-3 py-2.5 text-xs text-[#5b4515]">
        <b>¿Otro producto usa la misma receta?</b>
        <br />
        {product.share_hint ??
          "Puedes compartirla solo si lleva lo mismo, en la misma cantidad."}{" "}
        {product.menu_item_id && shareTargets[0] ? (
          <button
            type="button"
            className="font-semibold text-[#3557c9]"
            disabled={busy}
            onClick={() => onShare(shareTargets[0])}
          >
            Compartir receta
          </button>
        ) : (
          <span className="font-semibold text-[#3557c9]">Compartir receta</span>
        )}
      </div>
    </div>
  );
}

function CheckDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#e7f6ee] text-[10px] font-bold text-[#1f9d55]">
        ✓
      </span>
    );
  }
  if (warn) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#fff4e5] text-[10px] font-bold text-[#c2700a]">
        !
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#fdecec] text-[10px] font-bold text-[#d14343]">
      ×
    </span>
  );
}
