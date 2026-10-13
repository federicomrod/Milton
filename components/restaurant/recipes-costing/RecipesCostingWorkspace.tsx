"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  RecipeCostingView,
  RecipeCostingWorkspace,
  VincularProductRow,
} from "@/lib/restaurant/recipe-costing/workspace";
import { ConfirmHowDialog } from "./ConfirmHowDialog";
import { CostingHeader } from "./CostingHeader";
import { MenuCosteadoScreen } from "./MenuCosteadoScreen";
import { PreparacionesScreen } from "./PreparacionesScreen";
import { ResumenScreen } from "./ResumenScreen";
import { ValidarScreen } from "./ValidarScreen";
import { VincularScreen } from "./VincularScreen";
import { PrimaryBtn } from "./ui";

/** Dishes per request when generating suggestions. */
const SUGGESTION_CHUNK = 5;

function viewFromParam(
  value: string | null,
  fallback: RecipeCostingView
): RecipeCostingView {
  if (
    value === "vincular" ||
    value === "validar" ||
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
  const [howOpen, setHowOpen] = useState<{
    kind: "confirm" | "approve";
    product?: VincularProductRow;
  } | null>(null);
  const [workbookBusy, setWorkbookBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const reload = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("vista", view);
    if (selectedId) params.set("odoo_product_id", String(selectedId));
    const location = searchParams.get("location");
    if (location) params.set("location_id", location);
    const res = await fetch(
      `/api/restaurant/recipes/costing?${params.toString()}`
    );
    if (!res.ok) throw new Error("No pude recargar el avance.");
    const json = (await res.json()) as RecipeCostingWorkspace;
    setData(json);
  }, [searchParams, selectedId, view]);

  useEffect(() => {
    setData(initial);
  }, [initial]);

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

  function openPreparation(componentId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("vista", "preparaciones");
    if (componentId) params.set("prep", componentId);
    else params.delete("prep");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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

  async function confirmProduct(product: VincularProductRow, how?: string) {
    if (data.actor.needs_client_confirmation && !how) {
      setHowOpen({ kind: "confirm", product });
      return;
    }
    await mutate(() =>
      post("/api/restaurant/pos/links/confirm", {
        odoo_product_id: product.odoo_product_id,
        odoo_name: product.odoo_name,
        menu_item_id: product.menu_item_id,
        confirmed_how: how ?? "en_pantalla",
      })
    );
  }

  /**
   * Generate suggestions a few dishes at a time (top sellers first), so no
   * single request runs long and one failure never loses earlier work.
   */
  async function runSuggestions(file?: File) {
    const url = "/api/restaurant/recipes/suggestions";
    setWorkbookBusy(true);
    setError(null);
    setNotice(null);
    const totals = { suggested: 0, sinSugerencia: 0, skipped: 0 };
    let offset = 0;
    let total: number | null = null;
    let pendingFile = file;
    try {
      for (let guard = 0; guard < 40; guard++) {
        setProgress({ done: offset, total });
        let res: Response;
        if (pendingFile) {
          const form = new FormData();
          form.set("file", pendingFile);
          form.set("limit", String(SUGGESTION_CHUNK));
          form.set("offset", String(offset));
          res = await fetch(url, { method: "POST", body: form });
          pendingFile = undefined;
        } else {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "latest_upload",
              limit: SUGGESTION_CHUNK,
              offset,
            }),
          });
        }
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          suggested?: number;
          sin_sugerencia?: number;
          skipped?: number;
          total?: number;
          next_offset?: number | null;
        };
        if (!res.ok) {
          throw new Error(json.error ?? "No pude generar las sugerencias.");
        }
        totals.suggested += json.suggested ?? 0;
        totals.sinSugerencia += json.sin_sugerencia ?? 0;
        totals.skipped += json.skipped ?? 0;
        total = json.total ?? total;
        if (json.next_offset == null) break;
        offset = json.next_offset;
      }
      setNotice(
        `Listo: ${totals.suggested} ${totals.suggested === 1 ? "plato sugerido" : "platos sugeridos"}` +
          `, ${totals.sinSugerencia} sin sugerencia` +
          (totals.skipped > 0
            ? `, ${totals.skipped} ya resueltos o con receta propia.`
            : ".")
      );
      await reload();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No pude generar las sugerencias.";
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
          view === "validar" &&
          data.editor?.review_index &&
          data.editor.review_total ? (
            <span>
              {" "}
              · plato {data.editor.review_index} de {data.editor.review_total}{" "}
              por revisar
              {data.editor.next_odoo_product_id ? (
                <button
                  type="button"
                  className="ml-2 font-semibold text-[#3557c9]"
                  onClick={() =>
                    replaceParams({
                      vista: "validar",
                      producto: data.editor!.next_odoo_product_id,
                    })
                  }
                >
                  Siguiente →
                </button>
              ) : null}
            </span>
          ) : null
        }
      />

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {progress ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          Generando sugerencias…{" "}
          {progress.total
            ? `${Math.min(progress.done, progress.total)} de ${progress.total} platos (los que más venden primero)`
            : "empezando por los platos que más venden"}
        </div>
      ) : notice ? (
        <div className="mb-3 rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-sm text-[#1f7a45]">
          {notice}
        </div>
      ) : null}

      {view === "vincular" ? (
        <VincularScreen
          data={data}
          selectedId={selectedId}
          onSelect={(id) => replaceParams({ vista: "vincular", producto: id })}
          onConfirm={(product) => void confirmProduct(product)}
          onGenerateSuggestions={() => void runSuggestions()}
          generateBusy={workbookBusy}
          onChange={(product, menuItemId) =>
            void mutate(() =>
              post("/api/restaurant/pos/links/change", {
                odoo_product_id: product.odoo_product_id,
                odoo_name: product.odoo_name,
                menu_item_id: menuItemId,
              })
            )
          }
          onCreate={(product) =>
            void mutate(() =>
              post("/api/restaurant/pos/links/create", {
                odoo_product_id: product.odoo_product_id,
                odoo_name: product.odoo_name,
              })
            )
          }
          onUndo={(product) =>
            void mutate(() =>
              post("/api/restaurant/pos/links/undo", {
                odoo_product_id: product.odoo_product_id,
              })
            )
          }
          onShare={(target, menuItemId) =>
            void mutate(() =>
              post("/api/restaurant/pos/links/change", {
                odoo_product_id: target.odoo_product_id,
                odoo_name: target.odoo_name,
                menu_item_id: menuItemId,
              })
            )
          }
          busy={busy}
        />
      ) : view === "validar" ? (
        <ValidarScreen
          data={data}
          onOpenProduct={(id) =>
            replaceParams({ vista: "validar", producto: id })
          }
          onChangeLink={(id) =>
            replaceParams({ vista: "vincular", producto: id })
          }
          onFix={(body) =>
            void mutate(() => post("/api/restaurant/recipes/review/fix", body))
          }
          onApprove={() => {
            if (!data.editor?.recipe_version_id) return;
            if (data.actor.needs_client_confirmation) {
              setHowOpen({ kind: "approve" });
              return;
            }
            void mutate(() =>
              post("/api/restaurant/recipes/approve", {
                recipe_version_id: data.editor?.recipe_version_id,
                odoo_product_id: data.editor?.odoo_product_id,
                confirmed_how: "en_pantalla",
                yield_confirmed: data.editor?.checklist.yield_confirmed,
              })
            );
          }}
          onSubmit={() => {
            if (!data.editor?.recipe_version_id) return;
            void mutate(() =>
              post("/api/restaurant/recipes/submit", {
                recipe_version_id: data.editor?.recipe_version_id,
              })
            );
          }}
          onEdited={() => void mutate(async () => undefined)}
          onOpenPreparation={openPreparation}
          busy={busy}
        />
      ) : view === "preparaciones" ? (
        <PreparacionesScreen
          data={data}
          selectedId={searchParams.get("prep")}
          onSelect={openPreparation}
          onChanged={() => void mutate(async () => undefined)}
          locationId={searchParams.get("location")}
        />
      ) : view === "menu-costeado" ? (
        <MenuCosteadoScreen data={data} onOpen={open} />
      ) : (
        <ResumenScreen
          data={data}
          onOpen={open}
          onGenerateSuggestions={() => void runSuggestions()}
          onUploadWorkbook={(file) => void runSuggestions(file)}
          generateBusy={workbookBusy}
          onUndoBatch={(batchId) =>
            void mutate(async () => {
              const res = await fetch(
                `/api/restaurant/costs/batches/${batchId}/undo`,
                {
                  method: "POST",
                }
              );
              const json = (await res.json()) as { error?: string };
              if (!res.ok)
                throw new Error(json.error ?? "No pude deshacer el lote.");
            })
          }
        />
      )}

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
        open={howOpen != null}
        title={
          howOpen?.kind === "approve"
            ? "Aprobar en nombre del cliente"
            : "Confirmar el vínculo en nombre del cliente"
        }
        onCancel={() => setHowOpen(null)}
        onConfirm={(how) => {
          const pending = howOpen;
          setHowOpen(null);
          if (pending?.kind === "confirm" && pending.product) {
            void confirmProduct(pending.product, how);
          } else if (
            pending?.kind === "approve" &&
            data.editor?.recipe_version_id
          ) {
            void mutate(() =>
              post("/api/restaurant/recipes/approve", {
                recipe_version_id: data.editor?.recipe_version_id,
                odoo_product_id: data.editor?.odoo_product_id,
                confirmed_how: how,
                yield_confirmed: data.editor?.checklist.yield_confirmed,
              })
            );
          }
        }}
      />
      {view !== "vincular" && view !== "validar" && nextCta(data) ? (
        <div className="sr-only">
          <PrimaryBtn onClick={() => open("vincular")}>Siguiente</PrimaryBtn>
        </div>
      ) : null}
    </div>
  );
}

function nextCta(data: RecipeCostingWorkspace): boolean {
  return Boolean(data.next_dish);
}
