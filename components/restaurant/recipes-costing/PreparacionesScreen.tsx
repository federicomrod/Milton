"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import type {
  PreparationRow,
  PreparationsOverview,
} from "@/lib/restaurant/recipe-costing/preparations-server";
import { ConfirmHowDialog } from "./ConfirmHowDialog";
import { RecipeLinesEditor } from "./RecipeLinesEditor";
import { Card, Chip, GhostBtn } from "./ui";

const UNITS = ["oz", "lb", "g", "kg", "ml", "l", "gal", "unit", "portion"];
const UNIT_LABEL: Record<string, string> = {
  oz: "onzas",
  lb: "libras",
  g: "gramos",
  kg: "kilos",
  ml: "ml",
  l: "litros",
  gal: "galones",
  unit: "unidades",
  portion: "porciones",
};

const UNIT_SINGULAR: Record<string, string> = {
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

const STATUS: Record<
  PreparationRow["status"],
  { label: string; tone: "warn" | "ok" | "grey" }
> = {
  borrador: { label: "Por aprobar", tone: "warn" },
  aprobada: { label: "Aprobada", tone: "ok" },
  sin_receta: { label: "Sin receta", tone: "grey" },
};

export function PreparacionesScreen({
  data,
  selectedId,
  onSelect,
  locationId,
  onBackToDish,
}: {
  data: RecipeCostingWorkspace;
  selectedId: string | null;
  onSelect: (componentId: string | null) => void;
  /** Set when the person came from a dish: back to it. */
  onBackToDish?: () => void;
  locationId?: string | null;
}) {
  const [overview, setOverview] = useState<PreparationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const q = locationId
        ? `?location_id=${encodeURIComponent(locationId)}`
        : "";
      const res = await fetch(`/api/restaurant/recipes/preparations${q}`);
      const json = (await res
        .json()
        .catch(() => ({}))) as PreparationsOverview & {
        error?: string;
      };
      if (cancelled) return;
      if (!res.ok) setError(json.error ?? "No pude cargar las preparaciones.");
      else {
        setOverview(json);
        setError(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, reloadKey]);

  // R1-09c: an edit refreshes only this list (once, after a burst of
  // edits); the Menú workspace is not reloaded.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setReloadKey((k) => k + 1);
    }, 600);
  }, []);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  return (
    <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[330px_1fr]">
      <Card className="p-3">
        {onBackToDish ? (
          <button
            type="button"
            onClick={onBackToDish}
            className="mb-2 text-[12px] font-semibold text-[#3557c9]"
          >
            ← Volver al plato
          </button>
        ) : null}
        <h2
          className="mb-2 text-[15px] font-semibold"
          title="Un plato que usa una preparación queda pendiente hasta que la apruebes. Empieza por las que desbloquean más ventas."
        >
          Preparaciones de tu cocina
        </h2>
        {error ? (
          <p className="text-xs text-[#c03535]">{error}</p>
        ) : !overview ? (
          <p className="text-xs text-[#5b6476]">Cargando…</p>
        ) : (
          <>
            <div className="mb-2 flex gap-2 text-[12px]">
              <Chip tone="warn">{overview.drafts} por aprobar</Chip>
              <Chip tone="ok">{overview.approved} aprobadas</Chip>
            </div>
            {overview.rows.length === 0 ? (
              <p className="text-xs text-[#5b6476]">
                Todavía no hay preparaciones. Se crean al subir tu Excel de
                costos, o desde un plato con «Crear preparación».
              </p>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                {overview.rows.map((row) => (
                  <button
                    key={row.component_id}
                    type="button"
                    onClick={() => onSelect(row.component_id)}
                    className={
                      "block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50 " +
                      (selectedId === row.component_id ? "bg-[#f4f6fb]" : "")
                    }
                  >
                    <div className="flex items-center gap-2">
                      <b className="flex-1">{row.name}</b>
                      <Chip tone={STATUS[row.status].tone}>
                        {STATUS[row.status].label}
                      </Chip>
                    </div>
                    <div className="text-[12px] text-[#5b6476]">
                      {row.impact_label}
                      {row.yield_to_confirm
                        ? " · rendimiento por confirmar"
                        : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {selectedId ? (
        <PreparationDetail
          key={selectedId}
          componentId={selectedId}
          actor={data.actor}
          reloadKey={reloadKey}
          onChanged={refresh}
          onOpen={onSelect}
        />
      ) : (
        <Card className="p-4 text-sm text-[#5b6476]">
          Elige una preparación para revisar sus ingredientes, confirmar cuánto
          rinde y aprobarla.
        </Card>
      )}
    </div>
  );
}

function PreparationDetail({
  componentId,
  actor,
  reloadKey,
  onChanged,
  onOpen,
}: {
  componentId: string;
  actor: RecipeCostingWorkspace["actor"];
  reloadKey: number;
  onChanged: () => void;
  onOpen: (componentId: string) => void;
}) {
  const [state, setState] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [howOpen, setHowOpen] = useState(false);
  const prep = state?.preparation;
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("oz");

  const handleState = useCallback((next: EditorState) => {
    setState(next);
    if (next.preparation?.yield) {
      setQty(String(next.preparation.yield.value));
      setUnit(next.preparation.yield.unit);
    }
  }, []);

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No pude guardar.");
      // Yield or approval changed the version: reload this editor once.
      setLocalReload((k) => k + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude guardar.");
    } finally {
      setBusy(false);
    }
  }

  const approve = (how?: string) =>
    void post("/api/restaurant/recipes/preparations/approve", {
      component_id: componentId,
      confirmed_how: how,
    });

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <RecipeLinesEditor
          componentId={componentId}
          portionCostLabel={null}
          reloadKey={reloadKey + localReload}
          onEdited={onChanged}
          onState={handleState}
          onOpenPreparation={onOpen}
        />
      </Card>

      {prep ? (
        <Card className="space-y-2 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">
              Cuánto rinde {prep.name}
            </h3>
            {prep.yield?.confirmed ? (
              <Chip tone="ok">Confirmado</Chip>
            ) : (
              <Chip tone="warn">Sugerido, por confirmar</Chip>
            )}
          </div>
          {state?.editable ? (
            <div className="flex flex-wrap items-center gap-2">
              Esta receta rinde
              <input
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                className="w-20 rounded-md border border-[#d5dae3] bg-white px-2 py-1 text-right"
              />
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="rounded-md border border-[#d5dae3] bg-white px-1 py-1"
              >
                {(UNITS.includes(unit) ? UNITS : [unit, ...UNITS]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u] ?? u}
                  </option>
                ))}
              </select>
              <GhostBtn
                disabled={busy || !(Number(qty) > 0)}
                onClick={() =>
                  void post("/api/restaurant/recipes/editor", {
                    component_id: componentId,
                    action: "set_yield",
                    quantity: Number(qty),
                    unit,
                  })
                }
              >
                Confirmar rendimiento
              </GhostBtn>
            </div>
          ) : (
            <p>
              Rinde {prep.yield?.value}{" "}
              {UNIT_LABEL[prep.yield?.unit ?? ""] ?? prep.yield?.unit}
            </p>
          )}
          <div className="text-[#5b6476]">
            {prep.cost_per_output_unit !== null && prep.yield
              ? `Costo: ${money(prep.cost_per_output_unit)} por ${UNIT_SINGULAR[prep.yield.unit] ?? prep.yield.unit}`
              : "El costo aparece cuando todas las líneas tienen precio."}
          </div>

          {error ? (
            <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-[#c03535]">
              {error}
            </div>
          ) : null}

          {state?.editable ? (
            <div className="flex items-center gap-2">
              {/* C3: only what blocks, as a chip; the detail is in the
                  button's tooltip (with who approves, B9). */}
              <span
                title={
                  actor.can_approve
                    ? prep.checklist.blockers.join(" · ") ||
                      "Aprueba el dueño o un admin."
                    : "Aprueba el dueño o un admin. Déjala lista y avísales."
                }
              >
                <button
                  type="button"
                  disabled={busy || !actor.can_approve || !prep.checklist.ready}
                  onClick={() =>
                    actor.needs_client_confirmation
                      ? setHowOpen(true)
                      : approve()
                  }
                  className="rounded-lg bg-[#f28c28] px-3.5 py-[7px] text-[13px] font-semibold text-white hover:bg-[#e07b1a] disabled:opacity-45"
                >
                  Aprobar
                </button>
              </span>
              {!prep.checklist.ready && prep.checklist.blockers[0] ? (
                <span className="rounded-md bg-[#fff4e5] px-1.5 py-0.5 text-[12px] font-semibold text-[#a35a00]">
                  {prep.checklist.blockers.length === 1
                    ? prep.checklist.blockers[0]
                    : `${prep.checklist.blockers.length} pendientes`}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-[#1f7a45]">
              Aprobada: ya cuenta en los platos que la usan.
            </p>
          )}
        </Card>
      ) : null}

      <ConfirmHowDialog
        open={howOpen}
        title="Aprobar en nombre del cliente"
        onCancel={() => setHowOpen(false)}
        onConfirm={(how) => {
          setHowOpen(false);
          approve(how);
        }}
      />
    </div>
  );
}
