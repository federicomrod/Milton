"use client";

import { useEffect, useRef, useState } from "react";
import { GhostBtn, PrimaryBtn } from "./ui";
import { PENDING_PRICE_CHOICES_NOTE } from "./pending-price-note";

/** Id of the «2. Importar recetas» button (scrolled into view after step 1). */
export const IMPORT_RECIPES_BUTTON_ID = "importar-recetas";

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
  /** Dishes that already have a recipe with lines. */
  conflicts?: ConflictRow[];
}

interface ConflictRow {
  key: string;
  dish: string;
  size: string | null;
  my_cost: number | null;
  my_lines: number;
  excel_cost: number | null;
  excel_lines: number;
}

type Choice = "mine" | "excel";

interface Imported {
  batch_id: string;
  dishes_imported: number;
  typed_prices_not_carried?: number;
  dishes_linked: number;
  dishes_skipped: number;
  dishes_filled?: number;
  dishes_kept?: number;
  dishes_replaced?: number;
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
  canEditPrices = true,
  onImported,
  onDishes,
  primary = true,
  hasPendingPriceChoices = false,
}: {
  /** The saved upload (draft); changes when a new file is picked. */
  draftToken: string | null;
  /** What "Importar" already saved from this file, after a reload. */
  initialImported: Record<string, unknown> | null;
  locationId: string | null;
  busyExternal: boolean;
  /** The server's can("prices.edit") answer: undoing a batch changes prices. */
  canEditPrices?: boolean;
  onImported: () => void;
  /** How many dishes the file's recipes hold (0 = none to import). */
  onDishes?: (count: number) => void;
  /** True while some «dos costos» choice is still unanswered. */
  hasPendingPriceChoices?: boolean;
  /** Step 2 is the next primary action (prices already saved or nothing to save). */
  primary?: boolean;
}) {
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [imported, setImported] = useState<Imported | null>(
    (initialImported as unknown as Imported | null) ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per dish with its own recipe: keep mine (default) or use the Excel's. */
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  useEffect(() => {
    setImported((initialImported as unknown as Imported | null) ?? null);
  }, [initialImported]);

  const hasImported = imported !== null;
  // Read through a ref: a new callback from the parent must not refetch.
  const onDishesRef = useRef(onDishes);
  useEffect(() => {
    onDishesRef.current = onDishes;
  }, [onDishes]);
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
        if (!cancelled) {
          setPreview(json);
          onDishesRef.current?.(json.dishes ?? 0);
        }
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
      const excel = Object.fromEntries(
        Object.entries(choices).filter(([, choice]) => choice === "excel")
      );
      if (Object.keys(excel).length > 0) {
        form.append("choices", JSON.stringify(excel));
      }
      const res = await fetch("/api/restaurant/recipes/import", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as Imported & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No pude importar.");
      setImported(json);
      setPreview(null);
      onDishesRef.current?.(0);
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
            <details className="text-[12px] text-[#5b6476]">
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
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[12px] font-semibold text-[#8a92a3]">
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
                      <div className="text-[12px] text-[#8a92a3]">
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
                        (row.match ? "text-[#1f9d55]" : "text-[#6b7280]")
                      }
                    >
                      {row.match ? "✓" : "✗"}
                    </td>
                    <td className="px-2 py-1 text-[12px] text-[#5b6476]">
                      {row.skip_reason ? (
                        <div className="text-[#6b7280]">{row.skip_reason}</div>
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
          {preview.conflicts && preview.conflicts.length > 0 ? (
            <ConflictSection
              conflicts={preview.conflicts}
              choices={choices}
              onChoice={(key, choice) =>
                setChoices((prev) => ({ ...prev, [key]: choice }))
              }
              onAllExcel={() =>
                setChoices(
                  Object.fromEntries(
                    (preview.conflicts ?? []).map((row) => [row.key, "excel"])
                  ) as Record<string, Choice>
                )
              }
            />
          ) : null}
          {(() => {
            const Btn = primary ? PrimaryBtn : GhostBtn;
            return (
              <>
                {hasPendingPriceChoices ? (
                  <p className="text-[12px] text-[#6b7280]">
                    {PENDING_PRICE_CHOICES_NOTE}
                  </p>
                ) : null}
                <Btn
                  id={IMPORT_RECIPES_BUTTON_ID}
                  disabled={busy || busyExternal}
                  onClick={() => void importRecipes()}
                >
                  {busy
                    ? "Importando…"
                    : `2. Importar recetas (${preview.dishes} ${preview.dishes === 1 ? "plato" : "platos"})`}
                </Btn>
              </>
            );
          })()}
        </>
      ) : null}

      {imported ? (
        <div className="rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-xs text-[#1f7a45]">
          Importamos {imported.dishes_imported} platos como borrador (
          {imported.dishes_linked} vinculados a tu POS),{" "}
          {imported.preparations_created} preparaciones y{" "}
          {imported.ingredients_created} ingredientes nuevos.
          {imported.dishes_filled
            ? ` ${imported.dishes_filled} ${imported.dishes_filled === 1 ? "plato vacío se llenó" : "platos vacíos se llenaron"} con la receta del Excel.`
            : ""}
          {imported.dishes_kept
            ? ` Mantuvimos ${imported.dishes_kept} ${imported.dishes_kept === 1 ? "receta tuya" : "recetas tuyas"}.`
            : ""}
          {imported.dishes_replaced
            ? ` ${imported.dishes_replaced} ${imported.dishes_replaced === 1 ? "plato tiene" : "platos tienen"} un borrador nuevo del Excel (la receta anterior sigue en su historial).`
            : ""}
          {imported.dishes_skipped > 0
            ? ` ${imported.dishes_skipped} platos no se tocaron.`
            : ""}
          {imported.typed_prices_not_carried
            ? ` ${imported.typed_prices_not_carried} precios escritos a mano cambiaron de unidad y quedaron Pendiente: escríbelos de nuevo en el plato.`
            : ""}{" "}
          <GhostBtn
            disabled={busy || !canEditPrices}
            onClick={() => void undo(imported.batch_id)}
          >
            Deshacer lote
          </GhostBtn>
        </div>
      ) : null}
    </section>
  );
}

function linesWord(n: number): string {
  return `${n} ${n === 1 ? "línea" : "líneas"}`;
}

/** «N platos ya tienen receta»: keep mine (default) or use the Excel's, per dish. */
function ConflictSection({
  conflicts,
  choices,
  onChoice,
  onAllExcel,
}: {
  conflicts: ConflictRow[];
  choices: Record<string, Choice>;
  onChoice: (key: string, choice: Choice) => void;
  onAllExcel: () => void;
}) {
  return (
    <section
      className="space-y-1.5 rounded-lg border border-[#c6d3f5] bg-[#f6f8fe] px-3 py-2"
      data-testid="import-conflicts"
    >
      <div className="flex items-center gap-2">
        <h4 className="text-[12.5px] font-semibold text-[#151c2c]">
          {conflicts.length}{" "}
          {conflicts.length === 1 ? "plato ya tiene" : "platos ya tienen"}{" "}
          receta
        </h4>
        <button
          type="button"
          onClick={onAllExcel}
          className="ml-auto text-[12px] font-semibold text-[#1B40C8] hover:underline"
        >
          Usar Excel en todos
        </button>
      </div>
      <p className="text-[12px] text-[#5b6476]">
        Por defecto se queda la tuya. Si eliges el Excel, se crea un borrador
        nuevo y la receta anterior sigue en su historial.
      </p>
      <ul className="max-h-48 divide-y divide-[#e3e9f8] overflow-auto rounded-md border border-[#e3e9f8] bg-white">
        {conflicts.map((row) => {
          const choice = choices[row.key] ?? "mine";
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-[12px]"
            >
              <b className="min-w-32">{row.dish}</b>
              <span className="text-[#5b6476]">
                Tu receta:{" "}
                {row.my_cost !== null ? money(row.my_cost) : "Sin precio"} ·{" "}
                {linesWord(row.my_lines)}
              </span>
              <span className="text-[#5b6476]">
                Excel:{" "}
                {row.excel_cost !== null ? money(row.excel_cost) : "Sin precio"}{" "}
                · {linesWord(row.excel_lines)}
              </span>
              <span
                role="group"
                aria-label={`Receta de ${row.dish}`}
                className="ml-auto inline-flex overflow-hidden rounded-md border border-[#1B40C8]"
              >
                {(
                  [
                    ["mine", "Mantener la mía"],
                    ["excel", "Usar la del Excel"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={choice === value}
                    onClick={() => onChoice(row.key, value)}
                    className={
                      "px-2 py-0.5 text-[12px] font-semibold " +
                      (choice === value
                        ? "bg-[#1B40C8] text-white"
                        : "bg-white text-[#1B40C8] hover:bg-[#f6f8fe]")
                    }
                  >
                    {label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
