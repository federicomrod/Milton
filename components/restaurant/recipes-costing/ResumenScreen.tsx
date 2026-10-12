"use client";

import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { Card, Chip, GhostBtn, PrimaryBtn, toneForKind } from "./ui";

export function ResumenScreen({
  data,
  onOpen,
  onUndoBatch,
}: {
  data: RecipeCostingWorkspace;
  onOpen: (view: "vincular" | "validar", odooProductId?: number) => void;
  onUndoBatch: (batchId: string) => void;
}) {
  const { coverage, stepper, next_dish, classification } = data;
  return (
    <div className="space-y-3">
      <Card>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
          {stepper.map((step) => (
            <div
              key={step.id}
              className={
                "flex gap-2.5 rounded-[10px] border p-2.5 " +
                (step.state === "cur"
                  ? "border-amber-300 bg-amber-50"
                  : "border-slate-100")
              }
            >
              <div
                className={
                  "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                  (step.state === "done"
                    ? "bg-emerald-600 text-white"
                    : step.state === "cur"
                      ? "bg-[#f28c28] text-white"
                      : "bg-slate-100 text-slate-500")
                }
              >
                {step.state === "done" ? "✓" : step.id}
              </div>
              <div>
                <div className="text-[12.5px] font-semibold">{step.title}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {step.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="grid items-center gap-4 md:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="text-xs font-semibold text-slate-500">
            Ventas netas con costo aprobado
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="text-[28px] font-extrabold leading-none">
              {coverage.coverage_label}
            </span>
            <span className="text-xs text-slate-500">
              {coverage.covered_label} de {coverage.net_sales_label}
              {data.period_label ? ` · ${data.period_label}` : ""}
              {` · ${coverage.dishes_approved} de ${coverage.dishes_need_recipe} platos`}
            </span>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {coverage.slices
              .filter((slice) => slice.pct > 0)
              .map((slice) => (
                <div
                  key={slice.id}
                  style={{ width: `${slice.pct}%`, background: slice.color }}
                />
              ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
            {coverage.slices.map((slice) => (
              <span key={slice.id} className="inline-flex items-center gap-1">
                <i
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: slice.color }}
                />
                {slice.label} {slice.pct}%
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="mb-2 text-xs text-slate-500">
            {coverage.margins_note}
          </div>
          <PrimaryBtn
            className="px-4 py-2 text-[13px]"
            disabled={!next_dish}
            onClick={() =>
              next_dish &&
              onOpen(
                next_dish.view as "vincular" | "validar",
                next_dish.odoo_product_id
              )
            }
          >
            {next_dish?.label ?? "Nada pendiente"}
          </PrimaryBtn>
          <div className="mt-1.5 text-[10.5px] text-slate-400">
            {data.last_progress}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.85fr_1fr]">
        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">
              Qué falta, por impacto en ventas
            </h2>
            <span className="ml-2.5 text-[11.5px] text-slate-400">
              Primero lo que más vende
            </span>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-slate-400">
                <th className="pb-1.5 pr-2" />
                <th className="pb-1.5 pr-2">Plato del POS</th>
                <th className="pb-1.5 pr-2">Por qué falta</th>
                <th className="pb-1.5 pr-2">Estado</th>
                <th className="pb-1.5 pr-2 text-right">% ventas</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {data.todos.map((row) => (
                <tr
                  key={row.odoo_product_id}
                  className="border-t border-slate-100"
                >
                  <td className="py-1.5 pr-2 text-slate-400">{row.rank}</td>
                  <td className="py-1.5 pr-2 font-semibold">{row.odoo_name}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{row.reason}</td>
                  <td className="py-1.5 pr-2">
                    <Chip tone={toneForKind(row.kind_label)}>
                      {row.kind_label}
                    </Chip>
                  </td>
                  <td className="py-1.5 pr-2 text-right">{row.share_label}</td>
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
              {data.todos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-400">
                    No hay pendientes. Ya puedes leer los márgenes aprobados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {data.todos_total > data.todos.length ? (
            <div className="mt-2 flex justify-between text-[10.5px] text-slate-400">
              <span>
                {data.todos.length} de {data.todos_total} pendientes
              </span>
              <button
                type="button"
                className="font-semibold text-blue-700"
                onClick={() => onOpen("vincular")}
              >
                Ver todos →
              </button>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">Tu menú en Odoo</h2>
            <button
              type="button"
              className="ml-auto text-xs font-semibold text-blue-700"
              onClick={() => onOpen("vincular")}
            >
              Revisar clasificación →
            </button>
          </div>
          {classification.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between border-t border-slate-100 py-1.5 text-[12px]"
            >
              <span>{row.label}</span>
              <span>
                <b>{row.count}</b>{" "}
                <span className="text-[10.5px] text-slate-400">{row.hint}</span>
              </span>
            </div>
          ))}
          <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
            <b>Quién aprueba:</b>{" "}
            {data.who_approves.replace("Quién aprueba: ", "")}
          </div>
          {data.batches.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs font-semibold text-slate-500">
                Sugerencias para deshacer
              </div>
              {data.batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span className="truncate">{batch.filename}</span>
                  <GhostBtn onClick={() => onUndoBatch(batch.id)}>
                    Deshacer lote
                  </GhostBtn>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
