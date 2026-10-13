"use client";

import type {
  RecipeCostingView,
  RecipeCostingWorkspace,
} from "@/lib/restaurant/recipe-costing/workspace";
import { PriceCatalogPanel } from "./PriceCatalogPanel";
import { Stepper } from "./Stepper";
import { Card, Chip, GhostBtn, PrimaryBtn, toneForKind } from "./ui";

export function ResumenScreen({
  data,
  onOpen,
  onUndoBatch,
  onGenerateSuggestions,
  onUploadWorkbook,
  generateBusy,
}: {
  data: RecipeCostingWorkspace;
  onOpen: (view: RecipeCostingView, odooProductId?: number) => void;
  onUndoBatch: (batchId: string) => void;
  onGenerateSuggestions: () => void;
  onUploadWorkbook: (file: File) => void;
  generateBusy: boolean;
}) {
  const { coverage, stepper, next_dish, classification } = data;
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <Stepper steps={stepper} onOpen={onOpen} />
      </Card>

      <PriceCatalogPanel />

      <Card className="grid items-center gap-4 md:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="text-[11.5px] font-semibold text-[#6b7385]">
            Ventas netas con costo aprobado
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="text-[28px] font-extrabold leading-none text-[#1b2333]">
              {coverage.coverage_label}
            </span>
            <span className="text-xs text-[#5b6476]">
              {coverage.covered_label} de {coverage.net_sales_label}
              {` · ${coverage.dishes_approved} de ${coverage.dishes_need_recipe} platos`}
              {data.period_label ? ` · ${data.period_label}` : ""}
            </span>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[#eef0f4]">
            {coverage.slices
              .filter((slice) => slice.pct > 0)
              .map((slice) => (
                <div
                  key={slice.id}
                  style={{ width: `${slice.pct}%`, background: slice.color }}
                />
              ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[#6b7385]">
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
          <div className="mb-2 text-xs text-[#5b6476]">
            {coverage.margins_note}
          </div>
          <PrimaryBtn
            className="px-4 py-2 text-[13px]"
            disabled={!next_dish}
            onClick={() =>
              next_dish && onOpen(next_dish.view, next_dish.odoo_product_id)
            }
          >
            {next_dish?.label ?? "Nada pendiente"}
          </PrimaryBtn>
          <div className="mt-1.5 text-[10.5px] text-[#8a92a3]">
            {data.last_progress}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <GhostBtn onClick={() => onOpen("preparaciones")}>
              Preparaciones
            </GhostBtn>
            <GhostBtn disabled={generateBusy} onClick={onGenerateSuggestions}>
              {generateBusy
                ? "Generando sugerencias…"
                : "Generar sugerencias desde tu archivo"}
            </GhostBtn>
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadWorkbook(file);
                  event.target.value = "";
                }}
              />
              <span className="inline-flex">
                <GhostBtn disabled={generateBusy}>Cargar recetas</GhostBtn>
              </span>
            </label>
          </div>
          <div className="mt-1 text-left text-[10.5px] text-[#8a92a3]">
            {data.latest_upload?.has_candidate_blocks
              ? `Usa ${data.latest_upload.filename}. Milton propone; tú confirmas.`
              : data.latest_upload
                ? `Ya subiste ${data.latest_upload.filename}, pero hay que volver a subirlo una vez en Costos para guardar los bloques de receta.`
                : "Primero sube el Excel en Costos › Subir costos."}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.85fr_1fr]">
        <Card>
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">
              Qué falta, por impacto en ventas
            </h2>
            <span className="ml-2.5 text-[11.5px] text-[#8a92a3]">
              Primero lo que más vende
            </span>
          </div>
          <table className="w-full text-[11.8px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
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
                  className="border-t border-[#f2f3f6]"
                >
                  <td className="py-1.5 pr-2 text-[#8a92a3]">{row.rank}</td>
                  <td className="py-1.5 pr-2 font-semibold">{row.odoo_name}</td>
                  <td className="py-1.5 pr-2 text-[10.8px] text-[#5b6476]">
                    {row.reason}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Chip tone={toneForKind(row.kind_label)}>
                      {row.kind_label}
                    </Chip>
                  </td>
                  <td className="py-1.5 pr-2 text-right">{row.share_label}</td>
                  <td className="py-1.5 text-right">
                    <GhostBtn
                      onClick={() => onOpen(row.view, row.odoo_product_id)}
                    >
                      {row.action_label}
                    </GhostBtn>
                  </td>
                </tr>
              ))}
              {data.todos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[#8a92a3]">
                    No hay pendientes. Ya puedes leer los márgenes aprobados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {data.todos_total > data.todos.length ? (
            <div className="mt-2 flex justify-between text-[10.5px] text-[#8a92a3]">
              <span>
                {data.todos.length} de {data.todos_total} pendientes
              </span>
              <button
                type="button"
                className="font-semibold text-[#3557c9]"
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
              className="ml-auto text-xs font-semibold text-[#3557c9]"
              onClick={() => onOpen("vincular")}
            >
              Revisar clasificación →
            </button>
          </div>
          {data.combo_sync_hint ? (
            <div className="mb-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-3 py-2.5 text-xs text-[#5b4515]">
              {data.combo_sync_hint}
            </div>
          ) : null}
          {classification.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between border-t border-[#f2f3f6] py-1.5 text-[11.8px]"
            >
              <span>{row.label}</span>
              <span>
                <b>{row.count}</b>{" "}
                <span className="text-[10.5px] text-[#8a92a3]">{row.hint}</span>
              </span>
            </div>
          ))}
          <div className="mt-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] px-3 py-2.5 text-xs text-[#5b4515]">
            <b>Quién aprueba:</b>{" "}
            {data.who_approves.replace("Quién aprueba: ", "")}
          </div>
          {data.batches.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs font-semibold text-[#6b7385]">
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
