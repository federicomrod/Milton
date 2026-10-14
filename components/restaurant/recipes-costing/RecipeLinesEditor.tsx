"use client";

import Link from "next/link";
import { ingredientHref } from "@/lib/restaurant/menu-links";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  FLAG_NEW_SUGGESTED,
  SAVING_LINE_PREFIX,
  needsTypedQuantity,
  optimisticAddLine,
  optimisticLine,
  searchPickerOptions,
  type EditorLine,
  type PickerOption,
} from "@/lib/restaurant/recipe-costing/editor";
import {
  pickerUnit,
  unitsLike,
} from "@/lib/restaurant/recipe-costing/picker-units";
import {
  CATALOG_CHANGING_ACTIONS,
  cachedPickerOptions,
  invalidatePickerOptions,
  pickerOptionsFor,
  rememberPickerOptions,
} from "@/lib/restaurant/recipe-costing/picker-cache";
import { Chip, GhostBtn, PrimaryBtn } from "./ui";

const MASS = ["oz", "lb", "g", "kg"];
/** "Ninguna / Pendiente": none of the readings is right. */
const NO_PRICE = "none";
const NO_PRICE_LABEL = "Ninguna / Pendiente";
const VOLUME = ["ml", "l", "gal"];

const UNIT_LABEL: Record<string, string> = {
  oz: "onza",
  lb: "libra",
  g: "gramo",
  kg: "kilo",
  ml: "ml",
  l: "litro",
  gal: "galón",
  unit: "unidad",
  portion: "porción",
};

function money(value: number): string {
  const text = value >= 1 ? value.toFixed(2) : value.toPrecision(3);
  return `$${Number(text)}`;
}

function monthLabel(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es", { month: "short", year: "numeric" });
}

/** Where a price came from, in the owner's words. */
function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  if (source === "lista") return "lista de precios";
  if (source === "recetas" || source === "importada") return "Excel";
  return source;
}

function priceLabel(option: {
  unit: string | null;
  unit_cost: number | null;
  price_date: string | null;
  price_source: string | null;
}): string {
  if (option.unit_cost === null) return "sin precio";
  const parts = [
    `${money(option.unit_cost)}/${UNIT_LABEL[option.unit ?? ""] ?? option.unit ?? ""}`,
  ];
  const month = monthLabel(option.price_date);
  if (month) parts.push(month);
  if (option.price_source) parts.push(sourceLabel(option.price_source)!);
  return parts.join(" · ");
}

async function call(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; state: EditorState } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json()) as EditorState & { error?: string };
    if (!res.ok) {
      return { ok: false, error: json.error ?? "No pude guardar el cambio." };
    }
    return { ok: true, state: json };
  } catch {
    return { ok: false, error: "No pude conectar. Intenta otra vez." };
  }
}

/** Quantity a person typed on a menu line, sent with how it is resolved. */
interface TypedAmount {
  quantity: number;
  line_unit: string;
}

type PickTarget =
  | { mode: "add" }
  | { mode: "resolve"; line: EditorLine; amount?: TypedAmount }
  | { mode: "change"; line: EditorLine };

export function RecipeLinesEditor({
  odooProductId,
  componentId,
  locationId,
  portionCostLabel,
  reloadKey,
  onEdited,
  onState,
  onOpenPreparation,
}: {
  /** A dish, by POS product… */
  odooProductId?: number;
  /** …or a preparation. */
  componentId?: string;
  locationId?: string | null;
  portionCostLabel: string | null;
  /** Bump to reload (for example after the parent approved something). */
  reloadKey?: number;
  /** Called after every saved change so the checklist and margin refresh. */
  onEdited: () => void;
  onState?: (state: EditorState) => void;
  onOpenPreparation?: (componentId: string) => void;
}) {
  const [state, setState] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<PickTarget | null>(null);
  /** The item just added, to show "✓ guardado" for a moment. */
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const target = useMemo(
    () =>
      componentId
        ? { component_id: componentId }
        : {
            odoo_product_id: odooProductId,
            location_id: locationId ?? undefined,
          },
    [componentId, odooProductId, locationId]
  );
  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(target)) {
      if (value !== undefined && value !== null) p.set(key, String(value));
    }
    return p.toString();
  }, [target]);

  useEffect(() => {
    if (state && onState) onState(state);
  }, [state, onState]);

  /** Use the session's picker list when the server left it out. */
  const withOptions = useCallback(
    (next: EditorState): EditorState => {
      if (next.options_omitted) {
        const cached = cachedPickerOptions();
        return cached
          ? { ...next, options: pickerOptionsFor(cached, componentId) }
          : next;
      }
      // A preparation's list leaves itself out: only a dish's is shared.
      if (!componentId) rememberPickerOptions(next.options);
      return next;
    },
    [componentId]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const omit = cachedPickerOptions() ? "&omit_options=1" : "";
      const res = await call(`/api/restaurant/recipes/editor?${query}${omit}`);
      if (cancelled) return;
      if (res.ok) {
        setState(withOptions(res.state));
        setError(null);
      } else {
        setError(res.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey, withOptions]);

  async function send(
    body: Record<string, unknown>,
    /** Show the change right away (quantity, line price); no lock. */
    optimistic?:
      | { inputId: string; qty?: number; unit_cost?: number | null }
      | { add: PickerOption; qty: number; unit: string }
  ): Promise<boolean> {
    const before = state;
    if (optimistic && state) {
      setState(
        "add" in optimistic
          ? optimisticAddLine(
              state,
              optimistic.add,
              optimistic.qty,
              optimistic.unit
            )
          : optimisticLine(state, optimistic.inputId, optimistic)
      );
    } else {
      setBusy(true);
    }
    setError(null);
    const changesCatalog = CATALOG_CHANGING_ACTIONS.has(String(body.action));
    if (changesCatalog) invalidatePickerOptions();
    const res = await call("/api/restaurant/recipes/editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...target,
        ...body,
        // Only the changed line comes back, not the whole picker list.
        omit_options: !changesCatalog && cachedPickerOptions() !== null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      if (optimistic && before) setState(before);
      setError(res.error);
      return false;
    }
    setState(withOptions(res.state));
    setPicking(null);
    if (optimistic && "add" in optimistic) {
      const id = optimistic.add.id;
      setJustAdded(id);
      setTimeout(() => setJustAdded((now) => (now === id ? null : now)), 2000);
    }
    onEdited();
    return true;
  }

  if (!state) {
    return (
      <p className="py-3 text-xs text-[#5b6476]">
        {error ?? "Cargando los ingredientes…"}
      </p>
    );
  }

  const editable = state.editable && !busy;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Ingredientes por porción</h2>
        <span className="text-[12px] text-[#8a92a3]">
          {state.editable
            ? "Elige de tu lista de ingredientes y preparaciones"
            : (state.locked_reason ?? "")}
        </span>
        {state.editable ? (
          <GhostBtn
            className="ml-auto"
            disabled={busy}
            onClick={() => setPicking({ mode: "add" })}
          >
            + Agregar ingrediente
          </GhostBtn>
        ) : null}
      </div>

      {error ? (
        <div className="mb-2 rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]">
          {error}
        </div>
      ) : null}

      {picking ? (
        <Picker
          key={
            picking.mode === "add"
              ? "add"
              : `${picking.mode}-${picking.line.key}`
          }
          target={picking}
          options={state.options}
          busy={busy}
          onCancel={() => setPicking(null)}
          onPick={(option, quantity, unit) => {
            if (picking.mode === "add") {
              // The line shows at once ("guardando…"); the picker closes.
              setPicking(null);
              void send(
                {
                  action: "add",
                  kind: option.kind,
                  id: option.id,
                  quantity,
                  unit,
                },
                { add: option, qty: quantity, unit }
              );
            } else if (picking.mode === "resolve") {
              void send({
                action: "resolve",
                line_key: picking.line.key,
                kind: option.kind,
                id: option.id,
                ...(picking.amount ?? {}),
              });
            } else {
              void send({
                action: "change_item",
                input_id: picking.line.input_id,
                kind: option.kind,
                id: option.id,
              });
            }
          }}
          onCreate={(draft) =>
            void send({
              action: "create_ingredient",
              name: draft.name,
              unit: draft.unit,
              unit_cost: draft.unit_cost,
              ...(picking.mode === "resolve"
                ? { line_key: picking.line.key, ...(picking.amount ?? {}) }
                : picking.mode === "add"
                  ? { quantity: draft.quantity, line_unit: draft.line_unit }
                  : {}),
            })
          }
          onCreatePreparation={(draft) =>
            void send({
              action: "create_preparation",
              name: draft.name,
              yield_quantity: draft.yield_quantity,
              yield_unit: draft.yield_unit,
              ...(picking.mode === "resolve"
                ? { line_key: picking.line.key, ...(picking.amount ?? {}) }
                : picking.mode === "add"
                  ? { quantity: draft.quantity, line_unit: draft.line_unit }
                  : {}),
            })
          }
        />
      ) : null}

      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-[#8a92a3]">
            <th className="pb-1.5">Ingrediente</th>
            <th className="pb-1.5 text-right">Cantidad</th>
            <th className="pb-1.5">Unidad</th>
            <th className="pb-1.5 text-right">Precio</th>
            <th className="pb-1.5 text-right">Aporte</th>
            <th className="pb-1.5" />
          </tr>
        </thead>
        <tbody>
          {state.lines.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-4 text-sm text-[#5b6476]">
                Esta receta no tiene ingredientes. Agrégalos de tu lista, o crea
                un ingrediente o una preparación nueva.
              </td>
            </tr>
          ) : null}
          {state.lines.map((line) => (
            <Row
              key={line.key}
              line={line}
              editable={editable && !line.key.startsWith(SAVING_LINE_PREFIX)}
              saveNote={
                line.key.startsWith(SAVING_LINE_PREFIX)
                  ? "guardando…"
                  : justAdded &&
                      (line.ingredient_id === justAdded ||
                        line.component_id === justAdded)
                    ? "✓ guardado"
                    : null
              }
              onResolve={(option, amount) =>
                void send({
                  action: "resolve",
                  line_key: line.key,
                  kind: option.kind,
                  id: option.id,
                  ...(amount ?? {}),
                })
              }
              onPick={(amount) => setPicking({ mode: "resolve", line, amount })}
              onChange={() => setPicking({ mode: "change", line })}
              onRemove={() =>
                void send({ action: "remove", line_key: line.key })
              }
              onQty={(qty) =>
                void send(
                  {
                    action: "update",
                    input_id: line.input_id,
                    quantity: qty,
                  },
                  line.input_id ? { inputId: line.input_id, qty } : undefined
                )
              }
              onUnit={(unit) =>
                void send({ action: "update", input_id: line.input_id, unit })
              }
              onAnswerUnit={(unit) =>
                void send({
                  action: "answer_unit",
                  input_id: line.input_id,
                  unit,
                })
              }
              onOpenPreparation={
                onOpenPreparation && line.component_id
                  ? () => onOpenPreparation(line.component_id!)
                  : undefined
              }
              onCatalogUnit={(itemId, unit, lineKey) =>
                void send({
                  action: "answer_catalog_unit",
                  item_id: itemId,
                  unit,
                  ...(lineKey ? { line_key: lineKey } : {}),
                })
              }
              onPrice={(unit, cost) =>
                void send({
                  action: "set_price",
                  ingredient_id: line.ingredient_id,
                  unit,
                  unit_cost: cost,
                })
              }
              onLineCost={(cost) =>
                void send(
                  {
                    action: "set_line_cost",
                    input_id: line.input_id,
                    unit_cost: cost,
                  },
                  line.input_id
                    ? { inputId: line.input_id, unit_cost: cost }
                    : undefined
                )
              }
            />
          ))}
          {portionCostLabel ? (
            <tr className="border-t border-[#f2f3f6]">
              <td colSpan={4} className="py-2 text-right font-semibold">
                Costo por porción vendible
              </td>
              <td className="py-2 text-right text-sm font-bold">
                {portionCostLabel}
              </td>
              <td />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  line,
  editable,
  saveNote,
  onResolve,
  onPick,
  onChange,
  onRemove,
  onQty,
  onUnit,
  onAnswerUnit,
  onOpenPreparation,
  onPrice,
  onCatalogUnit,
  onLineCost,
}: {
  line: EditorLine;
  editable: boolean;
  /** "guardando…" while a just-added line saves, then "✓ guardado". */
  saveNote?: string | null;
  onResolve: (
    option: { kind: "ingredient" | "component"; id: string },
    amount?: TypedAmount
  ) => void;
  onPick: (amount?: TypedAmount) => void;
  onChange: () => void;
  onRemove: () => void;
  onQty: (qty: number) => void;
  onUnit: (unit: string) => void;
  onAnswerUnit: (unit: string) => void;
  onOpenPreparation?: () => void;
  onPrice: (unit: string, cost: number) => void;
  onCatalogUnit: (itemId: string, unit: string, lineKey?: string) => void;
  /** This line's own price per its unit; null = back to the list's. */
  onLineCost: (cost: number | null) => void;
}) {
  const [qty, setQty] = useState(String(line.qty || ""));
  const [price, setPrice] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  /** One click on a price opens the field to type a new one. */
  const editPrice = (content: React.ReactNode) =>
    editable ? (
      <button
        type="button"
        title="Doble clic para cambiar el precio"
        onDoubleClick={() => setEditingPrice(true)}
        className="rounded px-0.5 text-right hover:bg-[#eef3ff] hover:underline"
      >
        {content}
      </button>
    ) : (
      content
    );
  const [linePrice, setLinePrice] = useState(
    line.unit_cost !== null ? String(Number(line.unit_cost.toFixed(5))) : ""
  );
  const unresolved = line.kind === "unresolved";
  /** A preparation not approved yet and no price of its own: it waits. */
  const waitingPrep = line.kind === "component" && line.amount === null;
  // A line from the menu says what, not how much: the person types both
  // before it is matched or created. Never an assumed quantity.
  const fromMenu = unresolved && needsTypedQuantity(line);
  const [menuUnit, setMenuUnit] = useState("");
  const typedQty = Number(qty);
  const typed: TypedAmount | undefined =
    fromMenu && Number.isFinite(typedQty) && typedQty > 0 && menuUnit
      ? { quantity: typedQty, line_unit: menuUnit }
      : undefined;
  const waitingForAmount = fromMenu && !typed;
  const units = unitsLike(line.price?.unit ?? line.unit);
  const shownUnits = units.includes(line.unit) ? units : [line.unit, ...units];

  return (
    <tr
      className={
        "border-t border-[#f2f3f6] " +
        (unresolved || waitingPrep ? "bg-[#fff8ec]" : "")
      }
    >
      <td className="py-1.5 pr-2 align-top">
        {unresolved ? (
          <>
            <b>{line.raw_name}</b>
            {line.catalog_question ? (
              <div className="mt-1 rounded-md border border-[#f5c98b] bg-[#fff8ec] px-2 py-1 text-[12px]">
                Está en tu lista de precios, pero no dice en qué unidad viene el
                precio. ¿Cuál es?
                {editable ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {line.catalog_question.options.map((option) => (
                      <GhostBtn
                        key={option.unit}
                        onClick={() =>
                          onCatalogUnit(
                            line.catalog_question!.item_id,
                            option.unit,
                            line.key
                          )
                        }
                      >
                        {money(option.unit_cost)} por{" "}
                        {UNIT_LABEL[option.unit] ?? option.unit}
                      </GhostBtn>
                    ))}
                    <GhostBtn
                      onClick={() =>
                        onCatalogUnit(
                          line.catalog_question!.item_id,
                          NO_PRICE,
                          line.key
                        )
                      }
                    >
                      {NO_PRICE_LABEL}
                    </GhostBtn>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* C5: one combobox per line (search, create or choose) and a
                chip, instead of a sentence and three buttons. */}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {fromMenu ? <Chip tone="sug">Del menú</Chip> : null}
              {line.possible_match ||
              line.flags.includes(FLAG_NEW_SUGGESTED) ? (
                <Chip tone="pur">Sugerido</Chip>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  disabled={waitingForAmount}
                  title={
                    waitingForAmount
                      ? "Escribe primero cuánto lleva."
                      : undefined
                  }
                  onClick={() => onPick(typed)}
                  className="inline-flex min-w-44 items-center justify-between gap-2 rounded-md border border-[#f5a524] bg-white px-2 py-0.5 text-left text-[12px] disabled:opacity-45"
                >
                  <span className="truncate">
                    {line.possible_match
                      ? line.possible_match.name
                      : "Buscar, crear o elegir…"}
                  </span>
                  <span aria-hidden>▾</span>
                </button>
              ) : null}
              {editable && line.possible_match ? (
                <button
                  type="button"
                  disabled={waitingForAmount}
                  title={`Usar «${line.possible_match.name}»`}
                  aria-label={`Usar «${line.possible_match.name}»`}
                  onClick={() =>
                    onResolve(
                      {
                        kind: line.possible_match!.kind,
                        id: line.possible_match!.id,
                      },
                      typed
                    )
                  }
                  className="rounded-md border border-[#1f9d55] px-1.5 text-[12px] font-semibold text-[#1f7a45] disabled:opacity-45"
                >
                  ✓
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <b>{line.name}</b>
            {saveNote ? (
              <span className="ml-1.5 text-[12px] font-normal text-[#1f9d55]">
                {saveNote}
              </span>
            ) : null}
            <div className="text-[12px] text-[#8a92a3]">
              {line.kind === "component" ? (
                <>
                  Preparación
                  {onOpenPreparation && !waitingPrep ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="font-semibold text-[#3557c9]"
                        onClick={onOpenPreparation}
                      >
                        revisar
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
              {line.raw_name &&
              line.name &&
              line.raw_name.trim().toLowerCase() !==
                line.name.trim().toLowerCase()
                ? `${line.kind === "component" ? " · " : ""}del Excel: ${line.raw_name}`
                : null}
            </div>
            {waitingPrep ? (
              <div className="mt-1 rounded-md border border-[#f5c98b] bg-[#fff8ec] px-2 py-1 text-[12px] text-[#5b4515]">
                Aprueba primero la preparación <b>{line.name}</b>, o escribe
                aquí el precio de esta línea.
                {onOpenPreparation ? (
                  <div className="mt-1">
                    <GhostBtn onClick={onOpenPreparation}>
                      Abrir en Preparaciones
                    </GhostBtn>
                  </div>
                ) : null}
              </div>
            ) : null}
            {line.unit_question ? (
              <div className="mt-1 rounded-md border border-[#f5c98b] bg-[#fff8ec] px-2 py-1 text-[12px]">
                Tu archivo dice{" "}
                {UNIT_LABEL[line.unit_question.written] ??
                  line.unit_question.written}
                , pero su precio corresponde a{" "}
                {UNIT_LABEL[line.unit_question.suggested] ??
                  line.unit_question.suggested}
                . ¿Cuál es?
                {editable ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[
                      line.unit_question.suggested,
                      line.unit_question.written,
                    ].map((unit) => (
                      <GhostBtn key={unit} onClick={() => onAnswerUnit(unit)}>
                        {line.qty} {UNIT_LABEL[unit] ?? unit}
                      </GhostBtn>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right align-top">
        {fromMenu ? (
          <input
            value={qty}
            disabled={!editable}
            placeholder="Pendiente"
            onChange={(event) => setQty(event.target.value)}
            className="inline-block w-20 rounded-md border border-[#f5a524] bg-[#fff8ec] px-1.5 py-0.5 text-right"
          />
        ) : unresolved ? (
          <span className="text-[#6b7385]">{line.qty}</span>
        ) : (
          <input
            value={qty}
            disabled={!editable}
            onChange={(event) => setQty(event.target.value)}
            onBlur={() => {
              const n = Number(qty);
              if (Number.isFinite(n) && n > 0 && n !== line.qty) onQty(n);
            }}
            className="inline-block min-w-11 rounded-md border border-[#d5dae3] bg-white px-1.5 py-0.5 text-right"
          />
        )}
      </td>
      <td className="py-1.5 pr-2 align-top">
        {fromMenu ? (
          <select
            value={menuUnit}
            disabled={!editable}
            onChange={(event) => setMenuUnit(event.target.value)}
            className="rounded-md border border-[#f5a524] bg-[#fff8ec] px-1 py-0.5"
          >
            <option value="">—</option>
            {ALL_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABEL[unit] ?? unit}
              </option>
            ))}
          </select>
        ) : unresolved ? (
          <span className="text-[#6b7385]">
            {UNIT_LABEL[line.unit] ?? line.unit}
          </span>
        ) : (
          <select
            value={line.unit}
            disabled={!editable}
            onChange={(event) => onUnit(event.target.value)}
            className="rounded-md border border-[#d5dae3] bg-white px-1 py-0.5"
          >
            {shownUnits.map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABEL[unit] ?? unit}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-1.5 text-right align-top">
        {!unresolved && editingPrice ? (
          <div className="flex items-center justify-end gap-1">
            <input
              value={linePrice}
              autoFocus
              placeholder="Precio"
              onChange={(event) => setLinePrice(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingPrice(false);
              }}
              className="w-16 rounded-md border border-[#d5dae3] px-1.5 py-0.5 text-right"
            />
            <span className="text-[12px] text-[#8a92a3]">
              /{UNIT_LABEL[line.unit] ?? line.unit}
            </span>
            <GhostBtn
              onClick={() => {
                const n = Number(linePrice);
                if (Number.isFinite(n) && n > 0) {
                  setEditingPrice(false);
                  onLineCost(n);
                }
              }}
            >
              Guardar
            </GhostBtn>
            {line.own_cost ? (
              <button
                type="button"
                className="text-[12px] font-semibold text-[#3557c9]"
                onClick={() => {
                  setEditingPrice(false);
                  onLineCost(null);
                }}
              >
                usar la lista
              </button>
            ) : null}
          </div>
        ) : unresolved ? (
          "—"
        ) : line.own_cost && line.unit_cost !== null ? (
          editPrice(
            <span>
              {money(line.unit_cost)}/{UNIT_LABEL[line.unit] ?? line.unit}
              <div className="text-[12px] text-[#8a92a3]">
                {line.cost_source === "manual"
                  ? "precio de esta línea"
                  : "del Excel"}
              </div>
            </span>
          )
        ) : line.kind === "ingredient" &&
          !line.price &&
          line.catalog_question ? (
          <div className="text-left text-[12px]">
            <div className="text-[#a35a00]">
              Tu lista no deja clara la unidad. ¿Cuál es?
            </div>
            <div className="mt-1 flex flex-wrap justify-end gap-1">
              {line.catalog_question.options.map((option) => (
                <GhostBtn
                  key={option.unit}
                  disabled={!editable}
                  onClick={() =>
                    onCatalogUnit(line.catalog_question!.item_id, option.unit)
                  }
                >
                  {money(option.unit_cost)} por{" "}
                  {UNIT_LABEL[option.unit] ?? option.unit}
                </GhostBtn>
              ))}
              <GhostBtn
                disabled={!editable}
                onClick={() =>
                  onCatalogUnit(line.catalog_question!.item_id, NO_PRICE)
                }
              >
                {NO_PRICE_LABEL}
              </GhostBtn>
            </div>
          </div>
        ) : line.kind === "ingredient" && !line.price ? (
          <div className="flex items-center justify-end gap-1">
            <input
              value={price}
              placeholder="Precio"
              disabled={!editable}
              onChange={(event) => setPrice(event.target.value)}
              className="w-16 rounded-md border border-[#f5a524] bg-[#fff8ec] px-1.5 py-0.5 text-right font-bold"
            />
            <span className="text-[12px] text-[#8a92a3]">
              /{UNIT_LABEL[line.unit] ?? line.unit}
            </span>
            <GhostBtn
              disabled={!editable}
              onClick={() => {
                const n = Number(price);
                if (Number.isFinite(n) && n > 0) onPrice(line.unit, n);
              }}
            >
              Agregar precio
            </GhostBtn>
          </div>
        ) : line.price ? (
          editPrice(
            <span
              title={priceLabel({
                ...line.price,
                unit: line.price.unit,
                unit_cost: line.price.unit_cost,
                price_date: line.price.date,
                price_source: line.price.source,
              })}
            >
              {money(line.price.unit_cost)}/
              {UNIT_LABEL[line.price.unit] ?? line.price.unit}
              {line.ingredient_id ? (
                // Source and date link to the ingredient's one price record.
                <Link
                  href={ingredientHref(line.ingredient_id)}
                  className="block text-[12px] text-[#8a92a3] hover:text-[#3557c9] hover:underline"
                >
                  {[sourceLabel(line.price.source), monthLabel(line.price.date)]
                    .filter(Boolean)
                    .join(" · ")}
                </Link>
              ) : (
                <div className="text-[12px] text-[#8a92a3]">
                  {[sourceLabel(line.price.source), monthLabel(line.price.date)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              {line.excel_unit_cost !== null ? (
                <div className="text-[12px] text-[#8a92a3]">
                  en tu Excel: {money(line.excel_unit_cost)}
                </div>
              ) : null}
            </span>
          )
        ) : line.unit_cost !== null ? (
          editPrice(
            `${money(line.unit_cost)}/${UNIT_LABEL[line.unit] ?? line.unit}`
          )
        ) : (
          editPrice("Pendiente")
        )}
      </td>
      <td className="py-1.5 text-right align-top font-semibold">
        {line.amount !== null ? money(line.amount) : "Pendiente"}
        {line.amount !== null && line.unit_cost !== null && line.qty > 0 ? (
          // The cost chain (do not remove): price × quantity = cost.
          <div className="text-[12px] font-normal text-[#8a92a3]">
            {money(line.unit_cost)}/{UNIT_LABEL[line.unit] ?? line.unit} ×{" "}
            {line.qty} {UNIT_LABEL[line.unit] ?? line.unit}
          </div>
        ) : null}
        {editable && !unresolved && !editingPrice ? (
          <button
            type="button"
            className="block w-full text-right text-[12px] font-normal text-[#3557c9]"
            onClick={() => setEditingPrice(true)}
          >
            editar precio
          </button>
        ) : null}
      </td>
      <td className="py-1.5 pl-2 text-right align-top">
        {editable ? (
          <div className="flex justify-end gap-2 text-[12px]">
            {!unresolved ? (
              <button
                type="button"
                className="font-semibold text-[#3557c9]"
                onClick={onChange}
              >
                Cambiar
              </button>
            ) : null}
            <button
              type="button"
              className="font-semibold text-[#c03535]"
              onClick={onRemove}
            >
              Quitar
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

interface CreateDraft {
  name: string;
  unit: string;
  unit_cost?: number;
  quantity?: number;
  line_unit?: string;
}

interface PreparationDraft {
  name: string;
  yield_quantity: number;
  yield_unit: string;
  quantity?: number;
  line_unit?: string;
}

const ALL_UNITS = [...MASS, ...VOLUME, "unit", "portion"];

function Picker({
  target,
  options,
  busy,
  onCancel,
  onPick,
  onCreate,
  onCreatePreparation,
}: {
  target: PickTarget;
  options: PickerOption[];
  busy: boolean;
  onCancel: () => void;
  onPick: (option: PickerOption, quantity: number, unit: string) => void;
  onCreate: (draft: CreateDraft) => void;
  onCreatePreparation: (draft: PreparationDraft) => void;
}) {
  const startQuery =
    target.mode === "resolve"
      ? (target.line.possible_match?.name ?? target.line.raw_name)
      : "";
  const [query, setQuery] = useState(startQuery);
  const [chosen, setChosen] = useState<PickerOption | null>(null);
  const [qty, setQty] = useState("1");
  /** The unit the person picked, for which highlighted option. */
  const [unitChoice, setUnitChoice] = useState<{
    key: string;
    unit: string;
  } | null>(null);
  const [creating, setCreating] = useState<null | "ingredient" | "preparation">(
    null
  );
  const [newName, setNewName] = useState(
    target.mode === "resolve" ? target.line.raw_name : ""
  );
  const [newUnit, setNewUnit] = useState("oz");
  const [newPrice, setNewPrice] = useState("");
  // How much of it this recipe uses (only when adding a new line).
  const [lineQty, setLineQty] = useState("1");
  const [lineUnit, setLineUnit] = useState("oz");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("oz");

  // Filtered on the client as the person types: no server round trip.
  const shown = useMemo(
    () => searchPickerOptions(options, query).slice(0, 60),
    [options, query]
  );
  // The highlighted row: the one clicked, else the closest match.
  const active = chosen ?? shown[0] ?? null;
  // The unit shown is the unit used (bug a: a unit changed without
  // clicking a row was ignored).
  const unit = pickerUnit(active, unitChoice);

  function choose(option: PickerOption) {
    setChosen(option);
  }

  function add() {
    if (!active || busy) return;
    if (target.mode === "add" && !(Number(qty) > 0)) return;
    onPick(active, Number(qty) || 1, unit);
  }

  function move(step: number) {
    if (shown.length === 0) return;
    const at = active ? shown.indexOf(active) : -1;
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + step))];
    if (next) choose(next);
  }

  return (
    <div className="mb-2 space-y-2 rounded-[10px] border border-[#f5c98b] bg-[#fff8ec] p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              add();
            } else if (event.key === "Escape") {
              onCancel();
            }
          }}
          placeholder="Escribe para buscar en tus ingredientes y preparaciones"
          className="min-w-56 flex-1 rounded-md border border-[#d5dae3] bg-white px-2 py-1"
        />
        <GhostBtn onClick={onCancel}>Cancelar</GhostBtn>
      </div>

      {creating === null ? (
        <>
          <div
            role="listbox"
            className="max-h-56 overflow-auto rounded-md border border-[#d5dae3] bg-white"
          >
            {shown.map((o) => {
              const selected =
                active !== null && active.kind === o.kind && active.id === o.id;
              return (
                <button
                  key={`${o.kind}:${o.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(o)}
                  onDoubleClick={() => {
                    choose(o);
                    onPick(o, Number(qty) || 1, unitsLike(o.unit)[0] ?? "unit");
                  }}
                  className={
                    "flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1 text-left last:border-b-0 " +
                    (selected
                      ? "bg-[#3557c9] text-white"
                      : "hover:bg-[#eef3ff]")
                  }
                >
                  <span className="flex-1 truncate font-semibold">
                    {o.name}
                  </span>
                  <span
                    className={
                      "text-[12px] " +
                      (selected ? "text-white/80" : "text-[#8a92a3]")
                    }
                  >
                    {o.kind === "component" ? "Preparación · " : ""}
                    {priceLabel(o)}
                  </span>
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <p className="text-[#6b7385]">
              No hay nada con ese nombre en tu lista.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {active && target.mode === "add" ? (
              <>
                <span className="font-semibold">{active.name}</span>
                <input
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  className="w-16 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right"
                />
                <select
                  value={unit}
                  onChange={(event) =>
                    setUnitChoice({
                      key: `${active.kind}:${active.id}`,
                      unit: event.target.value,
                    })
                  }
                  className="rounded-md border border-[#d5dae3] bg-white px-1 py-1"
                >
                  {unitsLike(active.unit).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u] ?? u}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <PrimaryBtn
              disabled={
                busy || !active || (target.mode === "add" && !(Number(qty) > 0))
              }
              onClick={add}
            >
              {target.mode === "add" ? "Agregar" : "Usar este"}
            </PrimaryBtn>
            <span className="text-[12px] text-[#8a92a3]">o Enter</span>
            <span className="ml-auto flex flex-wrap gap-3">
              <button
                type="button"
                className="font-semibold text-[#3557c9]"
                onClick={() => setCreating("ingredient")}
              >
                ¿No está? Agregar ingrediente
              </button>
              <button
                type="button"
                className="font-semibold text-[#3557c9]"
                onClick={() => setCreating("preparation")}
              >
                Crear preparación
              </button>
            </span>
          </div>
        </>
      ) : creating === "ingredient" ? (
        <div className="space-y-2">
          <p className="text-[#6b7385]">
            Esto agrega un ingrediente nuevo a tu lista. Revisa que no esté ya
            con otro nombre. Sin precio queda pendiente, nunca en $0.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nombre"
              className="min-w-48 flex-1 rounded-md border border-[#d5dae3] bg-white px-2 py-1"
            />
            <label className="inline-flex items-center gap-1">
              Lo compras por
              <select
                value={newUnit}
                onChange={(event) => {
                  setNewUnit(event.target.value);
                  setLineUnit(unitsLike(event.target.value)[0] ?? "unit");
                }}
                className="rounded-md border border-[#d5dae3] bg-white px-1 py-1"
              >
                {[...MASS, ...VOLUME, "unit"].map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u] ?? u}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1">
              Precio por esa unidad (opcional)
              <input
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
                className="w-20 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right"
              />
            </label>
          </div>
          {target.mode === "add" ? (
            <LineAmount
              qty={lineQty}
              unit={lineUnit}
              units={unitsLike(newUnit)}
              onQty={setLineQty}
              onUnit={setLineUnit}
            />
          ) : null}
          <div className="flex gap-2">
            <GhostBtn
              disabled={
                busy ||
                !newName.trim() ||
                (newPrice.trim() !== "" && !(Number(newPrice) > 0)) ||
                (target.mode === "add" && !(Number(lineQty) > 0))
              }
              onClick={() => {
                const price = Number(newPrice);
                onCreate({
                  name: newName.trim(),
                  unit: newUnit,
                  unit_cost: newPrice.trim() && price > 0 ? price : undefined,
                  quantity: Number(lineQty) || 1,
                  line_unit: lineUnit,
                });
              }}
            >
              Agregar y usar
            </GhostBtn>
            <GhostBtn onClick={() => setCreating(null)}>
              Volver a la lista
            </GhostBtn>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[#6b7385]">
            Crea una preparación de tu cocina (una salsa, una masa…). Queda como
            borrador: luego agregas sus ingredientes en Preparaciones y la
            puedes usar en otros platos.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nombre de la preparación"
              className="min-w-48 flex-1 rounded-md border border-[#d5dae3] bg-white px-2 py-1"
            />
            <label className="inline-flex items-center gap-1">
              Una tanda rinde
              <input
                value={yieldQty}
                onChange={(event) => setYieldQty(event.target.value)}
                className="w-16 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right"
              />
              <select
                value={yieldUnit}
                onChange={(event) => {
                  setYieldUnit(event.target.value);
                  setLineUnit(unitsLike(event.target.value)[0] ?? "unit");
                }}
                className="rounded-md border border-[#d5dae3] bg-white px-1 py-1"
              >
                {ALL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u] ?? u}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {target.mode === "add" ? (
            <LineAmount
              qty={lineQty}
              unit={lineUnit}
              units={unitsLike(yieldUnit)}
              onQty={setLineQty}
              onUnit={setLineUnit}
            />
          ) : null}
          <div className="flex gap-2">
            <GhostBtn
              disabled={
                busy ||
                !newName.trim() ||
                !(Number(yieldQty) > 0) ||
                (target.mode === "add" && !(Number(lineQty) > 0))
              }
              onClick={() =>
                onCreatePreparation({
                  name: newName.trim(),
                  yield_quantity: Number(yieldQty),
                  yield_unit: yieldUnit,
                  quantity: Number(lineQty) || 1,
                  line_unit: lineUnit,
                })
              }
            >
              Crear y usar
            </GhostBtn>
            <GhostBtn onClick={() => setCreating(null)}>
              Volver a la lista
            </GhostBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function LineAmount({
  qty,
  unit,
  units,
  onQty,
  onUnit,
}: {
  qty: string;
  unit: string;
  units: string[];
  onQty: (value: string) => void;
  onUnit: (value: string) => void;
}) {
  const shown = units.includes(unit) ? units : [unit, ...units];
  return (
    <label className="flex flex-wrap items-center gap-1">
      Esta receta lleva
      <input
        value={qty}
        onChange={(event) => onQty(event.target.value)}
        className="w-16 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right"
      />
      <select
        value={unit}
        onChange={(event) => onUnit(event.target.value)}
        className="rounded-md border border-[#d5dae3] bg-white px-1 py-1"
      >
        {shown.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u] ?? u}
          </option>
        ))}
      </select>
    </label>
  );
}
