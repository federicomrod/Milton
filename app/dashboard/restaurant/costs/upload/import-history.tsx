"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  RESET_CONFIRM_FALLBACK,
  RESET_FAILED_ERROR_ES,
  RESET_FORBIDDEN_ERROR_ES,
  RESET_SALES_LINKS_NOTE_ES,
  companyNameIsDistinct,
  formatResetPartialFailureEs,
  joinRestaurantNamesEs,
  multiRestaurantResetWarningEs,
  resetConfirmPromptEs,
  undoFailureMessageEs,
  type CostImportHistoryItem,
  type CostResetStepResult,
} from "@/lib/restaurant/cost-workbook";
import {
  PICK_RESTAURANT_ERROR_ES,
  type UploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook/scope";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";

function formatBatchDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: CostImportHistoryItem["status"]): string {
  if (status === "live") return "Vigente";
  if (status === "partially_undone") return "Deshecho en parte";
  return "Deshecho";
}

function createdSummary(batch: CostImportHistoryItem): string {
  return [
    `${batch.imported_count} costos`,
    `${batch.ingredients_created} ingredientes`,
    `${batch.menu_items_created} platillos`,
    `${batch.recipes_created} recetas`,
    `${batch.sub_recipes_created} sub-recetas`,
    `${batch.pos_links_created} vínculos POS`,
  ].join(" · ");
}

export function CostImportCleanup({
  locations,
  scope,
  companyName,
  canManageReset,
  version,
}: {
  lang?: PreferredLanguage;
  locations: RestaurantLocationOption[];
  scope: UploadRestaurantScope;
  companyName: string | null;
  canManageReset: boolean;
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
  const [resetSteps, setResetSteps] = useState<CostResetStepResult[] | null>(
    null
  );
  const [resetPartial, setResetPartial] = useState(false);

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
  const restaurantNames = locations.map((row) => row.name);
  const confirmTarget = { companyName, restaurantNames };
  const expectedName = scope.ok
    ? scope.name?.trim() || companyName?.trim() || RESET_CONFIRM_FALLBACK
    : "";
  const restaurantPicked = scope.ok;
  const multiRestaurant = restaurantNames.length > 1;
  const selectedRestaurantName = scope.ok
    ? scope.name?.trim() || expectedName
    : expectedName;
  const busy = resetting || undoingAll || undoingId !== null;

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
        setMessage(undoFailureMessageEs(json.error));
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
        setMessage("Carga deshecha.");
      }
    } catch {
      setMessage("No se pudo deshacer.");
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
        setMessage(
          json.error ?? undoFailureMessageEs(undefined, json.failed_filename)
        );
      } else {
        const n = json.undone ?? 0;
        setMessage(
          `Se deshicieron ${n} carga${n === 1 ? "" : "s"}, de la más nueva a la más vieja.`
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
    } catch {
      setMessage("No se pudieron deshacer todas las cargas.");
    } finally {
      setUndoingAll(false);
    }
  }

  async function startOver() {
    if (!scope.ok || resetting) return;
    setResetting(true);
    setMessage(null);
    setResetPartial(false);
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
        steps?: CostResetStepResult[];
        ok?: boolean;
      };
      if (json.steps && json.ok === false) {
        setResetSteps(json.steps);
        setResetSummary(json.summary ?? null);
        setResetPartial(true);
        setMessage(formatResetPartialFailureEs(json.steps));
        return;
      }
      if (!res.ok) {
        if (json.code === "confirm_name") {
          setMessage(resetConfirmPromptEs(confirmTarget));
        } else if (json.code === "pick_restaurant") {
          setMessage(PICK_RESTAURANT_ERROR_ES);
        } else if (json.code === "forbidden") {
          setMessage(RESET_FORBIDDEN_ERROR_ES);
        } else {
          setMessage(json.error ?? RESET_FAILED_ERROR_ES);
        }
        return;
      }
      setResetSummary(json.summary ?? {});
      setResetSteps(json.steps ?? null);
      setResetPartial(false);
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
    } catch {
      setMessage(RESET_FAILED_ERROR_ES);
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
              Historial de cargas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Aquí puedes deshacer cargas viejas. Si un archivo posterior tocó
              las mismas filas, deshaz primero la más nueva. No se puede
              deshacer.
            </p>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay cargas de costos.
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
                          {statusLabel(batch.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatBatchDate(batch.created_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {createdSummary(batch)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        batch.status !== "live" ||
                        undoingId === batch.id ||
                        busy
                      }
                      onClick={() => void undoOne(batch.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {undoingId === batch.id ? "Deshaciendo…" : "Deshacer"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {liveCount > 0 && canManageReset && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void undoAll()}
              >
                {undoingAll
                  ? "Deshaciendo todo…"
                  : "Deshacer todas las cargas (no se puede deshacer)"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
              <Trash2 className="h-4 w-4" />
              Empezar de nuevo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Borra todos los costos, ingredientes, recetas y platillos
              importados de la empresa de este restaurante para que puedas subir
              el libro limpio. No se puede deshacer. Las ventas POS, Odoo,
              usuarios y otras empresas no se tocan. {RESET_SALES_LINKS_NOTE_ES}
            </p>
            {multiRestaurant && restaurantPicked && (
              <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-900 dark:text-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {multiRestaurantResetWarningEs(
                    restaurantNames,
                    selectedRestaurantName
                  )}
                </span>
              </div>
            )}
            {!restaurantPicked && locations.length > 1 ? (
              <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Elige un restaurante en el menú de arriba antes de empezar de
                  nuevo. Con «Todos los restaurantes» está bloqueado para no
                  borrar en el lugar equivocado.
                </span>
              </div>
            ) : !canManageReset ? (
              <p className="text-sm text-muted-foreground">
                Solo el dueño o un admin puede empezar de nuevo.
              </p>
            ) : resetOpen ? (
              <div className="space-y-3">
                <p className="text-sm">{resetConfirmPromptEs(confirmTarget)}</p>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={
                    multiRestaurant
                      ? companyNameIsDistinct(companyName, restaurantNames)
                        ? (companyName ??
                          joinRestaurantNamesEs(restaurantNames))
                        : joinRestaurantNamesEs(restaurantNames)
                      : expectedName
                  }
                  autoComplete="off"
                  disabled={resetting}
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
                      ? "Borrando…"
                      : "Borrar los datos de costos (no se puede deshacer)"}
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
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!restaurantPicked || busy}
                onClick={() => setResetOpen(true)}
              >
                Empezar de nuevo
              </Button>
            )}
          </CardContent>
        </Card>

        {resetSummary && !resetPartial && (
          <Card className="border-green-200 dark:border-green-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-700 dark:text-green-400">
                Datos de costos borrados
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <p>
                {`Se quitaron ${resetSummary.cost_entries ?? 0} costos, ${resetSummary.ingredients ?? 0} ingredientes, ${resetSummary.recipes ?? 0} recetas, ${resetSummary.components ?? 0} sub-recetas, ${resetSummary.import_menu_items ?? 0} platillos importados y ${resetSummary.import_pos_mappings ?? 0} vínculos POS importados. ${resetSummary.batches_marked_undone ?? 0} cargas quedaron deshechas. Se conservaron ${resetSummary.kept_manual_menu_items ?? 0} platillos hechos a mano y ${resetSummary.kept_manual_pos_mappings ?? 0} vínculos POS hechos a mano.`}
              </p>
            </CardContent>
          </Card>
        )}

        {resetPartial && resetSteps && (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-800 dark:text-amber-200">
                El reinicio quedó a medias
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>{formatResetPartialFailureEs(resetSteps)}</p>
              <ul className="list-disc pl-5 space-y-1">
                {resetSteps.map((step) => (
                  <li key={step.id}>
                    {step.label_es}: {step.deleted}
                    {step.status === "failed"
                      ? ` — no se completó${step.error ? ` (${step.error})` : ""}`
                      : step.status === "skipped"
                        ? " — no se corrió"
                        : ""}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
