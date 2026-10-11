"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  RESET_CONFIRM_FALLBACK,
  type CostImportHistoryItem,
} from "@/lib/restaurant/cost-workbook";
import {
  PICK_RESTAURANT_ERROR_EN,
  PICK_RESTAURANT_ERROR_ES,
  type UploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook/scope";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";

function formatBatchDate(iso: string | null, lang: PreferredLanguage): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-SV" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(
  status: CostImportHistoryItem["status"],
  lang: PreferredLanguage
): string {
  if (status === "live") return t(lang, "Live", "Vigente");
  if (status === "partially_undone") {
    return t(lang, "Partially undone", "Deshecho en parte");
  }
  return t(lang, "Undone", "Deshecho");
}

function createdSummary(
  batch: CostImportHistoryItem,
  lang: PreferredLanguage
): string {
  const parts =
    lang === "es"
      ? [
          `${batch.imported_count} costos`,
          `${batch.ingredients_created} ingredientes`,
          `${batch.menu_items_created} platillos`,
          `${batch.recipes_created} recetas`,
          `${batch.sub_recipes_created} sub-recetas`,
          `${batch.pos_links_created} vínculos POS`,
        ]
      : [
          `${batch.imported_count} cost rows`,
          `${batch.ingredients_created} ingredients`,
          `${batch.menu_items_created} menu items`,
          `${batch.recipes_created} recipes`,
          `${batch.sub_recipes_created} sub-recipes`,
          `${batch.pos_links_created} POS links`,
        ];
  return parts.join(" · ");
}

export function CostImportCleanup({
  lang,
  locations,
  scope,
  version,
}: {
  lang: PreferredLanguage;
  locations: RestaurantLocationOption[];
  scope: UploadRestaurantScope;
  version: number;
}) {
  const [batches, setBatches] = useState<CostImportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoingAll, setUndoingAll] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetSummary, setResetSummary] = useState<Record<
    string,
    number
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/restaurant/costs/batches", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.batches) return;
        setBatches(json.batches as CostImportHistoryItem[]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const liveCount = batches.filter((batch) => batch.status === "live").length;
  const expectedName = scope.ok
    ? scope.name?.trim() || RESET_CONFIRM_FALLBACK
    : "";
  const restaurantPicked = scope.ok;

  async function undoOne(id: string) {
    setUndoingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/restaurant/costs/batches/${id}/undo`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? t(lang, "Undo failed", "No se pudo deshacer"));
      } else {
        setBatches((rows) =>
          rows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  status: "undone",
                  undone_at: new Date().toISOString(),
                }
              : row
          )
        );
        setMessage(t(lang, "Import undone.", "Carga deshecha."));
      }
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : t(lang, "Undo failed", "No se pudo deshacer")
      );
    } finally {
      setUndoingId(null);
    }
  }

  async function undoAll() {
    setUndoingAll(true);
    setMessage(null);
    try {
      const res = await fetch("/api/restaurant/costs/batches/undo-all", {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json()) as {
        error?: string;
        undone?: number;
        failed_filename?: string;
      };
      if (!res.ok) {
        const failed = json.failed_filename
          ? t(
              lang,
              `Stopped at ${json.failed_filename}. ${json.error ?? "Undo failed"}`,
              `Se detuvo en ${json.failed_filename}. ${json.error ?? "No se pudo deshacer"}`
            )
          : (json.error ?? t(lang, "Undo failed", "No se pudo deshacer"));
        setMessage(failed);
      } else {
        setMessage(
          t(
            lang,
            `Undid ${json.undone ?? 0} import${(json.undone ?? 0) === 1 ? "" : "s"}, newest first.`,
            `Se deshicieron ${json.undone ?? 0} carga${(json.undone ?? 0) === 1 ? "" : "s"}, de la más nueva a la más vieja.`
          )
        );
      }
      const refresh = await fetch("/api/restaurant/costs/batches", {
        credentials: "include",
      });
      if (refresh.ok) {
        const body = (await refresh.json()) as {
          batches?: CostImportHistoryItem[];
        };
        if (body.batches) setBatches(body.batches);
      }
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : t(lang, "Undo failed", "No se pudo deshacer")
      );
    } finally {
      setUndoingAll(false);
    }
  }

  async function startOver() {
    if (!scope.ok) return;
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/restaurant/costs/reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm_name: confirmName,
          location_id: scope.locationId,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        summary?: Record<string, number>;
      };
      if (!res.ok) {
        if (json.code === "confirm_name") {
          setMessage(
            t(
              lang,
              `Type ${expectedName} to confirm.`,
              `Escribe ${expectedName} para confirmar.`
            )
          );
        } else if (json.code === "pick_restaurant") {
          setMessage(
            t(lang, PICK_RESTAURANT_ERROR_EN, PICK_RESTAURANT_ERROR_ES)
          );
        } else {
          setMessage(
            json.error ?? t(lang, "Reset failed", "No se pudo empezar de nuevo")
          );
        }
        return;
      }
      setResetSummary(json.summary ?? {});
      setResetOpen(false);
      setConfirmName("");
      const refresh = await fetch("/api/restaurant/costs/batches", {
        credentials: "include",
      });
      if (refresh.ok) {
        const body = (await refresh.json()) as {
          batches?: CostImportHistoryItem[];
        };
        if (body.batches) setBatches(body.batches);
      }
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : t(lang, "Reset failed", "No se pudo empezar de nuevo")
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="w-full px-6 pb-10 lg:px-10">
      <div className="max-w-4xl space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-orange-500" />
              {t(lang, "Import history", "Historial de cargas")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                lang,
                "Older uploads can be undone here. Undo newest first if a later file touched the same rows.",
                "Aquí puedes deshacer cargas viejas. Si un archivo posterior tocó las mismas filas, deshaz primero la más nueva."
              )}
            </p>
            {loading ? (
              <p className="text-sm text-muted-foreground">
                {t(lang, "Loading…", "Cargando…")}
              </p>
            ) : batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  lang,
                  "No cost imports yet.",
                  "Todavía no hay cargas de costos."
                )}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {batches.map((batch) => (
                  <li
                    key={batch.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {batch.filename}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {statusLabel(batch.status, lang)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatBatchDate(batch.created_at, lang)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {createdSummary(batch, lang)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        batch.status !== "live" || undoingId === batch.id
                      }
                      onClick={() => void undoOne(batch.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {undoingId === batch.id
                        ? t(lang, "Undoing…", "Deshaciendo…")
                        : t(lang, "Undo", "Deshacer")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {liveCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={undoingAll}
                onClick={() => void undoAll()}
              >
                {undoingAll
                  ? t(lang, "Undoing all…", "Deshaciendo todo…")
                  : t(lang, "Undo all imports", "Deshacer todas las cargas")}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
              <Trash2 className="h-4 w-4" />
              {t(lang, "Start over", "Empezar de nuevo")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                lang,
                "Deletes every cost, ingredient, recipe, and imported dish for this restaurant’s company so you can upload a clean workbook. POS sales, Odoo, users, and other companies stay. Menu items you created by hand stay; their recipes do not.",
                "Borra todos los costos, ingredientes, recetas y platillos importados de la empresa de este restaurante para que puedas subir el libro limpio. Las ventas POS, Odoo, usuarios y otras empresas no se tocan. Los platillos que creaste a mano se quedan; sus recetas no."
              )}
            </p>
            {!restaurantPicked && locations.length > 1 ? (
              <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {t(
                    lang,
                    "Pick a restaurant in the switcher before starting over. This is blocked on All Restaurants so the wipe cannot hit the wrong place.",
                    "Elige un restaurante en el menú de arriba antes de empezar de nuevo. Con «Todos los restaurantes» está bloqueado para no borrar en el lugar equivocado."
                  )}
                </span>
              </div>
            ) : resetOpen ? (
              <div className="space-y-3">
                <p className="text-sm">
                  {t(
                    lang,
                    `Type ${expectedName} to confirm.`,
                    `Escribe ${expectedName} para confirmar.`
                  )}
                </p>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={expectedName}
                  autoComplete="off"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={resetting || !confirmName.trim()}
                    onClick={() => void startOver()}
                  >
                    {resetting
                      ? t(lang, "Deleting…", "Borrando…")
                      : t(
                          lang,
                          "Delete cost data",
                          "Borrar los datos de costos"
                        )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resetting}
                    onClick={() => {
                      setResetOpen(false);
                      setConfirmName("");
                    }}
                  >
                    {t(lang, "Cancel", "Cancelar")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!restaurantPicked}
                onClick={() => setResetOpen(true)}
              >
                {t(lang, "Start over", "Empezar de nuevo")}
              </Button>
            )}
          </CardContent>
        </Card>

        {resetSummary && (
          <Card className="border-green-200 dark:border-green-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-700 dark:text-green-400">
                {t(lang, "Cost data cleared", "Datos de costos borrados")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <p>
                {t(
                  lang,
                  `Removed ${resetSummary.cost_entries ?? 0} cost rows, ${resetSummary.ingredients ?? 0} ingredients, ${resetSummary.recipes ?? 0} recipes, ${resetSummary.components ?? 0} sub-recipes, ${resetSummary.import_menu_items ?? 0} imported menu items, and ${resetSummary.import_pos_mappings ?? 0} imported POS links. ${resetSummary.batches_marked_undone ?? 0} imports marked undone. Kept ${resetSummary.kept_manual_menu_items ?? 0} handmade menu items and ${resetSummary.kept_manual_pos_mappings ?? 0} handmade POS links.`,
                  `Se quitaron ${resetSummary.cost_entries ?? 0} costos, ${resetSummary.ingredients ?? 0} ingredientes, ${resetSummary.recipes ?? 0} recetas, ${resetSummary.components ?? 0} sub-recetas, ${resetSummary.import_menu_items ?? 0} platillos importados y ${resetSummary.import_pos_mappings ?? 0} vínculos POS importados. ${resetSummary.batches_marked_undone ?? 0} cargas quedaron deshechas. Se conservaron ${resetSummary.kept_manual_menu_items ?? 0} platillos hechos a mano y ${resetSummary.kept_manual_pos_mappings ?? 0} vínculos POS hechos a mano.`
                )}
              </p>
            </CardContent>
          </Card>
        )}

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
