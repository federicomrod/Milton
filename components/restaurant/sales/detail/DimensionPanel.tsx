"use client";

// R1-17b (mocks 2 and 4): the Desglose. One dimension at a time (Categoría /
// Canal / Pago / Turno), as tiles (default) or as a table with $/unid. Both
// show exactly the same numbers. A click filters the whole page; ⌘/Ctrl/Shift
// adds to the selection; double-click (or «Ver platos») opens Platos.

import { useMemo, useState } from "react";
import {
  TILE_DELTA_THRESHOLD,
  type DetailView,
  type DimKey,
  type DimRow,
  type ViewKey,
} from "@/lib/restaurant/sales-detail";
import { pctLabel } from "./format";

const DIMS: Array<{ key: DimKey; label: string }> = [
  { key: "categoria", label: "Categoría" },
  { key: "canal", label: "Canal" },
  { key: "pago", label: "Pago" },
  { key: "turno", label: "Turno" },
];
const VISIBLE = 20;

/** Grey «≈» unless the change is ±15% or more; «—» without a comparable period. */
export function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null)
    return (
      <span
        className="text-[10.5px] font-bold text-[#b0b6c3]"
        title="Sin período comparable"
      >
        —
      </span>
    );
  if (Math.abs(delta) < TILE_DELTA_THRESHOLD)
    return (
      <span
        className="text-[10.5px] font-bold text-[#b0b6c3]"
        title={`${pctLabel(delta, 1)}`}
      >
        ≈
      </span>
    );
  const up = delta > 0;
  return (
    <span
      className={`rounded-lg px-1.5 py-px text-[10.5px] font-bold ${up ? "bg-[#A7F3D0] text-[#0F172A]" : "bg-[#FBCFE8] text-[#0F172A]"}`}
    >
      {pctLabel(delta)}
    </span>
  );
}

type SortKey = "label" | "net" | "tickets" | "units" | "perUnit" | "delta";

export function DimensionPanel({
  view,
  dim,
  mode,
  money,
  shiftsVisible,
  compareShort,
  onDim,
  onMode,
  onToggle,
  onClear,
  onSeeDishes,
}: {
  view: DetailView;
  dim: DimKey;
  mode: ViewKey;
  money: (n: number, d?: number) => string;
  shiftsVisible: boolean;
  compareShort: string;
  onDim: (d: DimKey) => void;
  onMode: (m: ViewKey) => void;
  onToggle: (token: string, multi: boolean) => void;
  onClear: () => void;
  onSeeDishes: (token: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "net",
    dir: -1,
  });
  const dims = DIMS.filter((d) => d.key !== "turno" || shiftsVisible);
  const rows = view.dimRows;
  const sorted = useMemo(() => {
    const v = (r: DimRow): number | string =>
      sort.key === "label" ? r.label : (r[sort.key] ?? -Infinity);
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      return (
        (typeof x === "string"
          ? x.localeCompare(y as string, "es")
          : (x as number) - (y as number)) * sort.dir
      );
    });
  }, [rows, sort]);
  const shown = mode === "tarjetas" ? rows : sorted;
  const list = showAll ? shown : shown.slice(0, VISIBLE);
  const top = rows[0]?.net ?? 0;
  const noun = DIMS.find((d) => d.key === dim)?.label ?? "";
  const onRow = (r: DimRow, e: React.MouseEvent) =>
    onToggle(r.token, e.metaKey || e.ctrlKey || e.shiftKey);
  const head = (key: SortKey, label: string, right = true) => (
    <th
      className={`px-2 py-1.5 ${right ? "text-right" : "text-left"} text-[11px] font-semibold text-[#8a92a3]`}
    >
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key,
            dir:
              s.key === key ? (s.dir === 1 ? -1 : 1) : key === "label" ? 1 : -1,
          }))
        }
      >
        {label}
        {sort.key === key ? (sort.dir === -1 ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );

  return (
    <section data-testid="sales-breakdown">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Dimensión"
          className="inline-flex rounded-[10px] bg-[#e9ecf2] p-[3px]"
        >
          {dims.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={dim === d.key}
              onClick={() => onDim(d.key)}
              className={
                "rounded-lg px-3 py-1 text-[12.5px] font-semibold " +
                (dim === d.key
                  ? "bg-white text-[#151c2c] shadow-sm"
                  : "text-[#5b6476]")
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Vista"
          className="inline-flex rounded-[10px] bg-[#e9ecf2] p-[3px]"
        >
          <button
            type="button"
            aria-pressed={mode === "tarjetas"}
            onClick={() => onMode("tarjetas")}
            className={
              "rounded-lg px-3 py-1 text-[12.5px] font-semibold " +
              (mode === "tarjetas"
                ? "bg-white text-[#151c2c] shadow-sm"
                : "text-[#5b6476]")
            }
          >
            ▦ Tarjetas
          </button>
          <button
            type="button"
            aria-pressed={mode === "tabla"}
            onClick={() => onMode("tabla")}
            className={
              "rounded-lg px-3 py-1 text-[12.5px] font-semibold " +
              (mode === "tabla"
                ? "bg-white text-[#151c2c] shadow-sm"
                : "text-[#5b6476]")
            }
          >
            ☰ Tabla
          </button>
        </div>
        {view.selection ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-[#eef2fd] px-2.5 py-0.5 text-[12px] font-semibold text-[#1b40c8]"
            data-testid="sales-selection-chip"
          >
            {view.selection.labels.join(" + ")} · {money(view.selection.net)} ·{" "}
            {view.selection.share.toFixed(1)}%
            <button
              type="button"
              aria-label="Quitar la selección"
              onClick={onClear}
            >
              ✕
            </button>
          </span>
        ) : null}
        {dim === "categoria" ? (
          <button
            type="button"
            onClick={() =>
              onSeeDishes(
                view.selection?.labels.length === 1
                  ? view.selection.labels[0]
                  : null
              )
            }
            className="text-[12px] font-semibold text-[#1b40c8] hover:underline"
          >
            Ver platos →
          </button>
        ) : null}
        <span className="ml-auto text-[11.5px] text-[#8a92a3]">
          clic = filtra · ⌘ = varias ·{" "}
          {mode === "tabla" ? "clic en columna = ordenar" : "Ventas ▾"}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#8a92a3]">
          Sin ventas con estos filtros.
        </p>
      ) : mode === "tarjetas" ? (
        <div
          className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5"
          data-testid="sales-tiles"
        >
          {list.map((r) => (
            <button
              key={r.token}
              type="button"
              aria-pressed={r.selected}
              onClick={(e) => onRow(r, e)}
              onDoubleClick={() => dim === "categoria" && onSeeDishes(r.token)}
              className={
                "relative rounded-[11px] border px-2.5 py-2 text-left " +
                (r.selected
                  ? "border-[#1b40c8] bg-[#f7f9ff] ring-1 ring-[#1b40c8]"
                  : "border-[#eef0f4] bg-white hover:border-[#a9bcf0]")
              }
            >
              <div className="truncate pr-9 text-[12px] font-semibold">
                {r.label}
              </div>
              <span className="absolute right-2.5 top-2 text-[11px] text-[#8a92a3]">
                {r.share.toFixed(1)}%
              </span>
              <div className="flex items-center justify-between">
                <span className="text-[19px] font-extrabold text-[#151c2c]">
                  {money(r.net)}
                </span>
                <DeltaChip delta={r.delta} />
              </div>
              <div className="my-1 h-1 rounded bg-[#f2f3f6]">
                <i
                  className="block h-full rounded"
                  style={{
                    width: `${top > 0 ? (r.net / top) * 100 : 0}%`,
                    background: r.selected ? "#1b40c8" : "#9fb0ea",
                  }}
                />
              </div>
              <div className="text-[11px] text-[#8a92a3]">
                {r.tickets} tickets ·{" "}
                {Math.round(r.units).toLocaleString("es-MX")} unid.
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[#eef0f4] bg-white px-3 py-1.5">
          <table className="w-full text-[12.5px]" data-testid="sales-table">
            <thead>
              <tr className="border-b border-[#eef0f4]">
                <th className="w-6" />
                {head("label", noun, false)}
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-[#8a92a3]">
                  Participación
                </th>
                {head("net", "Ventas")}
                {head("tickets", "Tickets")}
                {head("units", "Unid.")}
                {head("perUnit", "$/unid.")}
                {head("delta", `Δ vs ${compareShort}`)}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr
                  key={r.token}
                  onClick={(e) => onRow(r, e)}
                  onDoubleClick={() =>
                    dim === "categoria" && onSeeDishes(r.token)
                  }
                  aria-selected={r.selected}
                  className={
                    "cursor-pointer border-b border-[#f2f3f6] " +
                    (r.selected ? "bg-[#eef2fd]" : "hover:bg-[#f7f9ff]")
                  }
                >
                  <td className="px-1 text-center">{r.selected ? "☑" : "☐"}</td>
                  <td className="px-2 py-1 font-bold">{r.label}</td>
                  <td className="px-2 py-1">
                    <span
                      className="inline-block h-[7px] rounded"
                      style={{
                        width: `${top > 0 ? (r.net / top) * 120 : 0}px`,
                        background: r.selected ? "#1b40c8" : "#9fb0ea",
                      }}
                    />{" "}
                    <span className="text-[11.5px] text-[#8a92a3]">
                      {r.share.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right font-bold">
                    {money(r.net)}
                  </td>
                  <td className="px-2 py-1 text-right">{r.tickets}</td>
                  <td className="px-2 py-1 text-right">
                    {Math.round(r.units).toLocaleString("es-MX")}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.perUnit === null ? "—" : money(r.perUnit, 2)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <DeltaChip delta={r.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-[11.5px] text-[#8a92a3]">
        {shown.length > VISIBLE ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-semibold text-[#1b40c8] hover:underline"
          >
            {showAll ? "Ver menos" : `Ver todas (${shown.length})`}
          </button>
        ) : null}
        <span>
          Δ coloreado solo si el cambio es notable vs {view.compare.label}
        </span>
        {view.compare.baseline?.note ? (
          <span>· {view.compare.baseline.note}</span>
        ) : null}
      </div>
    </section>
  );
}
