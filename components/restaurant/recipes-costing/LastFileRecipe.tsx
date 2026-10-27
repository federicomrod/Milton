"use client";

// «Traer receta del último archivo»: this dish's recipe from the last
// uploaded cost file, side by side with the recipe it has now. «Usar esta
// receta» adds it as a NEW draft version (old versions untouched). The file
// is the saved upload read again; nothing is uploaded here.

import { useCallback, useEffect, useState } from "react";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import type { LastFileLookup } from "@/lib/restaurant/recipe-import/last-file";
import { userErrorMessage } from "@/lib/restaurant/user-error";

const cache = new Map<string, LastFileLookup>();

function cacheKey(odooProductId: number, locationId: string | null): string {
  return `${odooProductId}:${locationId ?? ""}`;
}

/** The dish in the last file (null while loading or when the lookup failed). */
export function useLastFileRecipe(
  odooProductId: number,
  locationId: string | null,
  enabled: boolean
): { lookup: LastFileLookup | null; refresh: () => void } {
  const key = cacheKey(odooProductId, locationId);
  const [fetched, setFetched] = useState<{
    key: string;
    data: LastFileLookup | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || (attempt === 0 && cache.has(key))) return;
    let cancelled = false;
    const q = new URLSearchParams({ odoo_product_id: String(odooProductId) });
    if (locationId) q.set("location_id", locationId);
    fetch(`/api/restaurant/recipes/last-file?${q.toString()}`)
      .then(async (res) =>
        res.ok ? ((await res.json()) as LastFileLookup) : null
      )
      .then((json) => {
        if (cancelled) return;
        if (json) cache.set(key, json);
        setFetched({ key, data: json });
      })
      .catch(() => {
        if (!cancelled) setFetched({ key, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, odooProductId, locationId, attempt]);

  const refresh = useCallback(() => {
    cache.delete(key);
    setFetched(null);
    setAttempt((n) => n + 1);
  }, [key]);
  const lookup =
    fetched && fetched.key === key ? fetched.data : (cache.get(key) ?? null);
  return { lookup: enabled ? lookup : null, refresh };
}

type Available = Extract<LastFileLookup, { available: true }>;

function qty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** The side-by-side preview and «Usar esta receta». */
export function LastFileDialog({
  open,
  lookup,
  odooProductId,
  locationId,
  currency,
  onClose,
  onDone,
}: {
  open: boolean;
  lookup: Available;
  odooProductId: number;
  locationId: string | null;
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const money = (n: number | null) =>
    n === null ? "Sin precio" : formatMoneyEs(n, currency);

  async function use() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/recipes/last-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          odoo_product_id: odooProductId,
          location_id: locationId,
          recipe_key: lookup.recipe_key,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok)
        throw new Error(userErrorMessage(json, "No pude traer la receta."));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude traer la receta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-label="Receta del último archivo"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[#dfe3ea] bg-white p-4 shadow-xl"
      >
        <h2 className="text-base font-semibold text-[#151c2c]">
          Receta del último archivo
        </h2>
        <p className="mt-0.5 text-[12px] text-[#6b7385]">
          {lookup.filename}. Se crea un borrador nuevo; tu receta actual y sus
          versiones no se tocan.
        </p>
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2">
          <Column
            title="Tu receta ahora"
            empty="Sin líneas todavía"
            lines={lookup.current.lines.map((l) => ({
              name: l.name,
              quantity: l.quantity,
              unit: l.unit,
              cost: l.cost,
            }))}
            total={lookup.current.total}
            money={money}
          />
          <Column
            title="Del archivo"
            empty="Sin líneas"
            lines={lookup.file.lines}
            total={lookup.file.total}
            money={money}
          />
        </div>
        {error ? (
          <div
            role="alert"
            className="mt-2 rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]"
          >
            {error}
          </div>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-[#1B40C8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1B40C8] hover:bg-[#f6f8fe] disabled:opacity-45"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || lookup.file.lines.length === 0}
            onClick={() => void use()}
            className="rounded-md bg-[#1B40C8] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1535a6] disabled:opacity-45"
          >
            {busy ? "Trayendo…" : "Usar esta receta"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Column({
  title,
  empty,
  lines,
  total,
  money,
}: {
  title: string;
  empty: string;
  lines: ReadonlyArray<{
    name: string;
    quantity: number;
    unit: string;
    cost: number | null;
  }>;
  total: number | null;
  money: (n: number | null) => string;
}) {
  return (
    <section className="rounded-lg border border-[#eef0f4]">
      <h3 className="border-b border-[#eef0f4] px-3 py-1.5 text-[12.5px] font-semibold text-[#151c2c]">
        {title} · {lines.length} {lines.length === 1 ? "línea" : "líneas"}
      </h3>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-[#8a92a3]">{empty}</p>
      ) : (
        <table className="w-full text-[12px]">
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={`${line.name}-${index}`}
                className="border-t border-[#f2f3f6]"
              >
                <td className="px-3 py-1">{line.name}</td>
                <td className="px-2 py-1 text-right text-[#5b6476]">
                  {qty(line.quantity)} {line.unit}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {money(line.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-between border-t border-[#eef0f4] px-3 py-1.5 text-[12px] font-semibold">
        <span>Costo</span>
        <span>{money(total)}</span>
      </div>
    </section>
  );
}
