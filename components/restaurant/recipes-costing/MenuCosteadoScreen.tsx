"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { withShellParams } from "@/lib/restaurant/navigation";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import { Card, Chip, GhostBtn, PrimaryBtn, toneForKind } from "./ui";

export function MenuCosteadoScreen({
  data,
  onOpen,
}: {
  data: RecipeCostingWorkspace;
  onOpen: (view: "vincular" | "validar", odooProductId?: number) => void;
}) {
  const searchParams = useSearchParams();
  const href = withShellParams("/dashboard/restaurant/menu", {
    locationId: searchParams.get("location"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
  const excluded = data.products.filter(
    (row) => row.is_combo || !TREATMENT_RULES[row.treatment].needs_recipe
  );
  const stats = data.costeado_stats;
  return (
    <div className="space-y-3.5">
      <Card className="grid items-center gap-5 border-[#bfe5cf] bg-gradient-to-r from-[#f3fbf6] to-white md:grid-cols-[1.3fr_1fr]">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1f9d55] text-2xl font-extrabold text-white">
            ✓
          </div>
          <div>
            <h2 className="text-[22px] font-bold">Menú costeado</h2>
            <p className="mt-1 text-xs text-[#5b6476]">
              Terminaste las 4 etapas. Los márgenes del Menú y Costos ya usan
              tus recetas aprobadas.
            </p>
            <div className="mt-1 text-[10.5px] text-[#8a92a3]">
              {data.last_progress}
              {data.period_label ? ` · ventas ${data.period_label}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          <Link
            href={href}
            className="inline-flex items-center justify-center rounded-md border border-[#f28c28] bg-[#f28c28] px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#e07b1a]"
          >
            Ver rentabilidad del menú →
          </Link>
          <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
            Abre Rentabilidad y la matriz de Ingeniería de menú
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.45fr]">
        <Card>
          <div className="text-xs font-semibold text-[#6b7385]">
            Ventas netas con costo aprobado
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-[52px] font-extrabold leading-none text-[#1f9d55]">
              {data.coverage.coverage_label}
            </span>
            <span className="text-xs text-[#5b6476]">
              de las ventas que requieren costeo
            </span>
          </div>
          <div className="text-xs text-[#5b6476]">
            {data.coverage.covered_label} de {data.coverage.net_sales_label}
            {data.period_label ? ` · ${data.period_label}` : ""}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#eef0f4]">
            {data.coverage.slices
              .filter((slice) => slice.pct > 0)
              .map((slice) => (
                <div
                  key={slice.id}
                  style={{ width: `${slice.pct}%`, background: slice.color }}
                />
              ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[#6b7385]">
            {data.coverage.slices.map((slice) => (
              <span key={slice.id} className="inline-flex items-center gap-1">
                <i
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: slice.color }}
                />
                {slice.label} {slice.pct}%
              </span>
            ))}
          </div>
          <div className="mt-3 space-y-0 text-xs">
            <div className="flex justify-between border-t border-[#f2f3f6] py-1.5">
              <span>Platos y bebidas preparadas</span>
              <b>{stats.approved_prepared} aprobados</b>
            </div>
            <div className="flex justify-between border-t border-[#f2f3f6] py-1.5">
              <span>Excluidos del costeo</span>
              <b>{stats.excluded}</b>
            </div>
            <div className="flex justify-between border-t border-[#f2f3f6] py-1.5">
              <span>Pendientes</span>
              <b className={stats.pending > 0 ? "text-[#d14343]" : undefined}>
                {stats.pending}
              </b>
            </div>
            <div className="flex justify-between border-t border-[#f2f3f6] py-1.5">
              <span>Cuadra con Excel</span>
              <b className="text-[#1f9d55]">
                {stats.excel_matched} de {stats.excel_total}
              </b>
            </div>
          </div>
        </Card>
        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">Platos excluidos</h2>
            <span className="ml-2 text-[11.5px] text-[#8a92a3]">
              No cuentan en márgenes; no son errores
            </span>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
                <th className="pb-1.5">Producto del POS</th>
                <th className="pb-1.5">Motivo</th>
                <th className="pb-1.5 text-right">% ventas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {excluded.map((row) => (
                <tr
                  key={row.odoo_product_id}
                  className="border-t border-[#f2f3f6]"
                >
                  <td className="py-2.5 font-semibold">{row.odoo_name}</td>
                  <td className="py-2.5">
                    <Chip tone={excludedChip(row).tone}>
                      {excludedChip(row).label}
                    </Chip>
                    <span className="ml-1 text-[10.8px] text-[#5b6476]">
                      {excludedReason(row.kind_label, row.is_combo)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    {row.share_pct > 0 ? row.share_label : "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    {row.is_combo ? (
                      <GhostBtn
                        onClick={() => onOpen("vincular", row.odoo_product_id)}
                      >
                        Ver partes
                      </GhostBtn>
                    ) : row.kind_label === "Cargo" ? null : (
                      <GhostBtn
                        onClick={() => onOpen("vincular", row.odoo_product_id)}
                      >
                        {row.net_sales === 0 ? "Incluir" : "Ver"}
                      </GhostBtn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.9fr_1fr]">
        <Card>
          <div className="mb-1 flex items-center">
            <h2 className="text-[15px] font-semibold">
              Lo que queda, por impacto en ventas
            </h2>
            <span className="ml-2 text-[11.5px] text-[#8a92a3]">
              {data.todos.length > 0
                ? "Aún hay ventas sin costo aprobado"
                : "Nada pendiente"}
            </span>
          </div>
          {data.todos.length > 0 ? (
            <div className="mb-2 text-[10.5px] text-[#8a92a3]">
              Resuélvelos cuando puedas: el {data.coverage.coverage_label} ya
              basta para leer la rentabilidad del menú.
            </div>
          ) : null}
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
                <th className="pb-1.5" />
                <th className="pb-1.5">Plato del POS</th>
                <th className="pb-1.5">Por qué falta</th>
                <th className="pb-1.5 text-right">% ventas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.todos.map((row) => (
                <tr
                  key={row.odoo_product_id}
                  className="border-t border-[#f2f3f6]"
                >
                  <td className="py-2.5 text-[#8a92a3]">{row.rank}</td>
                  <td className="py-2.5 font-semibold">{row.odoo_name}</td>
                  <td className="py-2.5 text-[#5b6476]">
                    <Chip tone={toneForKind(row.kind_label)}>
                      {row.kind_label}
                    </Chip>{" "}
                    {row.reason}
                  </td>
                  <td className="py-2.5 text-right">{row.share_label}</td>
                  <td className="py-2.5 text-right">
                    {row.action_label === "Agregar precio" ? (
                      <PrimaryBtn
                        onClick={() =>
                          onOpen(
                            row.view as "vincular" | "validar",
                            row.odoo_product_id
                          )
                        }
                      >
                        {row.action_label}
                      </PrimaryBtn>
                    ) : (
                      <GhostBtn
                        onClick={() =>
                          onOpen(
                            row.view as "vincular" | "validar",
                            row.odoo_product_id
                          )
                        }
                      >
                        {row.action_label}
                      </GhostBtn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-4 py-4 text-xs leading-relaxed text-[#5b4515]">
          <b>Bueno saber</b>
          <br />
          <br />
          • Si editas una receta aprobada, la versión aprobada sigue contando
          mientras la nueva está en revisión.
          <br />
          <br />• «Cuadra con Excel» significa que el total coincide con tu
          archivo dentro de 2% o $0.05. No garantiza que la receta sea correcta.
        </div>
      </div>
    </div>
  );
}

function excludedChip(row: {
  is_combo: boolean;
  kind_label: string;
  display_state_label: string;
  display_state_tone: "ok" | "sug" | "warn" | "bad" | "grey" | "pur";
  treatment: string;
  treatment_label: string;
  net_sales: number;
  units_sold: number;
}): { label: string; tone: "ok" | "sug" | "warn" | "bad" | "grey" | "pur" } {
  if (row.is_combo) return { label: "Combo", tone: "pur" };
  if (row.treatment === "excluido")
    return { label: "No es comida", tone: "grey" };
  if (row.treatment === "modificador_sin_costo")
    return { label: "Sin costo", tone: "grey" };
  if (row.kind_label === "Cargo") return { label: "Cargo", tone: "grey" };
  if (row.kind_label === "Modificador")
    return { label: "Modificador", tone: "grey" };
  if (row.display_state_label === "Reventa")
    return { label: "Reventa", tone: "sug" };
  if (row.net_sales === 0 && row.units_sold === 0)
    return { label: "No vendido", tone: "grey" };
  return { label: row.display_state_label, tone: row.display_state_tone };
}

function excludedReason(kind: string, isCombo: boolean): string {
  if (isCombo) return "se costea por sus partes";
  if (kind === "Modificador") return "suma al plato base";
  if (kind === "Bebida") return "costo = precio de compra";
  if (kind === "Cargo") return "no es un producto";
  return "no requiere costeo";
}
