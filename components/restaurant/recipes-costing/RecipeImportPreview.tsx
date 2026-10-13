"use client";

import { useEffect, useState } from "react";
import { GhostBtn, PrimaryBtn } from "./ui";

interface PreviewRow {
  key: string;
  dish: string;
  source: string;
  calculated_cost: number;
  excel_total_cost: number | null;
  match: boolean;
  pos_name: string | null;
  link_note: string;
  skip_reason: string | null;
  flags: string[];
}

interface RecipePreview {
  rows: PreviewRow[];
  dishes: number;
  matching: number;
  preparations: number;
  ingredients_new: number;
  ingredients_reused: number;
  linked: number;
  skipped: number;
  unmatched?: Array<{ dish: string; reason: string }>;
}

interface Imported {
  batch_id: string;
  dishes_imported: number;
  dishes_linked: number;
  dishes_skipped: number;
  preparations_created: number;
  ingredients_created: number;
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

/**
 * The recipes of the cost file, read before anything is saved: one row
 * per dish with our cost, the Excel's COSTO TOTAL and whether they match.
 * Nothing is written until "Importar".
 */
export function RecipeImportPreview({
  draftToken,
  initialImported,
  locationId,
  busyExternal,
  onImported,
}: {
  /** The saved upload (draft); changes when a new file is picked. */
  draftToken: string | null;
  /** What "Importar" already saved from this file, after a reload. */
  initialImported: Record<string, unknown> | null;
  locationId: string | null;
  busyExternal: boolean;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [imported, setImported] = useState<Imported | null>(
    (initialImported as unknown as Imported | null) ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImported((initialImported as unknown as Imported | null) ?? null);
  }, [initialImported]);

  const hasImported = imported !== null;
  useEffect(() => {
    if (!draftToken || hasImported) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setPreview(null);
    const form = new FormData();
    form.append("draft", "1");
    form.append("mode", "preview");
    if (locationId) form.append("location_id", locationId);
    fetch("/api/restaurant/recipes/import", { method: "POST", body: form })
      .then(async (res) => {
        const json = (await res.json()) as RecipePreview & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "No pude leer las recetas.");
        if (!cancelled) setPreview(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "No pude leer las recetas."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftToken, hasImported, locationId]);

  async function importRecipes() {
    if (!draftToken) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("draft", "1");
      form.append("mode", "apply");
      if (locationId) form.append("location_id", locationId);
      const res = await fetch("/api/restaurant/recipes/import", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as Imported & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No pude importar.");
      setImported(json);
      setPreview(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude importar.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(batchId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant/costs/batches/${batchId}/undo`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("No pude deshacer.");
      setImported(null);
      // The file is still saved: forget the import and preview it again.
      await fetch("/api/restaurant/recipes/upload-draft", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipes_result: null }),
      });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude deshacer.");
    } finally {
      setBusy(false);
    }
  }

  if (!draftToken && !imported) return null;

  return (
    <section className="space-y-2 border-t border-slate-100 pt-3">
      <h3 className="text-[13px] font-semibold">Recetas de tu archivo</h3>
      {busy && !preview ? (
        <p className="text-xs text-[#5b6476]">Leyendo tus recetas…</p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]">
          {error}
        </div>
      ) : null}

      {preview ? (
        <>
          <p className="text-xs text-[#5b6476]">
            {preview.dishes} platos · {preview.matching} cuadran con el COSTO
            TOTAL del Excel · {preview.preparations} preparaciones ·{" "}
            {preview.ingredients_new} ingredientes nuevos
            {preview.ingredients_reused > 0
              ? ` (${preview.ingredients_reused} ya estaban)`
              : ""}{" "}
            · {preview.linked} vinculados a tu POS. Todo entra como borrador:
            nada cuenta en los márgenes hasta que lo apruebes.
          </p>
          {preview.unmatched && preview.unmatched.length > 0 ? (
            <details className="text-[11px] text-[#5b6476]">
              <summary className="cursor-pointer font-semibold">
                {preview.unmatched.length} platos sin vínculo al POS (sin contar
                eventos): por qué
              </summary>
              <ul className="mt-1 list-disc pl-4">
                {preview.unmatched.map((row) => (
                  <li key={row.dish}>
                    <b>{row.dish}</b>: {row.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[10.5px] font-semibold text-[#8a92a3]">
                  <th className="px-2 py-1.5">Plato</th>
                  <th className="px-2 py-1.5 text-right">Nuestro costo</th>
                  <th className="px-2 py-1.5 text-right">COSTO TOTAL Excel</th>
                  <th className="px-2 py-1.5 text-center">Cuadra</th>
                  <th className="px-2 py-1.5">Avisos</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="px-2 py-1">
                      <b>{row.dish}</b>
                      <div className="text-[10px] text-[#8a92a3]">
                        {row.source}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {money(row.calculated_cost)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {money(row.excel_total_cost)}
                    </td>
                    <td
                      className={
                        "px-2 py-1 text-center font-bold " +
                        (row.match ? "text-[#1f9d55]" : "text-[#c03535]")
                      }
                    >
                      {row.match ? "✓" : "✗"}
                    </td>
                    <td className="px-2 py-1 text-[10.5px] text-[#5b6476]">
                      {row.skip_reason ? (
                        <div className="text-[#a35a00]">{row.skip_reason}</div>
                      ) : null}
                      <div>
                        {row.pos_name ? `POS: ${row.pos_name}` : row.link_note}
                      </div>
                      {row.flags.length > 0 ? (
                        <div>{row.flags.join(" · ")}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PrimaryBtn
            disabled={busy || busyExternal}
            onClick={() => void importRecipes()}
          >
            {busy ? "Importando…" : "Importar"}
          </PrimaryBtn>
        </>
      ) : null}

      {imported ? (
        <div className="rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-xs text-[#1f7a45]">
          Importamos {imported.dishes_imported} platos como borrador (
          {imported.dishes_linked} vinculados a tu POS),{" "}
          {imported.preparations_created} preparaciones y{" "}
          {imported.ingredients_created} ingredientes nuevos.
          {imported.dishes_skipped > 0
            ? ` ${imported.dishes_skipped} platos ya tenían receta aprobada o hecha a mano y no se tocaron.`
            : ""}{" "}
          <GhostBtn
            disabled={busy}
            onClick={() => void undo(imported.batch_id)}
          >
            Deshacer lote
          </GhostBtn>
        </div>
      ) : null}
    </section>
  );
}
