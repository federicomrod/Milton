"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import type { CostConflict } from "@/lib/restaurant/price-catalog/conflicts";
import type {
  CatalogUnit,
  PriceCatalogRow,
} from "@/lib/restaurant/price-catalog/reader";
import {
  IMPORT_RECIPES_BUTTON_ID,
  RecipeImportPreview,
} from "./RecipeImportPreview";
import { pendingPriceChoicesNote } from "./pending-price-note";
import { useT } from "@/lib/i18n/client";
import { Card, Chip, GhostBtn, PrimaryBtn } from "./ui";
import { userErrorMessage } from "@/lib/restaurant/user-error";

function money(value: number): string {
  const text = value >= 1 ? value.toFixed(2) : value.toPrecision(3);
  return `$${Number(text)}`;
}

interface Preview {
  sheet: string;
  rows: PriceCatalogRow[];
  conflicts: CostConflict[];
  summary: {
    rows: number;
    ready: number;
    need_decision: number;
    preparations: number;
    conflicts: number;
  };
}

interface Saved {
  batch_id: string;
  saved: number;
  ingredients_created: number;
  pending_rows: number;
  preparations_left_out: number;
  conflicts_decided: number;
  conflicts_open: number;
}

interface UploadDraftView {
  filename: string;
  decisions: {
    units: Record<string, string>;
    asIngredient: Record<string, boolean>;
    conflicts: Record<string, "catalog" | number | "none">;
    reviewedUnits: boolean;
  };
  catalog_result: Record<string, unknown> | null;
  recipes_result: Record<string, unknown> | null;
  updated_at: string | null;
}

/** "Ninguna / Pendiente": every option is wrong, no price for now. */
const NONE = "none";

interface OpenConflict {
  id: string;
  name: string;
  catalog: { unit: CatalogUnit; unitCost: number };
  candidates: Array<{
    unit: CatalogUnit;
    unitCost: number;
    lines: number;
    recipes: number;
  }>;
}

async function postJson(url: string, body: unknown, fallback: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(userErrorMessage(json, fallback));
  }
  return json;
}

/**
 * "Subir Excel de costos": the one upload. Ingredients and preparations go
 * into one list; nothing uncertain blocks it (unclear units and cost
 * conflicts are asked later, on the dish that uses them). After saving,
 * `onUploaded` prepares the dishes from the same file.
 */
export interface PriceCatalogPanelHandle {
  /** Open the file picker (call it from a click handler: browsers need the gesture). */
  openPicker: () => void;
}

export const PriceCatalogPanel = forwardRef<
  PriceCatalogPanelHandle,
  {
    /** Inside Resumen's checklist (step 1): no card or heading. */
    embedded?: boolean;
    onUploaded?: () => void;
    /** After "Importar" on the recipes of the same file. */
    onRecipesImported?: () => void;
    /** Step 1 done and the file still has recipes to import: refresh, do not restart the panels. */
    onPricesSaved?: () => void;
    /** How many dishes wait for «2. Importar recetas» (null = none pending). */
    onImportPending?: (dishes: number | null) => void;
    locationId?: string | null;
    busyExternal?: boolean;
    /** The server's can("prices.edit") answer; false = read-only. */
    canEditPrices?: boolean;
  }
>(function PriceCatalogPanel(
  {
    onUploaded,
    onRecipesImported,
    onPricesSaved,
    onImportPending,
    locationId = null,
    busyExternal = false,
    embedded = false,
    canEditPrices = true,
  },
  ref
) {
  const { d, fmt, lang } = useT();
  const w = d.menu.workspace.priceCatalog;
  const NONE_LABEL = w.noneLabel;
  const UNIT_LABEL = d.menu.workspace.preparaciones.unitSingular as Record<
    CatalogUnit,
    string
  >;
  const fileRef = useRef<HTMLInputElement>(null);
  // The picked file lives server-side as a draft (with every choice), so
  // leaving the page or reloading never loses it.
  const [draftName, setDraftName] = useState<string | null>(null);
  /** Changes when a new file is picked: the recipe preview reloads. */
  const [draftToken, setDraftToken] = useState<string | null>(null);
  const [recipesImported, setRecipesImported] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  // Same rule as the «Elegir archivo de costos» button: nothing while busy
  // (a second upload must not start in the middle of a save).
  useImperativeHandle(
    ref,
    () => ({
      openPicker: () => {
        if (busy || busyExternal || !canEditPrices) return;
        fileRef.current?.click();
      },
    }),
    [busy, busyExternal, canEditPrices]
  );
  const [error, setError] = useState<string | null>(null);
  /** Row key → unit, or "none" (Ninguna: leave it Pendiente). */
  const [units, setUnits] = useState<Record<string, string>>({});
  const [asIngredient, setAsIngredient] = useState<Record<string, boolean>>({});
  const [conflictChoice, setConflictChoice] = useState<
    Record<string, "catalog" | number | "none">
  >({});
  const [reviewedUnits, setReviewedUnits] = useState(false);
  const [open, setOpen] = useState<OpenConflict[]>([]);
  /** Dishes the file's recipes hold: when > 0 they come from "Importar". */
  const [recipeDishes, setRecipeDishes] = useState(0);
  /** True once the saved choices are back; only then do edits get saved. */
  const [hydrated, setHydrated] = useState(false);

  const loadOpen = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/restaurant/recipes/price-catalog/conflicts"
      );
      if (!res.ok) return;
      const json = (await res.json()) as { conflicts?: OpenConflict[] };
      setOpen(json.conflicts ?? []);
    } catch {
      // The panel works without the list; it just won't show open items.
    }
  }, []);

  useEffect(() => {
    void loadOpen();
  }, [loadOpen]);

  const { check, ambiguous, preps, problems } = useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      check: rows.filter(
        (r) => r.kind === "ingredient" && r.status === "check_unit"
      ),
      ambiguous: rows.filter(
        (r) => r.kind === "ingredient" && r.status === "ambiguous_unit"
      ),
      // Rows under a production section (PLANTA … PRODUCCION) are the
      // kitchen's own preparations: never asked.
      preps: rows.filter(
        (r) =>
          r.kind === "preparation" && !r.reasons.includes("preparation_section")
      ),
      problems: rows.filter(
        (r) =>
          r.kind === "ingredient" &&
          (r.status === "error_cell" || r.status === "no_price")
      ),
    };
  }, [preview]);

  /** Read the price list of the saved file; keep the person's choices. */
  const previewFromDraft = useCallback(
    async (restored: Record<string, string>) => {
      const form = new FormData();
      form.append("draft", "1");
      form.append("mode", "preview");
      const res = await fetch("/api/restaurant/recipes/price-catalog", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(userErrorMessage(json, w.readFailed));
      setPreview(json);
      // Suggested units are pre-filled, unless the person already chose.
      const initial: Record<string, string> = {};
      for (const row of json.rows) {
        if (row.status === "check_unit" && row.unit)
          initial[row.key] = row.unit;
      }
      setUnits({ ...initial, ...restored });
    },
    [w.readFailed]
  );

  // Opening the page: bring back the file, the choices and what was saved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/restaurant/recipes/upload-draft");
        const json = (await res.json().catch(() => ({}))) as {
          draft?: UploadDraftView | null;
        };
        const draft = res.ok ? json.draft : null;
        if (cancelled || !draft) return;
        setDraftName(draft.filename);
        setDraftToken(draft.updated_at ?? draft.filename);
        setAsIngredient(draft.decisions.asIngredient);
        setConflictChoice(draft.decisions.conflicts);
        setReviewedUnits(draft.decisions.reviewedUnits);
        setRecipesImported(draft.recipes_result);
        if (draft.catalog_result) {
          setSaved(draft.catalog_result as unknown as Saved);
          setUnits(draft.decisions.units);
        } else {
          setBusy(true);
          await previewFromDraft(draft.decisions.units);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : w.recoverFailed);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewFromDraft]);

  /** Save the choices server-side (the draft), now. */
  const persistChoices = useCallback(async () => {
    await fetch("/api/restaurant/recipes/upload-draft", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisions: {
          units,
          asIngredient,
          conflicts: conflictChoice,
          reviewedUnits,
        },
      }),
    });
  }, [units, asIngredient, conflictChoice, reviewedUnits]);

  // Every choice is saved as the person makes it.
  useEffect(() => {
    if (!hydrated || !draftName) return;
    const timer = setTimeout(() => {
      void persistChoices().catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, draftName, persistChoices]);

  async function readFile(next: File) {
    setBusy(true);
    setError(null);
    setSaved(null);
    setPreview(null);
    setHydrated(false);
    try {
      const form = new FormData();
      form.append("file", next);
      const res = await fetch("/api/restaurant/recipes/upload-draft", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as {
        draft?: UploadDraftView | null;
        error?: string;
      };
      if (!res.ok || !json.draft) {
        throw new Error(userErrorMessage(json, w.saveFileFailed));
      }
      setDraftName(json.draft.filename);
      setDraftToken(json.draft.updated_at ?? `${Date.now()}`);
      setRecipesImported(null);
      setAsIngredient({});
      setConflictChoice({});
      setReviewedUnits(false);
      await previewFromDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : w.readFailed);
    } finally {
      setBusy(false);
      setHydrated(true);
    }
  }

  // Nothing blocks the upload: unanswered rows are asked on the dish.
  const canSave = !!draftName && !!preview && !busy && !busyExternal;
  const openDecisions =
    check.length + ambiguous.length + (preview?.conflicts.length ?? 0);

  const hasPendingPriceChoices =
    open.length > 0 ||
    (preview?.conflicts ?? []).some(
      (conflict) => conflictChoice[conflict.key] === undefined
    );

  async function save() {
    if (!draftName || !preview) return;
    setBusy(true);
    setError(null);
    try {
      // The server saves with the choices stored in the draft: flush first.
      await persistChoices();
      const form = new FormData();
      form.append("draft", "1");
      form.append("mode", "apply");
      const res = await fetch("/api/restaurant/recipes/price-catalog", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as Saved & { error?: string };
      if (!res.ok) throw new Error(userErrorMessage(json, w.saveListFailed));
      setSaved(json);
      setPreview(null);
      void loadOpen();
      // The file has its own recipes: they come in with "Importar" below,
      // so no AI suggestions (they would only add drafts and questions).
      if (recipeDishes > 0 && !recipesImported) {
        // Step 2 is next: refresh the page data but keep this panel (and its
        // recipes table) as it is, and bring the import button into view.
        onPricesSaved?.();
        setTimeout(() => {
          const button = document.getElementById(IMPORT_RECIPES_BUTTON_ID);
          button?.scrollIntoView({ behavior: "smooth", block: "center" });
          button?.focus({ preventScroll: true });
        }, 100);
      } else if (recipesImported) onRecipesImported?.();
      else onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : w.saveListFailed);
    } finally {
      setBusy(false);
    }
  }

  async function undo(batchId: string) {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/restaurant/costs/batches/${batchId}/undo`,
        {},
        w.undoFailed
      );
      setSaved(null);
      void loadOpen();
      // The file and its choices are still there: show the preview again.
      await fetch("/api/restaurant/recipes/upload-draft", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog_result: null }),
      });
      if (draftName) await previewFromDraft(units);
    } catch (err) {
      setError(err instanceof Error ? err.message : w.undoFailed);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, choice: "catalog" | number | "none") {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/restaurant/recipes/price-catalog/conflicts/${id}`,
        { choice },
        w.decisionFailed
      );
      await loadOpen();
    } catch (err) {
      setError(err instanceof Error ? err.message : w.decisionFailed);
    } finally {
      setBusy(false);
    }
  }

  // Tell the checklist when «2. Importar recetas» is the next step.
  const importPendingRef = useRef(onImportPending);
  useEffect(() => {
    importPendingRef.current = onImportPending;
  }, [onImportPending]);
  const pendingDishes = !preview && recipeDishes > 0 ? recipeDishes : null;
  useEffect(() => {
    importPendingRef.current?.(pendingDishes);
  }, [pendingDishes]);

  const Wrapper = embedded ? "div" : Card;
  return (
    <Wrapper className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {embedded ? null : (
          <h2 className="text-[15px] font-semibold">{w.title}</h2>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) void readFile(next);
            event.target.value = "";
          }}
        />
        <GhostBtn
          className="ml-auto border-[#1B40C8] px-3 py-1.5 text-[13px] text-[#1B40C8] hover:bg-[#f6f8fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
          disabled={busy || busyExternal || !canEditPrices}
          onClick={() => fileRef.current?.click()}
        >
          {preview || saved ? w.pickOther : w.pickFile}
        </GhostBtn>
      </div>

      {canEditPrices ? null : (
        <p data-testid="prices-readonly" className="text-[12px] text-[#6b7280]">
          {CAPABILITY_MESSAGES["prices.edit"]}
        </p>
      )}

      {draftName ? (
        <p className="text-[12px] text-[#6b7385]">
          {fmt(w.file, { name: draftName })}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]">
          {error}
        </div>
      ) : null}

      {busy && !preview ? (
        <p className="text-xs text-[#5b6476]">{w.readingFile}</p>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Chip tone="ok">
              {fmt(w.chipReady, { n: preview.summary.ready })}
            </Chip>
            {check.length + ambiguous.length > 0 ? (
              <Chip tone="warn">
                {fmt(w.chipToConfirm, { n: check.length + ambiguous.length })}
              </Chip>
            ) : null}
            {preview.summary.preparations > 0 ? (
              <Chip tone="pur">
                {fmt(w.chipPreparations, { n: preview.summary.preparations })}
              </Chip>
            ) : null}
            {preview.summary.conflicts > 0 ? (
              <Chip tone="sug">
                {fmt(w.chipTwoCosts, { n: preview.summary.conflicts })}
              </Chip>
            ) : null}
            {problems.length > 0 ? (
              <Chip tone="bad">
                {fmt(w.chipNoPrice, { n: problems.length })}
              </Chip>
            ) : null}
          </div>

          {openDecisions + preps.length > 0 ? (
            <details className="rounded-lg border border-slate-200 px-2.5 py-1.5">
              <summary className="cursor-pointer text-[12.5px] font-semibold">
                {w.decideNow}
              </summary>
              <div className="mt-2 space-y-3">
                {ambiguous.length > 0 ? (
                  <section className="space-y-1.5">
                    <h3 className="text-[12.5px] font-semibold">
                      {w.whichUnit}
                    </h3>
                    {ambiguous.map((row) => (
                      <div
                        key={row.key}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                      >
                        <span className="min-w-40 font-semibold">
                          {row.name}
                        </span>
                        {row.options.map((option) => (
                          <label
                            key={option.unit}
                            className="inline-flex items-center gap-1"
                          >
                            <input
                              type="radio"
                              name={row.key}
                              checked={units[row.key] === option.unit}
                              onChange={() =>
                                setUnits((prev) => ({
                                  ...prev,
                                  [row.key]: option.unit,
                                }))
                              }
                            />
                            {fmt(w.perUnit, {
                              cost: money(option.unitCost),
                              unit: UNIT_LABEL[option.unit],
                            })}
                          </label>
                        ))}
                        <label className="inline-flex items-center gap-1 text-[#8a92a3]">
                          <input
                            type="radio"
                            name={row.key}
                            checked={units[row.key] === NONE}
                            onChange={() =>
                              setUnits((prev) => ({ ...prev, [row.key]: NONE }))
                            }
                          />
                          {NONE_LABEL}
                        </label>
                      </div>
                    ))}
                  </section>
                ) : null}

                {check.length > 0 ? (
                  <section className="space-y-1.5">
                    <h3 className="text-[12.5px] font-semibold">
                      {w.reviewUnits}
                    </h3>
                    <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                      {check.map((row) => (
                        <div
                          key={row.key}
                          className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2.5 py-1 text-xs last:border-b-0"
                        >
                          <span className="min-w-40 font-semibold">
                            {row.name}
                          </span>
                          <span className="text-[#8a92a3]">
                            {row.packagePrice !== null && row.divisor !== null
                              ? `${money(row.packagePrice)} ÷ ${Number(row.divisor.toFixed(1))}`
                              : ""}
                          </span>
                          {row.options.map((option) => (
                            <label
                              key={option.unit}
                              className="inline-flex items-center gap-1"
                            >
                              <input
                                type="radio"
                                name={row.key}
                                checked={units[row.key] === option.unit}
                                onChange={() =>
                                  setUnits((prev) => ({
                                    ...prev,
                                    [row.key]: option.unit,
                                  }))
                                }
                              />
                              {fmt(w.perUnit, {
                                cost: money(option.unitCost),
                                unit: UNIT_LABEL[option.unit],
                              })}
                            </label>
                          ))}
                          <label className="inline-flex items-center gap-1 text-[#8a92a3]">
                            <input
                              type="radio"
                              name={row.key}
                              checked={units[row.key] === NONE}
                              onChange={() =>
                                setUnits((prev) => ({
                                  ...prev,
                                  [row.key]: NONE,
                                }))
                              }
                            />
                            {NONE_LABEL}
                          </label>
                        </div>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={reviewedUnits}
                        onChange={(event) =>
                          setReviewedUnits(event.target.checked)
                        }
                      />
                      {w.reviewedUnits}
                    </label>
                  </section>
                ) : null}

                {preview.conflicts.length > 0 ? (
                  <section className="space-y-1.5">
                    <h3 className="text-[12.5px] font-semibold">
                      {w.twoCosts}
                    </h3>
                    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                      {preview.conflicts.map((conflict) => (
                        <div
                          key={conflict.key}
                          className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-2.5 py-1.5 text-xs last:border-b-0"
                        >
                          <span className="min-w-40 font-semibold">
                            {conflict.name}
                          </span>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name={`c-${conflict.key}`}
                              checked={
                                conflictChoice[conflict.key] === "catalog"
                              }
                              onChange={() =>
                                setConflictChoice((prev) => ({
                                  ...prev,
                                  [conflict.key]: "catalog",
                                }))
                              }
                            />
                            {fmt(w.listCost, {
                              cost: money(conflict.catalog.unitCost),
                              unit: UNIT_LABEL[conflict.catalog.unit],
                            })}
                          </label>
                          {conflict.candidates.map((candidate, index) => (
                            <label
                              key={index}
                              className="inline-flex items-center gap-1"
                            >
                              <input
                                type="radio"
                                name={`c-${conflict.key}`}
                                checked={conflictChoice[conflict.key] === index}
                                onChange={() =>
                                  setConflictChoice((prev) => ({
                                    ...prev,
                                    [conflict.key]: index,
                                  }))
                                }
                              />
                              {fmt(
                                candidate.recipes === 1
                                  ? w.recipesCostOne
                                  : w.recipesCostOther,
                                {
                                  cost: money(candidate.unitCost),
                                  unit: UNIT_LABEL[candidate.unit],
                                  n: candidate.recipes,
                                }
                              )}
                            </label>
                          ))}
                          <label className="inline-flex items-center gap-1 text-[#8a92a3]">
                            <input
                              type="radio"
                              name={`c-${conflict.key}`}
                              checked={conflictChoice[conflict.key] === NONE}
                              onChange={() =>
                                setConflictChoice((prev) => ({
                                  ...prev,
                                  [conflict.key]: NONE,
                                }))
                              }
                            />
                            {NONE_LABEL}
                          </label>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {preps.length > 0 ? (
                  <section className="space-y-1.5">
                    <h3 className="text-[12.5px] font-semibold">
                      {w.lookLikePreps}
                    </h3>
                    <div className="max-h-40 overflow-auto rounded-lg border border-slate-200">
                      {preps.map((row) => (
                        <label
                          key={row.key}
                          className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1 text-xs last:border-b-0"
                        >
                          <span className="min-w-40 font-semibold">
                            {row.name}
                          </span>
                          <span className="text-[#4b5466]">
                            {w.boughtReady}
                          </span>
                          <input
                            type="checkbox"
                            aria-label={fmt(w.boughtReadyAria, {
                              name: row.name,
                            })}
                            checked={asIngredient[row.key] === true}
                            onChange={(event) =>
                              setAsIngredient((prev) => ({
                                ...prev,
                                [row.key]: event.target.checked,
                              }))
                            }
                          />
                          {asIngredient[row.key] ? w.yesBought : w.noPrepared}
                          {row.unitCost !== null && row.unit ? (
                            <span className="text-[#8a92a3]">
                              {money(row.unitCost)}/{UNIT_LABEL[row.unit]}
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </details>
          ) : null}

          {problems.length > 0 ? (
            <p className="text-[12px] text-[#6b7280]">
              {fmt(w.rowsNoPrice, { n: problems.length })}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <PrimaryBtn disabled={!canSave} onClick={() => void save()}>
              {w.savePrices}
            </PrimaryBtn>
            {openDecisions > 0 ? (
              <span className="text-[12px] text-[#8a92a3]">
                {fmt(w.toDecide, { n: openDecisions })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {saved ? (
        <div className="rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-xs text-[#1f7a45]">
          {fmt(w.savedPrices, { n: saved.saved })}
          {saved.ingredients_created > 0
            ? fmt(w.savedNewIngredients, { n: saved.ingredients_created })
            : ""}
          .
          {saved.pending_rows > 0
            ? fmt(w.savedPending, { n: saved.pending_rows })
            : ""}
          {saved.conflicts_open > 0
            ? fmt(w.savedOpen, { n: saved.conflicts_open })
            : ""}{" "}
          <button
            type="button"
            className="font-semibold underline"
            disabled={busy || !canEditPrices}
            onClick={() => void undo(saved.batch_id)}
          >
            {w.undoUpload}
          </button>
        </div>
      ) : null}

      <RecipeImportPreview
        draftToken={draftToken}
        initialImported={recipesImported}
        locationId={locationId}
        busyExternal={busy || busyExternal}
        canEditPrices={canEditPrices}
        onImported={() => onRecipesImported?.()}
        onDishes={setRecipeDishes}
        primary={!preview}
        hasPendingPriceChoices={hasPendingPriceChoices}
      />

      {open.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="text-[12.5px] font-semibold">
            {fmt(w.costsToDecide, { n: open.length })}
          </h3>
          <p className="text-[12px] text-[#6b7280]">
            {pendingPriceChoicesNote(lang)}
          </p>
          <div className="rounded-lg border border-slate-200">
            {open.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-xs last:border-b-0"
              >
                <span className="min-w-40 font-semibold">{item.name}</span>
                <GhostBtn
                  disabled={busy || !canEditPrices}
                  onClick={() => void resolve(item.id, "catalog")}
                >
                  {fmt(w.useList, {
                    cost: money(item.catalog.unitCost),
                    unit: UNIT_LABEL[item.catalog.unit],
                  })}
                </GhostBtn>
                {item.candidates.map((candidate, index) => (
                  <GhostBtn
                    key={index}
                    disabled={busy || !canEditPrices}
                    onClick={() => void resolve(item.id, index)}
                  >
                    {fmt(
                      candidate.recipes === 1
                        ? w.useRecipesOne
                        : w.useRecipesOther,
                      {
                        cost: money(candidate.unitCost),
                        unit: UNIT_LABEL[candidate.unit],
                        n: candidate.recipes,
                      }
                    )}
                  </GhostBtn>
                ))}
                <GhostBtn
                  disabled={busy || !canEditPrices}
                  onClick={() => void resolve(item.id, NONE)}
                >
                  {NONE_LABEL}
                </GhostBtn>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Wrapper>
  );
});
