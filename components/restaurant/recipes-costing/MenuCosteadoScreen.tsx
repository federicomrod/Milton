"use client";

import Link from "next/link";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { Card, Chip, GhostBtn, toneForKind } from "./ui";

export function MenuCosteadoScreen({
  data,
  onOpen,
}: {
  data: RecipeCostingWorkspace;
  onOpen: (view: "vincular" | "validar", odooProductId?: number) => void;
}) {
  const excluded = data.products.filter(
    (row) =>
      row.is_combo ||
      row.classification === "no_requiere_costeo" ||
      row.classification === "componente"
  );
  return (
    <div className="space-y-3">
      <Card className="grid items-center gap-5 border-emerald-200 bg-gradient-to-r from-emerald-50 to-white md:grid-cols-[1.3fr_1fr]">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-2xl font-extrabold text-white">
            ✓
          </div>
          <div>
            <h2 className="text-[22px] font-bold">Menú costeado</h2>
            <p className="mt-1 text-xs text-slate-500">
              Terminaste las 4 etapas. Los márgenes del Menú y Costos ya usan
              tus recetas aprobadas.
            </p>
          </div>
        </div>
        <div className="text-right">
          <Link
            href="/dashboard/restaurant/menu"
            className="inline-flex items-center justify-center rounded-md border border-[#f28c28] bg-[#f28c28] px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#e07b1a]"
          >
            Ver rentabilidad del menú →
          </Link>
          <div className="mt-1.5 text-[10.5px] text-slate-400">
            Abre Rentabilidad y la matriz de Ingeniería de menú
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.45fr]">
        <Card>
          <div className="text-xs font-semibold text-slate-500">
            Ventas netas con costo aprobado
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-[52px] font-extrabold leading-none text-emerald-600">
              {data.coverage.coverage_label}
            </span>
            <span className="text-xs text-slate-500">
              de las ventas que requieren costeo
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {data.coverage.covered_label} de {data.coverage.net_sales_label}
            {data.period_label ? ` · ${data.period_label}` : ""}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {data.coverage.slices
              .filter((slice) => slice.pct > 0)
              .map((slice) => (
                <div
                  key={slice.id}
                  style={{ width: `${slice.pct}%`, background: slice.color }}
                />
              ))}
          </div>
        </Card>
        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">Platos excluidos</h2>
            <span className="ml-2 text-[11.5px] text-slate-400">
              No cuentan en márgenes; no son errores
            </span>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-slate-400">
                <th className="pb-1.5">Producto del POS</th>
                <th className="pb-1.5">Motivo</th>
                <th className="pb-1.5 text-right">% ventas</th>
              </tr>
            </thead>
            <tbody>
              {excluded.map((row) => (
                <tr
                  key={row.odoo_product_id}
                  className="border-t border-slate-100"
                >
                  <td className="py-1.5 font-semibold">{row.odoo_name}</td>
                  <td className="py-1.5">
                    <Chip tone={toneForKind(row.kind_label)}>
                      {row.kind_label}
                    </Chip>
                    <span className="ml-1 text-slate-500">
                      {row.evidence_label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{row.share_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {data.todos.length > 0 ? (
        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">
              Lo que queda, por impacto en ventas
            </h2>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-slate-400">
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
                  className="border-t border-slate-100"
                >
                  <td className="py-1.5 text-slate-400">{row.rank}</td>
                  <td className="py-1.5 font-semibold">{row.odoo_name}</td>
                  <td className="py-1.5 text-slate-500">{row.reason}</td>
                  <td className="py-1.5 text-right">{row.share_label}</td>
                  <td className="py-1.5 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-4 text-xs leading-relaxed text-amber-950">
        <b>Bueno saber</b>
        <br />
        <br />
        • Si editas una receta aprobada, la versión aprobada sigue contando
        mientras la nueva está en revisión.
        <br />• «Cuadra con Excel» significa que el total coincide con tu
        archivo dentro de 2% o $0.05. No garantiza que la receta sea correcta.
      </div>
    </div>
  );
}
