"use client";

import { useState } from "react";
import { formatResetPartialFailureEs } from "@/lib/restaurant/cost-workbook/reset";
import type { CostResetStepResult } from "@/lib/restaurant/cost-workbook/types";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { Card, GhostBtn } from "./ui";

/**
 * "Empezar de nuevo": a destructive, owner/admin-only action that clears
 * the whole costing setup so the next cost-file upload behaves like a
 * first one. Explicit typed confirmation; the server checks it again.
 */
export function ResetPanel({
  reset,
  locationId,
  onDone,
  initiallyOpen = false,
  onCancel,
}: {
  reset: NonNullable<RecipeCostingWorkspace["reset"]>;
  locationId: string | null;
  onDone: () => void;
  /** Opened from the "⋯" menu: show the confirmation right away. */
  initiallyOpen?: boolean;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/costs/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm_name: typed,
          location_id: locationId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        steps?: CostResetStepResult[];
      };
      if (!res.ok) {
        setError(
          json.steps?.length
            ? formatResetPartialFailureEs(json.steps)
            : (json.error ?? "No se pudo empezar de nuevo.")
        );
      } else {
        setDone(true);
        setTyped("");
        setOpen(false);
        // Reload only after a real reset; on a refusal the error stays.
        onDone();
      }
    } catch {
      setError("No se pudo empezar de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-[#f1c0c0] p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[#c03535]">
          Empezar de nuevo
        </h2>
        {!open ? (
          <GhostBtn className="ml-auto" onClick={() => setOpen(true)}>
            Empezar de nuevo
          </GhostBtn>
        ) : null}
      </div>
      {done ? (
        <p className="mt-2 text-[#1f7a45]">
          Listo. Tus ventas del POS siguen igual; sube tu Excel de costos para
          empezar.
        </p>
      ) : null}
      {open ? (
        <div className="mt-2 space-y-2">
          <p>
            <b>Se borra:</b> ingredientes y precios, preparaciones, recetas y
            todas sus versiones (también las aprobadas), los vínculos y
            tratamientos de los productos del POS, los nombres recordados, las
            filas por revisar y los platillos que creó el costeo. Tus cargas
            quedan archivadas y no se vuelven a usar.
          </p>
          <p>
            <b>No se toca:</b> las ventas del POS, la conexión con Odoo ni los
            platillos que no creó el costeo.
          </p>
          {reset.warning ? (
            <p className="font-semibold text-[#c03535]">{reset.warning}</p>
          ) : null}
          <label className="block">
            {reset.prompt}
            <input
              value={typed}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#d5dae3] bg-white px-2 py-1.5 text-sm"
            />
          </label>
          {error ? (
            <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-[#c03535]">
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !typed.trim()}
              onClick={() => void run()}
              className="rounded-md border border-[#c03535] bg-[#c03535] px-2.5 py-1 text-[12.5px] font-semibold text-white disabled:opacity-45"
            >
              {busy ? "Borrando…" : "Borrar todo y empezar de nuevo"}
            </button>
            <GhostBtn
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onCancel?.();
              }}
            >
              Cancelar
            </GhostBtn>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
