"use client";

// Menú › Resumen (R1-09b, B3–B13): the "Configura tu menú · n de 4"
// checklist (gone once complete), 4 big KPIs and the dish table with its
// Estado, all from the shared dish-economics loader. Undo and "Empezar
// de nuevo" live in the "⋯" menu; help lives in tooltips.

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import type {
  MenuSummary,
  SetupStep,
} from "@/lib/restaurant/costing/menu-summary";
import { dishHref, platosHref } from "@/lib/restaurant/menu-links";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { MenuReaderPanel } from "./MenuReaderPanel";
import { PriceCatalogPanel } from "./PriceCatalogPanel";
import { ResetPanel } from "./ResetPanel";
import { Chip } from "./ui";

export function ResumenScreen({
  data,
  onUndoBatch,
  onUploaded,
  generateBusy,
  locationId,
  onResetDone,
  epoch,
}: {
  data: RecipeCostingWorkspace;
  /** Undo every batch of one file (newest first). */
  onUndoBatch: (batchIds: string[]) => void;
  /** After "Subir Excel de costos": prepare the dishes from that file. */
  onUploaded: () => void;
  generateBusy: boolean;
  locationId: string | null;
  /** After an import or "Empezar de nuevo": reload every panel. */
  onResetDone: () => void;
  /** Changes on "Empezar de nuevo" so the upload panels start empty. */
  epoch: number;
}) {
  const summary = data.menu_summary;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const money = (n: number) => formatMoneyEs(n, data.currency);

  if (!summary) return null;
  const { setup } = summary;
  const showUpload = uploadOpen || setup.next?.id === "excel";
  const more = (
    <MoreMenu
      data={data}
      onUndoBatch={onUndoBatch}
      onReset={() => setResetOpen(true)}
    />
  );

  return (
    <div className="space-y-[14px]">
      {!setup.complete ? (
        <section className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px]">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold">
              Configura tu menú · {setup.done} de {setup.total}
            </h2>
            {more}
            {setup.next ? (
              <NextStepButton
                step={setup.next}
                onUpload={() => setUploadOpen(true)}
              />
            ) : null}
          </div>
          {setup.steps.map((step, index) => (
            <SetupRow
              key={step.id}
              step={step}
              index={index}
              onUpload={() => setUploadOpen((v) => !v)}
            />
          ))}
          {showUpload ? (
            <div className="mt-2">
              <PriceCatalogPanel
                key={`upload-${epoch}`}
                embedded
                onUploaded={onUploaded}
                onRecipesImported={onResetDone}
                locationId={locationId}
                busyExternal={generateBusy}
              />
            </div>
          ) : null}
          <details className="mt-1 border-t border-[#f2f3f6] pt-2 text-[13px]">
            <summary className="cursor-pointer text-[#4b5466]">
              Leer tu menú web (opcional)
            </summary>
            <div className="mt-2">
              <MenuReaderPanel
                key={`menu-${epoch}`}
                embedded
                canEdit={data.actor.can_submit}
                busyExternal={generateBusy}
                locationId={locationId}
                onDone={onResetDone}
              />
            </div>
          </details>
        </section>
      ) : (
        <div className="flex justify-end">{more}</div>
      )}

      {resetOpen && data.reset ? (
        <ResetPanel
          key={`reset-${epoch}`}
          reset={data.reset}
          locationId={locationId}
          initiallyOpen
          onCancel={() => setResetOpen(false)}
          onDone={() => {
            setResetOpen(false);
            onResetDone();
          }}
        />
      ) : null}

      <Kpis summary={summary} money={money} />

      <section className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#eef0f4] text-left text-[12px] font-semibold text-[#8a92a3]">
              <th className="px-2 py-1.5">Plato</th>
              <th className="px-2 py-1.5 text-right">% ventas</th>
              <th className="px-2 py-1.5 text-right">Costo</th>
              <th className="px-2 py-1.5 text-right">Costo %</th>
              <th className="px-2 py-1.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.slice(0, 50).map((row) => (
              <tr
                key={row.odoo_product_id}
                className="border-b border-[#f2f3f6]"
              >
                <td className="px-2 py-2 font-semibold">
                  <Link
                    href={dishHref(row.odoo_product_id)}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {(row.share_of_food_sales * 100).toFixed(1)}%
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.unit_cost !== null ? (
                    <span>
                      {money(row.unit_cost)}
                      {row.excel_total !== null ? (
                        <span
                          className={
                            "ml-1.5 text-[12px] " +
                            (row.excel_diff_flag
                              ? "font-semibold text-[#c03535]"
                              : "text-[#8a92a3]")
                          }
                        >
                          Excel: {money(row.excel_total)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[#a35a00]">Sin precio</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.food_cost_pct !== null
                    ? `${Math.round(row.food_cost_pct)}%`
                    : "—"}
                </td>
                <td className="px-2 py-2">
                  <Chip tone={row.tone}>{row.label}</Chip>
                </td>
              </tr>
            ))}
            {summary.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-[#5b6476]">
                  Todavía no hay ventas de Odoo en este periodo.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {summary.rows.length > 50 ? (
          <Link
            href={platosHref()}
            className="mt-2 inline-block text-[13px] font-semibold text-[#3557c9]"
          >
            Ver los {summary.rows.length} platos
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function Kpis({
  summary,
  money,
}: {
  summary: MenuSummary;
  money: (n: number) => string;
}) {
  const { kpis } = summary;
  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    href: string;
    tip: string;
    alert?: boolean;
  }> = [
    {
      label: "Costo de comida",
      value:
        kpis.food_cost_pct !== null
          ? `${Math.round(kpis.food_cost_pct)}%`
          : "Sin precio",
      sub: "sobre ventas con costo",
      href: platosHref(["aprobado"]),
      tip: "Costo de los platos aprobados entre sus ventas netas (sin propinas).",
    },
    {
      label: "Margen por plato",
      value: kpis.avg_unit_margin !== null ? money(kpis.avg_unit_margin) : "—",
      sub: "promedio",
      href: platosHref(["aprobado"]),
      tip: "Precio neto menos costo, promedio ponderado por unidades vendidas.",
    },
    {
      label: "Ventas con costo",
      value: `${Math.round(kpis.coverage_pct)}%`,
      sub: `${kpis.covered_dishes} de ${kpis.dish_count} platos`,
      href: platosHref(),
      tip: "Parte de las ventas de comida que viene de platos con costo aprobado.",
    },
    {
      label: "Platos con margen bajo",
      value: String(kpis.low_margin_count),
      sub: "< 60%",
      href: platosHref(["aprobado"]),
      tip: "Platos aprobados cuyo margen bruto es menor al 60 % del precio.",
      alert: kpis.low_margin_count > 0,
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          title={card.tip}
          className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-[14px] hover:border-[#f28c28]"
        >
          <div className="text-[12px] text-[#6b7385]">{card.label}</div>
          <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
            {card.value}
          </div>
          <div
            className={
              "mt-0.5 text-[12px] " +
              (card.alert ? "text-[#d14343]" : "text-[#8a92a3]")
            }
          >
            {card.sub}
          </div>
        </Link>
      ))}
    </div>
  );
}

function NextStepButton({
  step,
  onUpload,
}: {
  step: SetupStep;
  onUpload: () => void;
}) {
  const cls =
    "ml-auto inline-flex items-center rounded-lg bg-[#f28c28] px-3 py-[7px] text-[13px] font-semibold text-white hover:bg-[#e07b1a]";
  if (step.href) {
    return (
      <Link href={step.href} className={cls}>
        {step.action}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onUpload}>
      {step.action}
    </button>
  );
}

function SetupRow({
  step,
  index,
  onUpload,
}: {
  step: SetupStep;
  index: number;
  onUpload: () => void;
}) {
  const body = (
    <>
      <span
        className={
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold " +
          (step.done
            ? "bg-[#e7f6ee] text-[#1f9d55]"
            : "bg-[#eef0f4] text-[#6b7385]")
        }
      >
        {step.done ? "✓" : index + 1}
      </span>
      <span>{step.label}</span>
    </>
  );
  const cls =
    "flex w-full items-center gap-2.5 border-t border-[#f2f3f6] py-2 text-left text-[13px] hover:text-[#151c2c]";
  if (step.href) {
    return (
      <Link href={step.href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onUpload}>
      {body}
      <span className="ml-auto text-[12px] font-semibold text-[#3557c9]">
        {step.done ? "Subir otro archivo" : "Elegir archivo"}
      </span>
    </button>
  );
}

/** "⋯": undo an upload (one row per file) and "Empezar de nuevo". */
function MoreMenu({
  data,
  onUndoBatch,
  onReset,
}: {
  data: RecipeCostingWorkspace;
  onUndoBatch: (batchIds: string[]) => void;
  onReset: () => void;
}) {
  if (data.batches.length === 0 && !data.reset) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Más acciones"
          className="ml-1 rounded-md p-1 text-[#6b7385] hover:bg-[#f1f3f7]"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {data.batches.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-[12px] text-[#6b7385]">
              Deshacer una carga
            </DropdownMenuLabel>
            {data.batches.map((batch) => (
              <DropdownMenuItem
                key={batch.id}
                onClick={() => onUndoBatch(batch.batch_ids)}
              >
                <span className="flex-1 truncate">{batch.filename}</span>
                {batch.uploads > 1 ? (
                  <span className="text-[12px] text-[#8a92a3]">
                    {batch.uploads} cargas
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {data.reset ? (
          <>
            {data.batches.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem className="text-[#c03535]" onClick={onReset}>
              Empezar de nuevo…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
