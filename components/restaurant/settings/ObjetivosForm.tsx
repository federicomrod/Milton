"use client";

// R1-16a (mock 12): Configuración › Objetivos. Monthly sales, food cost %,
// gross margin %, average ticket (optional); who it applies to; Milton's
// weekday split from real sales; the Cockpit's default comparison. One
// primary button saves everything in one transaction (kpi_targets_save,
// migration 052). A blank field is "no target": it draws no line and no
// chip — it is never saved as 0.

import { NOT_AVAILABLE_YET } from "@/lib/restaurant/ui-copy";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COMPARISONS,
  COMPARISON_LABEL,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
import {
  daysInMonth,
  pickTargetRow,
  weekdayAmounts,
  weightsFromAmounts,
  type TargetRow,
} from "@/lib/restaurant/objetivos";
import type { ObjetivosReferences } from "@/lib/restaurant/objetivos-references";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { userErrorMessage } from "@/lib/restaurant/user-error";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const dateEs = (ymd: string) =>
  `${Number(ymd.slice(8))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;

/** "$34,500" / "34500" / "34.500,5" → 34500; empty or junk → null. */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,(?=\d{1,2}$)/, ".");
  const plain = cleaned.replace(/,/g, "");
  if (plain === "" || !/^\d*\.?\d+$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface ObjetivosFormProps {
  currency: string;
  restaurants: Array<{ id: string; name: string }>;
  applyTo: string | null;
  rows: TargetRow[];
  /** Migration 052 applied. */
  available: boolean;
  refs: ObjetivosReferences;
  cost30: {
    food_cost_pct: number | null;
    gross_margin_pct: number | null;
  } | null;
  today: string;
  /** When a saved goal starts to apply; the first option is the default. */
  startOptions: Array<{ value: string; label: string }>;
  defaultComparison: Comparison;
  canEdit: boolean;
}

export function ObjetivosForm(props: ObjetivosFormProps) {
  const { currency, refs, cost30, today, available, canEdit } = props;
  const router = useRouter();
  const money = (n: number, d = 0) =>
    formatMoneyEs(n, currency, { decimals: d });

  const rowOf = (metric: TargetRow["metric_key"]) =>
    pickTargetRow(props.rows, metric, today, props.applyTo);
  const revenueRow = rowOf("revenue");
  const monthlyRow =
    revenueRow?.target_period === "monthly" ? revenueRow : null;
  const level = (m: "food_cost_pct" | "gross_margin_pct" | "avg_ticket") => {
    const r = rowOf(m);
    return {
      value: r && r.location_id === props.applyTo ? r.target_value : null,
      inherited: r && r.location_id !== props.applyTo ? r.target_value : null,
    };
  };
  const food = level("food_cost_pct");
  const margin = level("gross_margin_pct");
  const ticket = level("avg_ticket");

  const [revenue, setRevenue] = useState(
    monthlyRow ? String(monthlyRow.target_value) : ""
  );
  const [foodPct, setFoodPct] = useState(
    food.value !== null ? String(food.value) : ""
  );
  const [marginPct, setMarginPct] = useState(
    margin.value !== null ? String(margin.value) : ""
  );
  const [avgTicket, setAvgTicket] = useState(
    ticket.value !== null ? String(ticket.value) : ""
  );
  const [comparison, setComparison] = useState<Comparison>(
    props.defaultComparison
  );
  const [useSplit, setUseSplit] = useState(
    monthlyRow
      ? monthlyRow.weekday_weights !== null
      : refs.suggestedWeights !== null
  );
  const [edited, setEdited] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; message: string }
    | { kind: "info"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [start, setStart] = useState(props.startOptions[0].value);
  const startLabel =
    props.startOptions.find((o) => o.value === start)?.label ?? dateEs(start);

  const monthly = parseNumber(revenue);
  const weights =
    edited ?? monthlyRow?.weekday_weights ?? refs.suggestedWeights ?? null;
  const dim = daysInMonth(today);
  const flatDaily = monthly !== null ? monthly / dim : null;
  const amounts =
    weights && monthly !== null ? weekdayAmounts(monthly, weights) : null;
  const legacyDaily =
    revenueRow && revenueRow.target_period === "daily"
      ? revenueRow.target_value
      : null;

  const disabled = !available || !canEdit || status.kind === "saving";

  const dirty = useMemo(() => {
    const same = (draft: string, saved: number | null) =>
      (parseNumber(draft) ?? null) === saved;
    return !(
      same(revenue, monthlyRow ? monthlyRow.target_value : null) &&
      same(foodPct, food.value) &&
      same(marginPct, margin.value) &&
      same(avgTicket, ticket.value) &&
      comparison === props.defaultComparison &&
      edited === null &&
      start === props.startOptions[0].value &&
      useSplit ===
        (monthlyRow
          ? monthlyRow.weekday_weights !== null
          : refs.suggestedWeights !== null)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    revenue,
    foodPct,
    marginPct,
    avgTicket,
    comparison,
    edited,
    useSplit,
    start,
  ]);

  async function save() {
    // Never a silent button: always say what happened or why nothing did.
    if (!available) {
      setStatus({
        kind: "error",
        message: NOT_AVAILABLE_YET,
      });
      return;
    }
    if (!canEdit) {
      setStatus({
        kind: "error",
        message: "Tu rol no puede cambiar los objetivos.",
      });
      return;
    }
    if (!dirty) {
      setStatus({ kind: "info", message: "No hay cambios que guardar." });
      return;
    }
    setStatus({ kind: "saving" });
    const body: Record<string, unknown> = {
      version: 2,
      location_id: props.applyTo,
      default_comparison: comparison,
      effective_from: start,
    };
    // A number sets it; a field the person emptied clears it; an untouched empty one is left alone.
    const put = (key: string, draft: string, saved: number | null) => {
      const n = parseNumber(draft);
      if (n !== null) body[key] = n;
      else if (saved !== null) body[key] = null;
    };
    put(
      "revenue_monthly",
      revenue,
      monthlyRow ? monthlyRow.target_value : null
    );
    put("food_cost_pct", foodPct, food.value);
    put("gross_margin_pct", marginPct, margin.value);
    put("avg_ticket", avgTicket, ticket.value);
    if (parseNumber(revenue) !== null) {
      body.weekday_weights = useSplit && weights ? weights : null;
    }
    try {
      const res = await fetch("/api/restaurant/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new Error(
          userErrorMessage(json, "No pude guardar los objetivos.")
        );
      setStatus({
        kind: "ok",
        message: `Objetivos guardados. Vigentes desde ${startLabel.split(" · ")[0]} — ya se ven en el Cockpit.`,
      });
      setEdited(null);
      router.refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "No pude guardar los objetivos.",
      });
    }
  }

  const input =
    "h-9 w-[112px] rounded-lg border border-[#c6d3f5] bg-white px-2.5 text-right text-[14px] text-[#151c2c] outline-none focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20 disabled:bg-[#f4f6fb] disabled:text-[#8a92a3]";
  const dash = "—";

  return (
    <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[1.7fr_1fr]">
      <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
        <div className="mb-2 flex items-center">
          <h2 className="text-[14px] font-bold">Tus objetivos</h2>
          <span className="ml-auto text-[12px] text-[#8a92a3]">
            Déjalo vacío para no tener objetivo
          </span>
        </div>
        {!available ? (
          <p
            role="status"
            className="mb-3 rounded-lg border border-[#f5c98b] bg-[#fff8ec] px-3 py-2 text-[13px]"
          >
            {NOT_AVAILABLE_YET} Mientras tanto el Cockpit funciona sin
            objetivos.
          </p>
        ) : null}
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#dbe3f7] text-left text-[12px] font-semibold text-[#4a5a85]">
              <th className="py-1.5">Objetivo</th>
              <th className="py-1.5 text-right">Meta</th>
              <th className="px-3 py-1.5">Cómo se usa</th>
              <th className="py-1.5">Referencia</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#eef0f4]">
              <td className="py-3 font-bold">Ventas mensuales</td>
              <td className="py-3 text-right">
                <input
                  aria-label="Ventas mensuales"
                  inputMode="decimal"
                  className={input}
                  disabled={disabled}
                  value={revenue}
                  placeholder="$"
                  onChange={(e) => setRevenue(e.target.value)}
                />
              </td>
              <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                {monthly !== null && flatDaily !== null
                  ? `= ${money(flatDaily)} por día (${dim} días)${weights && useSplit ? " · según el reparto por día de la semana" : ""}`
                  : legacyDaily !== null
                    ? `Objetivo diario anterior: ${money(legacyDaily)} por día`
                    : "—"}
              </td>
              <td className="py-3 text-[12px] text-[#6b7385]">
                {refs.avgMonthly6 !== null ? (
                  <>
                    Promedio 6 meses: {money(refs.avgMonthly6)}
                    {refs.span6Note ? ` (${refs.span6Note})` : ""}
                  </>
                ) : (
                  dash
                )}
              </td>
            </tr>
            <tr className="border-b border-[#eef0f4]">
              <td className="py-3 font-bold">Costo de comida</td>
              <td className="py-3 text-right">
                <input
                  aria-label="Costo de comida %"
                  inputMode="decimal"
                  className={input}
                  disabled={disabled}
                  value={foodPct}
                  placeholder={
                    food.inherited !== null
                      ? `${food.inherited} % (todos)`
                      : "%"
                  }
                  onChange={(e) => setFoodPct(e.target.value)}
                />
              </td>
              <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                {parseNumber(foodPct) !== null
                  ? `Rojo cuando pasa de ${parseNumber(foodPct)}%`
                  : "Sin objetivo"}
              </td>
              <td className="py-3 text-[12px] text-[#6b7385]">
                {cost30?.food_cost_pct != null
                  ? `Actual 30 d: ${Math.round(cost30.food_cost_pct)}%`
                  : dash}
              </td>
            </tr>
            <tr className="border-b border-[#eef0f4]">
              <td className="py-3 font-bold">Margen bruto</td>
              <td className="py-3 text-right">
                <input
                  aria-label="Margen bruto %"
                  inputMode="decimal"
                  className={input}
                  disabled={disabled}
                  value={marginPct}
                  placeholder={
                    margin.inherited !== null
                      ? `${margin.inherited} % (todos)`
                      : "%"
                  }
                  onChange={(e) => setMarginPct(e.target.value)}
                />
              </td>
              <td className="px-3 py-3 text-[12px] text-[#6b7385]">
                {parseNumber(marginPct) !== null
                  ? `Verde cuando llega a ${parseNumber(marginPct)}%`
                  : "Sin objetivo"}
              </td>
              <td className="py-3 text-[12px] text-[#6b7385]">
                {cost30?.gross_margin_pct != null
                  ? `Actual 30 d: ${Math.round(cost30.gross_margin_pct)}%`
                  : dash}
              </td>
            </tr>
            <tr>
              <td className="py-3 font-bold">Ticket promedio</td>
              <td className="py-3 text-right">
                <input
                  aria-label="Ticket promedio"
                  inputMode="decimal"
                  className={input}
                  disabled={disabled}
                  value={avgTicket}
                  placeholder={
                    ticket.inherited !== null
                      ? `${money(ticket.inherited, 2)} (todos)`
                      : "$"
                  }
                  onChange={(e) => setAvgTicket(e.target.value)}
                />
              </td>
              <td className="px-3 py-3 text-[12px] text-[#6b7385]">Opcional</td>
              <td className="py-3 text-[12px] text-[#6b7385]">
                {refs.ticket30 !== null
                  ? `Actual 30 d: ${money(refs.ticket30, 2)}`
                  : dash}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-[#4a5a85]">
            Vigente desde
            <select
              aria-label="Vigente desde"
              value={start}
              disabled={disabled}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-[#c6d3f5] bg-white px-2 py-1 text-[12px] outline-none focus:border-[#1b40c8]"
            >
              {props.startOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[12px] text-[#8a92a3]">
            Vigente desde {startLabel.split(" · ")[0]} · los meses anteriores
            guardan su objetivo
          </span>
          {status.kind === "ok" || status.kind === "info" ? (
            <span
              role="status"
              className={`text-[12px] font-semibold ${status.kind === "ok" ? "text-[#15803d]" : "text-[#4a5a85]"}`}
            >
              {status.message}
            </span>
          ) : null}
          {status.kind === "error" ? (
            <span role="alert" className="text-[12px] text-[#c03535]">
              {status.message}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={status.kind === "saving"}
            className="ml-auto rounded-lg bg-[#1b40c8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6] disabled:opacity-50"
          >
            {status.kind === "saving" ? "Guardando…" : "Guardar objetivos"}
          </button>
        </div>
      </section>

      <div className="space-y-[14px]">
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <h2 className="text-[14px] font-bold">
            Reparto diario sugerido por Milton
          </h2>
          {weights ? (
            <>
              <p className="mb-2 text-[12px] text-[#8a92a3]">
                Según cómo vendes cada día (últimos 6 meses).
                {monthly !== null
                  ? ` Suma ${money(monthly)}/mes.`
                  : " Escribe tu venta mensual para ver los montos."}
              </p>
              <div className="flex gap-1.5">
                {DAYS.map((day, i) => (
                  <div key={day} className="flex-1 text-center">
                    <div className="text-[12px] text-[#8a92a3]">{day}</div>
                    {editing === i && amounts ? (
                      <input
                        autoFocus
                        aria-label={`Monto de ${day}`}
                        defaultValue={String(Math.round(amounts[i]))}
                        className="mt-1 w-full rounded-md border border-[#1b40c8] px-1 py-1 text-center text-[13px] outline-none"
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                          if (e.key === "Enter") {
                            const n = parseNumber(e.currentTarget.value);
                            if (n !== null) {
                              const next = [...amounts];
                              next[i] = n;
                              const w = weightsFromAmounts(next);
                              if (w) {
                                setEdited(w);
                                setUseSplit(true);
                              }
                            }
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={disabled || !amounts}
                        onClick={() => amounts && setEditing(i)}
                        title={
                          amounts ? "Clic para cambiar este día" : undefined
                        }
                        className="mt-1 block w-full rounded-md border border-[#c6d3f5] bg-white px-1 py-1 text-[13px] disabled:bg-[#f4f6fb]"
                      >
                        {amounts
                          ? money(amounts[i])
                          : `${Math.round(weights[i] * 100)}%`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-[#4a5a85]">
                <input
                  type="checkbox"
                  checked={useSplit}
                  disabled={disabled}
                  onChange={(e) => setUseSplit(e.target.checked)}
                  className="accent-[#1b40c8]"
                />
                Usar este reparto (si no, el objetivo se reparte parejo todos
                los días)
              </label>
              <p className="mt-1 text-[12px] text-[#8a92a3]">
                Clic en un día para cambiarlo.
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-[#8a92a3]">
              Aún no hay ventas de todos los días de la semana para sugerir un
              reparto: el objetivo se reparte parejo
              {flatDaily !== null ? ` (${money(flatDaily)} por día)` : ""}.
            </p>
          )}
        </section>

        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
          <h2 className="text-[14px] font-bold">
            Comparación por defecto en Cockpit
          </h2>
          <select
            aria-label="Comparación por defecto"
            value={comparison}
            disabled={disabled}
            onChange={(e) => setComparison(e.target.value as Comparison)}
            className="mt-2 rounded-lg border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#1b40c8]"
          >
            {COMPARISONS.map((c) => (
              <option key={c} value={c}>
                {COMPARISON_LABEL[c]}
              </option>
            ))}
          </select>
        </section>
      </div>
    </div>
  );
}
