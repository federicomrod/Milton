"use client";

import { useMemo, useState } from "react";
import type {
  VincularFilter,
  VincularProductRow,
  RecipeCostingWorkspace,
} from "@/lib/restaurant/recipe-costing/workspace";
import { matchesVincularFilter } from "@/lib/restaurant/recipe-costing/workspace";
import { Card, Chip, GhostBtn, PrimaryBtn, toneForKind } from "./ui";

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
  busy,
}: {
  data: RecipeCostingWorkspace;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onConfirm: (product: VincularProductRow) => void;
  onChange: (product: VincularProductRow, menuItemId: string) => void;
  onCreate: (product: VincularProductRow) => void;
  onUndo: (product: VincularProductRow) => void;
  busy: boolean;
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
      <div className="mb-1 text-[10.5px] text-slate-400">
        Menú › Recetas y costeo ›{" "}
        <b className="text-slate-900">Paso 2 de 4 · Vincular recetas</b>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar"
              className="h-8 w-[170px] rounded-lg border border-slate-200 px-2.5 text-xs"
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
                      : "border-slate-200 bg-white text-slate-600")
                  }
                >
                  {item.label} {data.filter_counts[item.id]}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-slate-400">
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
                      "cursor-pointer border-t border-slate-100 " +
                      (active ? "bg-amber-50" : "")
                    }
                    onClick={() => onSelect(row.odoo_product_id)}
                  >
                    <td className="py-1.5 pr-2">
                      <b>{row.odoo_name}</b>
                      <div className="text-[10.5px] text-slate-400">
                        Odoo #{row.odoo_product_id} · {row.kind_label}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {row.net_sales_label}
                      <div className="text-[10.5px] text-slate-400">
                        {row.share_label}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      {row.is_combo && row.components.length > 0
                        ? "Por sus partes"
                        : (row.recipe_name ?? "—")}
                    </td>
                    <td className="py-1.5 pr-2 text-[10.8px] text-slate-500">
                      {row.evidence_label}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Chip tone={toneForKind(row.link_state_label)}>
                        {row.link_state_label}
                      </Chip>
                    </td>
                    <td className="py-1.5 text-right">
                      {row.confirmed ? (
                        <button
                          type="button"
                          className="text-[10.5px] text-slate-400"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUndo(row);
                          }}
                        >
                          Deshacer
                        </button>
                      ) : row.link_state === "sugerido" ? (
                        <PrimaryBtn
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            onConfirm(row);
                          }}
                        >
                          Confirmar
                        </PrimaryBtn>
                      ) : (
                        <GhostBtn
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            onCreate(row);
                          }}
                        >
                          Crear receta
                        </GhostBtn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1.5 text-[10.5px] text-slate-400">
            Milton nunca vincula solo un caso ambiguo: lo deja aquí hasta que
            alguien lo elija.
          </div>
        </Card>

        <Card className="p-3.5">
          {selected ? (
            <SidePanel
              product={selected}
              menuItems={data.menu_items}
              picking={picking}
              busy={busy}
              onPicking={setPicking}
              onConfirm={() => onConfirm(selected)}
              onChange={(id) => onChange(selected, id)}
              onCreate={() => onCreate(selected)}
              onUndo={() => onUndo(selected)}
            />
          ) : (
            <p className="text-sm text-slate-500">Elige un producto del POS.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function SidePanel({
  product,
  menuItems,
  picking,
  busy,
  onPicking,
  onConfirm,
  onChange,
  onCreate,
  onUndo,
}: {
  product: VincularProductRow;
  menuItems: Array<{ id: string; name: string }>;
  picking: boolean;
  busy: boolean;
  onPicking: (v: boolean) => void;
  onConfirm: () => void;
  onChange: (menuItemId: string) => void;
  onCreate: () => void;
  onUndo: () => void;
}) {
  const ev = product.evidence;
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">
        Odoo #{product.odoo_product_id} · {product.kind_label}
      </div>
      <div className="text-[17px] font-bold">{product.odoo_name}</div>
      <div className="text-xs text-slate-500">
        {product.net_sales_label} · {product.share_label} de las ventas
      </div>
      <div className="my-2.5 rounded-[10px] border border-blue-200 bg-blue-50 p-2.5">
        <div className="text-xs font-medium text-slate-500">
          Sugerencia de Milton
        </div>
        <div>
          <b className="text-sm">
            {ev.block_name ?? product.recipe_name ?? "Sin receta"}
          </b>
          {ev.tab ? (
            <span className="text-[10.5px] text-slate-400">
              {" "}
              · hoja {ev.tab}
            </span>
          ) : null}
        </div>
        {ev.reasons.slice(0, 3).map((reason) => (
          <div key={reason} className="mt-1 flex gap-1.5 text-[11.8px]">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
              !
            </span>
            {reason}
          </div>
        ))}
        {ev.reasons.length === 0 && ev.block_name ? (
          <div className="mt-1 flex gap-1.5 text-[11.8px]">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
              ✓
            </span>
            Nombre sugerido desde tu archivo
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <PrimaryBtn
          disabled={busy || !product.menu_item_id}
          onClick={onConfirm}
        >
          Confirmar vínculo
        </PrimaryBtn>
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
      {picking ? (
        <label className="mt-3 block text-xs font-semibold text-slate-500">
          Elige otra receta
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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
          <div className="text-xs font-semibold text-slate-500">
            Partes del combo
          </div>
          {product.components.map((part) => (
            <div
              key={part.odoo_product_id}
              className="flex justify-between py-1 text-[11.8px]"
            >
              <span>
                {part.odoo_name}{" "}
                <span className="text-slate-400">#{part.odoo_product_id}</span>
              </span>
              <span className="text-slate-400">{part.net_sales_label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
        <b>¿Otro producto usa la misma receta?</b>
        <br />
        Puedes compartirla solo si lleva lo mismo, en la misma cantidad.
      </div>
    </div>
  );
}
