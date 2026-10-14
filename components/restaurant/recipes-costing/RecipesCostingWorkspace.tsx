"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  RecipeCostingView,
  RecipeCostingWorkspace,
} from "@/lib/restaurant/recipe-costing/workspace";
import { ConfirmHowDialog } from "./ConfirmHowDialog";
import { CostingHeader } from "./CostingHeader";
import { MenuCosteadoScreen } from "./MenuCosteadoScreen";
import { PlatoScreen } from "./PlatoScreen";
import { PreparacionesScreen } from "./PreparacionesScreen";
import { ResumenScreen } from "./ResumenScreen";

/** Dishes per request when generating suggestions. */
const SUGGESTION_CHUNK = 5;

function viewFromParam(
  value: string | null,
  fallback: RecipeCostingView
): RecipeCostingView {
  // Vincular and Validar are one screen now; old links land on it.
  if (value === "plato" || value === "vincular" || value === "validar") {
    return "plato";
  }
  if (
    value === "preparaciones" ||
    value === "menu-costeado" ||
    value === "resumen"
  ) {
    return value;
  }
  return fallback;
}

export function RecipesCostingWorkspace({
  initial,
}: {
  initial: RecipeCostingWorkspace;
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
  // Tab and dish switches re-render on the server; mark them as a
  // transition so the screen shows it is loading right away.
  const [navigating, startNavigation] = useTransition();

  const view = viewFromParam(searchParams.get("vista"), data.view);
  const selectedId = searchParams.get("producto")
    ? Number(searchParams.get("producto"))
    : (data.selected?.odoo_product_id ?? null);

  const replaceParams = useCallback(
    (next: { vista?: RecipeCostingView; producto?: number | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.vista) params.set("vista", next.vista);
      if (next.producto != null) params.set("producto", String(next.producto));
      else if (next.producto === null) params.delete("producto");
      startNavigation(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams]
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
      const queueRow = json.plato_queue[0];
      return {
        ...prev,
        editor,
        selected,
        plato_queue: queueRow
          ? prev.plato_queue.map((row) =>
              row.odoo_product_id === queueRow.odoo_product_id
                ? { ...queueRow, share_label: row.share_label }
                : row
            )
          : prev.plato_queue,
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
    const params = new URLSearchParams(searchParams.toString());
    params.set("vista", "preparaciones");
    if (componentId) params.set("prep", componentId);
    else params.delete("prep");
    // Opened from a dish: Preparaciones offers the way back to it.
    if (opts.fromDish) params.set("desde", "plato");
    else if (!componentId) params.delete("desde");
    startNavigation(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function open(next: RecipeCostingView, odooProductId?: number) {
    replaceParams({ vista: next, producto: odooProductId ?? selectedId });
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

  function goTo(odooProductId: number | null | undefined) {
    if (odooProductId)
      replaceParams({ vista: "plato", producto: odooProductId });
  }

  /** "Aprobar y siguiente" / "Enviar a aprobación y siguiente": the POS link
   *  and the recipe version are saved as two separate steps on the server. */
  async function confirmDish(how?: string) {
    const editor = data.editor;
    if (!editor) return;
    if (data.actor.needs_client_confirmation && !how) {
      setHowOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post("/api/restaurant/recipes/plato/confirm", {
        odoo_product_id: editor.odoo_product_id,
        odoo_name: editor.odoo_name,
        recipe_version_id: editor.recipe_version_id,
        location_id: searchParams.get("location") ?? undefined,
        confirmed_how: how ?? "en_pantalla",
        yield_confirmed: editor.checklist.yield_confirmed,
      });
      // Recompute the queue and coverage, then open the next dish to do.
      const json = await fetchWorkspace();
      setData(json);
      goTo(json.editor?.next_odoo_product_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo falló.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
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
    <div className="w-full px-[22px] pb-10 pt-2">
      <CostingHeader
        view={view}
        breadcrumbExtra={
          view === "plato" ? <span> · {data.plato_progress.label}</span> : null
        }
      />

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
            onSelect={(id) => replaceParams({ vista: "plato", producto: id })}
            onEdited={scheduleReloadDish}
            onPost={postAndReload}
            onConfirm={() => void confirmDish()}
            onSkip={() => goTo(data.editor?.next_odoo_product_id)}
            onOpenPreparation={(id) => openPreparation(id, { fromDish: true })}
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
                ? () => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("vista", "plato");
                    params.delete("prep");
                    params.delete("desde");
                    startNavigation(() => {
                      router.replace(`${pathname}?${params.toString()}`, {
                        scroll: false,
                      });
                    });
                  }
                : undefined
            }
            onChanged={() => void mutate(async () => undefined)}
            locationId={searchParams.get("location")}
          />
        ) : view === "menu-costeado" ? (
          <MenuCosteadoScreen data={data} onOpen={open} />
        ) : (
          <ResumenScreen
            data={data}
            onOpen={open}
            onUploaded={() => void runSuggestions()}
            generateBusy={workbookBusy}
            busy={busy}
            onPost={postAndReload}
            locationId={searchParams.get("location")}
            onResetDone={() => void reload().catch(() => undefined)}
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

      <div className="mt-6 flex items-center justify-between text-[10.5px] text-[#6b7385]">
        <span>
          {data.footer.startsWith("Base:") ? (
            <>
              <b className="text-[#1b2333]">Base:</b>{" "}
              {data.footer.replace("Base: ", "")}
            </>
          ) : (
            data.footer
          )}
        </span>
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
