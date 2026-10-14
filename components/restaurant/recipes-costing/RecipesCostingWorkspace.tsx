"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MENU_TAB_PATHS,
  type MenuTab,
} from "@/lib/restaurant/recetas-redirect";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  markApproved,
  nextToReview,
  summaryFromEditorState,
  withDishSummary,
} from "@/lib/restaurant/recipe-costing/optimistic";
import { ConfirmHowDialog } from "./ConfirmHowDialog";
import { PlatoScreen } from "./PlatoScreen";
import { PreparacionesScreen } from "./PreparacionesScreen";
import { ResumenScreen } from "./ResumenScreen";

/** Dishes per request when generating suggestions. */
const SUGGESTION_CHUNK = 5;

type WorkspaceTab = "resumen" | "plato" | "preparaciones";

const TAB_OF_VIEW: Record<WorkspaceTab, MenuTab> = {
  resumen: "resumen",
  plato: "platos",
  preparaciones: "preparaciones",
};

/** Params that ride along between Menú tabs (restaurant and period). */
const SHELL_PARAMS = ["location", "from", "to"] as const;

/**
 * Menú › Resumen, Platos and Preparaciones (R1-09b): each tab is a route
 * and passes its `view`; moving between tabs is a navigation to that
 * route, choosing a dish or preparation only changes its own param.
 */
export function RecipesCostingWorkspace({
  initial,
  view,
}: {
  initial: RecipeCostingWorkspace;
  view: WorkspaceTab;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [workbookBusy, setWorkbookBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  // Tab and dish switches re-render on the server; mark them as a
  // transition so the screen shows it is loading right away.
  const [navigating, startNavigation] = useTransition();

  const selectedId = searchParams.get("producto")
    ? Number(searchParams.get("producto"))
    : (data.selected?.odoo_product_id ?? null);

  /** Open another Menú tab, keeping restaurant and period. */
  const goToTab = useCallback(
    (tab: WorkspaceTab, extra: Record<string, string | null> = {}) => {
      const params = new URLSearchParams();
      for (const key of SHELL_PARAMS) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
      }
      const query = params.toString();
      const path = MENU_TAB_PATHS[TAB_OF_VIEW[tab]];
      startNavigation(() => {
        router.push(query ? `${path}?${query}` : path, { scroll: false });
      });
    },
    [router, searchParams]
  );

  const fetchWorkspace = useCallback(
    async (opts: { productId?: number | null; editorOnly?: boolean } = {}) => {
      const params = new URLSearchParams();
      params.set("vista", view);
      const productId =
        opts.productId !== undefined ? opts.productId : selectedId;
      if (productId) params.set("odoo_product_id", String(productId));
      const location = searchParams.get("location");
      if (location) params.set("location_id", location);
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (from && to) {
        params.set("start_date", from);
        params.set("end_date", to);
      }
      if (opts.editorOnly) params.set("editor_only", "1");
      const res = await fetch(
        `/api/restaurant/recipes/costing?${params.toString()}`
      );
      if (!res.ok) throw new Error("No pude recargar el avance.");
      return (await res.json()) as RecipeCostingWorkspace;
    },
    [searchParams, selectedId, view]
  );

  const reload = useCallback(async () => {
    setData(await fetchWorkspace());
  }, [fetchWorkspace]);

  /** After an ingredient edit: refresh only the open dish (no sales scan);
   *  the list, shares and coverage stay as last loaded. */
  const reloadDish = useCallback(async () => {
    if (!selectedId) return reload();
    const json = await fetchWorkspace({ editorOnly: true });
    setData((prev) => {
      const sameDish =
        prev.editor?.odoo_product_id === json.editor?.odoo_product_id;
      const editor =
        json.editor && sameDish && prev.editor
          ? {
              ...json.editor,
              share_label: prev.editor.share_label,
              review_index: prev.editor.review_index,
              review_total: prev.editor.review_total,
              next_odoo_product_id: prev.editor.next_odoo_product_id,
            }
          : json.editor;
      const fresh = json.selected;
      const selected =
        fresh && prev.selected?.odoo_product_id === fresh.odoo_product_id
          ? {
              ...fresh,
              share_pct: prev.selected.share_pct,
              share_label: prev.selected.share_label,
              net_sales: prev.selected.net_sales,
              net_sales_label: prev.selected.net_sales_label,
            }
          : fresh;
      return {
        ...prev,
        editor,
        selected,
        // The chip follows the editor live (onEditorState); the one-dish
        // reload only refreshes the editor view (checklist, version).
      };
    });
  }, [fetchWorkspace, reload, selectedId]);

  useEffect(() => {
    setData(initial);
  }, [initial]);

  // After an edit the line is already on screen (the editor shows the
  // server's answer); the dish summary catches up once, after a burst of
  // edits, instead of one full reload per save.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReloadDish = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void reloadDish().catch(() => undefined);
    }, 600);
  }, [reloadDish]);
  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    []
  );

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  function openPreparation(
    componentId: string | null,
    opts: { fromDish?: boolean } = {}
  ) {
    // Opened from a dish: Preparaciones offers the way back to it.
    const extra = {
      prep: componentId,
      desde: opts.fromDish ? "plato" : null,
      producto: opts.fromDish && selectedId ? String(selectedId) : null,
    };
    if (view === "preparaciones") {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      startNavigation(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
      return;
    }
    goToTab("preparaciones", extra);
  }

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "No pude guardar.");
  }

  const postAndReload = (url: string, body: Record<string, unknown>) =>
    void mutate(() => post(url, body));

  /**
   * R1-09c: choosing a dish happens in the browser. The list already has
   * its numbers (dish_summaries); the URL follows with replaceState and
   * only the dish's editor view is fetched, in the background.
   */
  const selectDish = useCallback(
    (id: number) => {
      setData((prev) => ({
        ...prev,
        selected:
          prev.products.find((p) => p.odoo_product_id === id) ?? prev.selected,
        editor: prev.editor?.odoo_product_id === id ? prev.editor : null,
        selected_dish:
          prev.dish_summaries?.find((d) => d.odoo_product_id === id) ??
          (prev.selected_dish?.odoo_product_id === id
            ? prev.selected_dish
            : null),
      }));
      const params = new URLSearchParams(window.location.search);
      params.set("producto", String(id));
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
      void fetchWorkspace({ productId: id, editorOnly: true })
        .then((json) =>
          setData((prev) =>
            prev.selected?.odoo_product_id !== id
              ? prev
              : {
                  ...prev,
                  // The one-dish load knows only this dish's sales: keep
                  // the shares and position from the full list.
                  editor: json.editor
                    ? {
                        ...json.editor,
                        share_label:
                          prev.selected?.share_label ?? json.editor.share_label,
                      }
                    : null,
                  selected: json.selected
                    ? {
                        ...json.selected,
                        share_pct: prev.selected.share_pct,
                        share_label: prev.selected.share_label,
                        net_sales: prev.selected.net_sales,
                        net_sales_label: prev.selected.net_sales_label,
                      }
                    : prev.selected,
                }
          )
        )
        .catch(() => setError("No pude abrir ese plato. Intenta otra vez."));
    },
    [fetchWorkspace, pathname]
  );

  /** After each line edit: the dish's cost, chip and margin follow the
   *  editor's own total at once (no server reload of the list). */
  const onEditorState = useCallback((state: EditorState) => {
    setData((prev) => {
      const current = prev.selected_dish;
      if (!current) return prev;
      return withDishSummary(prev, summaryFromEditorState(current, state));
    });
  }, []);

  /** "Aprobar y siguiente" / "Enviar a aprobación y siguiente": the POS link
   *  and the recipe version are saved as two separate steps on the server. */
  async function confirmDish(how?: string) {
    const editor = data.editor;
    if (!editor) return;
    if (data.actor.needs_client_confirmation && !how) {
      setHowOpen(true);
      return;
    }
    // R1-09c: approve locally and open the next dish at once; the save
    // runs in the background and rolls back on an error.
    const id = editor.odoo_product_id;
    const before = data;
    const next = nextToReview(data.plato_queue, id);
    setError(null);
    if (data.actor.can_approve) setData((prev) => markApproved(prev, id));
    if (next) selectDish(next);
    try {
      await post("/api/restaurant/recipes/plato/confirm", {
        odoo_product_id: editor.odoo_product_id,
        odoo_name: editor.odoo_name,
        recipe_version_id: editor.recipe_version_id,
        location_id: searchParams.get("location") ?? undefined,
        confirmed_how: how ?? "en_pantalla",
        yield_confirmed: editor.checklist.yield_confirmed,
      });
    } catch (err) {
      setData(before);
      selectDish(id);
      setError(
        `${editor.odoo_name}: ${err instanceof Error ? err.message : "no se pudo aprobar."}`
      );
    }
  }

  /**
   * Generate suggestions a few dishes at a time (top sellers first), so no
   * single request runs long and one failure never loses earlier work.
   */
  async function runSuggestions() {
    const url = "/api/restaurant/recipes/suggestions";
    setWorkbookBusy(true);
    setError(null);
    setNotice(null);
    const totals = { suggested: 0, sinSugerencia: 0, skipped: 0 };
    let offset = 0;
    let total: number | null = null;
    try {
      for (let guard = 0; guard < 40; guard++) {
        setProgress({ done: offset, total });
        // The recipes come from the file just uploaded (kept with it).
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "latest_upload",
            limit: SUGGESTION_CHUNK,
            offset,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          suggested?: number;
          sin_sugerencia?: number;
          skipped?: number;
          total?: number;
          next_offset?: number | null;
        };
        if (!res.ok) {
          throw new Error(
            json.error ?? "No pude preparar tus platos desde el archivo."
          );
        }
        totals.suggested += json.suggested ?? 0;
        totals.sinSugerencia += json.sin_sugerencia ?? 0;
        totals.skipped += json.skipped ?? 0;
        total = json.total ?? total;
        if (json.next_offset == null) break;
        offset = json.next_offset;
      }
      setNotice(
        `Listo: ${totals.suggested} ${totals.suggested === 1 ? "plato preparado" : "platos preparados"} desde tu archivo` +
          `, ${totals.sinSugerencia} sin sugerencia` +
          (totals.skipped > 0
            ? `, ${totals.skipped} ya resueltos o con receta propia.`
            : ".")
      );
      await reload();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No pude preparar tus platos desde el archivo.";
      setError(
        totals.suggested > 0
          ? `${message} Lo que ya se generó (${totals.suggested} platos) quedó guardado.`
          : message
      );
      await reload().catch(() => undefined);
    } finally {
      setWorkbookBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="w-full">
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {progress ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          Preparando tus platos desde el archivo…{" "}
          {progress.total
            ? `${Math.min(progress.done, progress.total)} de ${progress.total} platos (los que más venden primero)`
            : "empezando por los platos que más venden"}
        </div>
      ) : notice ? (
        <div className="mb-3 rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-sm text-[#1f7a45]">
          {notice}
        </div>
      ) : null}

      {navigating ? (
        <div
          role="status"
          className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
        >
          Cargando…
        </div>
      ) : null}
      <div
        aria-busy={navigating}
        className={navigating ? "pointer-events-none opacity-60" : undefined}
      >
        {view === "plato" ? (
          <PlatoScreen
            data={data}
            locationId={searchParams.get("location")}
            busy={busy}
            onSelect={selectDish}
            onEditorState={onEditorState}
            onEdited={scheduleReloadDish}
            onPost={postAndReload}
            onConfirm={() => void confirmDish()}
            onOpenPreparation={(id) => openPreparation(id, { fromDish: true })}
            statusFilter={(searchParams.get("estado") ?? "")
              .split(",")
              .filter(Boolean)}
            onFilter={(filter) => {
              // A list filter is client state: no server round trip.
              const params = new URLSearchParams(searchParams.toString());
              if (filter) params.set("estado", filter);
              else params.delete("estado");
              const query = params.toString();
              window.history.replaceState(
                null,
                "",
                query ? `${pathname}?${query}` : pathname
              );
            }}
          />
        ) : view === "preparaciones" ? (
          <PreparacionesScreen
            data={data}
            selectedId={searchParams.get("prep")}
            onSelect={(id) =>
              openPreparation(id, {
                fromDish: searchParams.get("desde") === "plato",
              })
            }
            onBackToDish={
              searchParams.get("desde") === "plato" && selectedId
                ? () => goToTab("plato", { producto: String(selectedId) })
                : undefined
            }
            onChanged={() => void mutate(async () => undefined)}
            locationId={searchParams.get("location")}
          />
        ) : (
          <ResumenScreen
            data={data}
            epoch={epoch}
            onUploaded={() => void runSuggestions()}
            generateBusy={workbookBusy}
            locationId={searchParams.get("location")}
            onResetDone={() => {
              // "Empezar de nuevo" / an import: every panel starts over
              // (upload drafts remount) and the server parts refresh.
              setEpoch((n) => n + 1);
              void reload().catch(() => undefined);
              router.refresh();
            }}
            onUndoBatch={(batchIds) =>
              void mutate(async () => {
                // Newest first, so a newer batch never blocks an older one.
                for (const batchId of batchIds) {
                  const res = await fetch(
                    `/api/restaurant/costs/batches/${batchId}/undo`,
                    { method: "POST" }
                  );
                  const json = (await res.json()) as { error?: string };
                  if (!res.ok)
                    throw new Error(json.error ?? "No pude deshacer el lote.");
                }
              })
            }
          />
        )}
      </div>

      <ConfirmHowDialog
        open={howOpen}
        title="Aprobar en nombre del cliente"
        onCancel={() => setHowOpen(false)}
        onConfirm={(how) => {
          setHowOpen(false);
          void confirmDish(how);
        }}
      />
    </div>
  );
}
