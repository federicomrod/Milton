// Client half of Costs > Upload. The server page decides whether a
// restaurant is selected; this form posts the file and shows the summary.

"use client";

import { useEffect, useState } from "react";
import { useCompanyCurrency } from "@/lib/restaurant/use-company-currency";
import { CURRENCY_OPTIONS } from "@/lib/restaurant/currency";
import {
  PICK_RESTAURANT_ERROR_EN,
  PICK_RESTAURANT_ERROR_ES,
  type UploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook/scope";
import {
  mappingSourceLabel,
  tabTypeLabel,
} from "@/lib/restaurant/cost-workbook/copy";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";
import Link from "next/link";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  FileSpreadsheet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FailedRow {
  rowIndex: number;
  reason: string;
  ingredient_name?: string;
}

interface UploadSummary {
  kind?: "fixed" | "workbook";
  total_rows_in_file: number;
  inserted_rows: number;
  suppliers_created: number;
  ingredients_created: number;
  supplier_links_upserted: number;
  skipped_duplicate_rows: number;
  unmatched_ingredient_rows: number;
  failed_rows: FailedRow[];
  resolved_columns: Record<string, string>;
  create_missing_ingredients: boolean;
  default_currency: string;
  currency_mismatch_rows?: number;
  warning: string;
}

interface WorkbookTabSummary {
  name: string;
  type: string;
  confidence: number;
  mapping_source: string;
  column_mapping: Record<string, { column: string; confidence: number }>;
  imported_count: number;
  review_count: number;
  preview: Record<string, unknown>[];
  note?: string;
  skipped_count?: number;
  skipped_reasons?: Array<{ reason: string; count: number }>;
}

interface WorkbookReviewItem {
  id: string;
  tab_name: string;
  row_index: number;
  reason: string;
  raw_values: Record<string, unknown>;
  suggested: Record<string, unknown> | null;
  status: "pending" | "approved" | "skipped";
}

interface WorkbookSummary {
  kind: "workbook";
  batch_id: string;
  headline: string;
  imported_count: number;
  review_count: number;
  tab_count: number;
  recipe_tab_count: number;
  mapping_source: "ai" | "saved" | "mixed" | "heuristic";
  default_currency: string;
  file_month: string | null;
  filename: string;
  tabs: WorkbookTabSummary[];
  review_items: WorkbookReviewItem[];
  ingredients_created: number;
  costs_updated: number;
  saved_count?: number;
  skipped_count?: number;
  skipped_reasons?: Array<{ reason: string; count: number }>;
  skipped_breakdown?: {
    previous_duplicates: number;
    blank_or_title: number;
    other: number;
  };
  skipped_plain?: string;
  menu_items_created?: number;
  recipes_created?: number;
  sub_recipes_created?: number;
  pos_links_created?: number;
  restaurant_name?: string | null;
  location_id?: string | null;
  recipe_match?: {
    dishes_matched: number;
    dishes_total: number;
    subs_matched: number;
    subs_total: number;
    headline: string;
    mismatches: Array<{
      kind: "recipe" | "sub_recipe";
      name: string;
      excel_cost: number | null;
      milton_cost: number | null;
      reason: string;
    }>;
  };
  pos_unlinked_dishes?: string[];
  pos_unmatched_names?: string[];
}

interface UploadError {
  error: string;
  missing?: string[];
  headers?: string[];
  details?: string;
}

export function CostUploadForm({
  lang,
  locations,
  scope,
  onCatalogChange,
}: {
  lang: PreferredLanguage;
  locations: RestaurantLocationOption[];
  scope: UploadRestaurantScope;
  onCatalogChange?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const companyCurrency = useCompanyCurrency();
  const [defaultCurrency, setDefaultCurrency] = useState(companyCurrency);
  useEffect(() => {
    setDefaultCurrency(companyCurrency);
  }, [companyCurrency]);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookSummary | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [pendingReview, setPendingReview] = useState<WorkbookReviewItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/restaurant/costs/review?status=pending", {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.items) return;
        setPendingReview(json.items as WorkbookReviewItem[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !scope.ok) return;
    setSubmitting(true);
    setSummary(null);
    setWorkbook(null);
    setShowDetails(false);
    setUndoMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "create_missing_ingredients",
        createMissing ? "true" : "false"
      );
      form.append("skip_duplicates", skipDuplicates ? "true" : "false");
      form.append("default_currency", defaultCurrency);
      if (scope.ok && scope.locationId) {
        form.append("location_id", scope.locationId);
      }
      const res = await fetch("/api/restaurant/costs/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) setError(json as UploadError);
      else if (json?.kind === "workbook") {
        const wb = json as WorkbookSummary;
        setWorkbook(wb);
        setPendingReview(wb.review_items ?? []);
        onCatalogChange?.();
      } else {
        setSummary(json as UploadSummary);
        onCatalogChange?.();
      }
    } catch (err) {
      setError({
        error: t(lang, "Network error", "Error de red"),
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="max-w-4xl space-y-6">
        <Link
          href="/dashboard/restaurant/ingredients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t(lang, "Back to Ingredients", "Volver a Ingredientes")}
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FileSpreadsheet className="h-7 w-7 text-orange-500" />
            {t(
              lang,
              "Import Ingredient Costs",
              "Importar costos de ingredientes"
            )}
          </h1>
          <p className="text-base text-muted-foreground mt-2">
            {t(
              lang,
              "Bulk-load supplier cost observations from a CSV or a multi-tab workbook. High-confidence rows save immediately into ingredient_cost_entries so the cockpit can show margins. Rows Milton is unsure about wait in a needs-a-look list and never block anything. If a printed Total Costo does not match quantity × unit cost, the line is still imported with the recomputed cost and flagged.",
              "Carga los costos de tus proveedores desde un CSV o un libro con varias pestañas. Las filas con alta confianza se guardan de una vez en ingredient_cost_entries para que el cockpit muestre márgenes. Las filas que Milton no tiene claras quedan en una lista de “necesitan una mirada” y no bloquean nada. Si el Total Costo impreso no cuadra con cantidad × costo unitario, la fila se importa igual con el costo recalculado y queda marcada."
            )}
          </p>
        </div>

        {/* Expected format */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {t(lang, "Expected columns", "Columnas esperadas")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium mb-1">
                {t(lang, "Required", "Obligatorias")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "cost_date",
                  "supplier_name",
                  "ingredient_name",
                  "quantity",
                  "unit",
                  "total_cost",
                ].map((c) => (
                  <Badge
                    key={c}
                    variant="outline"
                    className="text-xs font-mono"
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">
                {t(lang, "Optional", "Opcionales")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "currency",
                  "notes",
                  "supplier_item_name",
                  "supplier_sku",
                ].map((c) => (
                  <Badge
                    key={c}
                    variant="outline"
                    className="text-xs font-mono"
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                lang,
                "Headers are matched case-insensitively and accept variants (Cost Date, date, invoice_date · Supplier, vendor · Ingredient, item_name, product_name · Qty · UOM · Amount, line_total · SKU). A multi-tab workbook with Spanish headers or a price-list first sheet does not need these English names — Milton maps it.",
                "Los encabezados se reconocen sin importar mayúsculas y aceptan variantes (Cost Date, date, invoice_date · Supplier, vendor · Ingredient, item_name, product_name · Qty · UOM · Amount, line_total · SKU). Un libro con varias pestañas y encabezados en español o una lista de precios no necesita estos nombres en inglés — Milton los mapea."
              )}
            </p>
          </CardContent>
        </Card>

        {/* Form */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium">
                  {t(lang, "Select file", "Elige el archivo")}
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setSummary(null);
                    setWorkbook(null);
                    setError(null);
                    setUndoMessage(null);
                  }}
                  className="mt-2 block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createMissing}
                    onChange={(e) => setCreateMissing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-blue-600"
                  />
                  <span className="text-sm leading-tight">
                    {t(
                      lang,
                      "Create missing ingredients",
                      "Crear ingredientes que falten"
                    )}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {t(
                        lang,
                        "New ingredient rows use the file's unit as default. Off = unknown ingredients are skipped and reported.",
                        "Los ingredientes nuevos usan la unidad del archivo. Si lo dejas apagado, los desconocidos se omiten y se reportan."
                      )}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-blue-600"
                  />
                  <span className="text-sm leading-tight">
                    {t(
                      lang,
                      "Skip exact duplicate rows",
                      "Omitir filas duplicadas exactas"
                    )}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {t(
                        lang,
                        "Dedupe key: ingredient + supplier + date + quantity + unit + total cost.",
                        "Clave: ingrediente + proveedor + fecha + cantidad + unidad + costo total."
                      )}
                    </span>
                  </span>
                </label>
              </div>

              <label className="block max-w-[180px]">
                <span className="text-sm font-medium">
                  {t(lang, "Default currency", "Moneda predeterminada")}
                </span>
                <select
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                  {!CURRENCY_OPTIONS.includes(
                    defaultCurrency as (typeof CURRENCY_OPTIONS)[number]
                  ) && (
                    <option value={defaultCurrency}>{defaultCurrency}</option>
                  )}
                </select>
              </label>

              {!skipDuplicates && (
                <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {t(
                      lang,
                      "Uploading the same file twice will create duplicate cost entries unless “Skip exact duplicate rows” is enabled.",
                      "Si subes el mismo archivo dos veces vas a crear costos duplicados, salvo que actives «Omitir filas duplicadas exactas»."
                    )}
                  </span>
                </div>
              )}

              {!scope.ok && locations.length > 1 && (
                <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {t(
                      lang,
                      PICK_RESTAURANT_ERROR_EN,
                      PICK_RESTAURANT_ERROR_ES
                    )}
                  </span>
                </div>
              )}

              {scope.ok && scope.name && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    lang,
                    `This file will be saved for ${scope.name}.`,
                    `Este archivo se guarda para ${scope.name}.`
                  )}
                </p>
              )}

              <Button
                type="submit"
                disabled={!file || submitting || !scope.ok}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {submitting
                  ? t(lang, "Uploading…", "Subiendo…")
                  : t(lang, "Upload costs", "Subir costos")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {!workbook && pendingReview.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t(
                  lang,
                  `Needs a look (${pendingReview.length}) — optional`,
                  `Necesitan una mirada (${pendingReview.length}) — opcional`
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-xs space-y-2 max-h-72 overflow-y-auto">
                {pendingReview.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border px-3 py-2 flex flex-wrap items-start justify-between gap-2"
                  >
                    <span className="text-muted-foreground">
                      {item.tab_name} {t(lang, "row", "fila")}{" "}
                      {item.row_index + 1}: {item.reason}
                      {item.suggested?.ingredient_name
                        ? ` (${String(item.suggested.ingredient_name)})`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={async () => {
                        const res = await fetch(
                          `/api/restaurant/costs/review/${item.id}`,
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "skip" }),
                          }
                        );
                        if (res.ok) {
                          setPendingReview((rows) =>
                            rows.filter((r) => r.id !== item.id)
                          );
                        }
                      }}
                    >
                      {t(lang, "Skip", "Omitir")}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                {error.error}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {error.details && (
                <p className="text-sm text-muted-foreground">{error.details}</p>
              )}
              {error.missing && error.missing.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    {t(
                      lang,
                      "Missing required columns:",
                      "Faltan columnas obligatorias:"
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {error.missing.map((m) => (
                      <Badge
                        key={m}
                        variant="outline"
                        className="text-xs font-mono border-red-300 text-red-700 dark:text-red-400"
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {error.headers && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    {t(
                      lang,
                      "Headers seen in your file:",
                      "Encabezados que se vieron en tu archivo:"
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {error.headers.join(", ")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {workbook && (
          <WorkbookResult
            lang={lang}
            workbook={workbook}
            pendingReview={pendingReview}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
            undoing={undoing}
            undoMessage={undoMessage}
            onUndo={async () => {
              setUndoing(true);
              setUndoMessage(null);
              try {
                const res = await fetch(
                  `/api/restaurant/costs/batches/${workbook.batch_id}/undo`,
                  { method: "POST", credentials: "include" }
                );
                const json = await res.json();
                if (!res.ok) {
                  setUndoMessage(
                    json.error ?? t(lang, "Undo failed", "No se pudo deshacer")
                  );
                } else {
                  setUndoMessage(
                    t(
                      lang,
                      `Undone. Removed ${json.deleted_cost_entries ?? 0} cost rows and the menu items, recipes, and POS links this import created.`,
                      `Deshecho. Se quitaron ${json.deleted_cost_entries ?? 0} filas de costo y los platillos, recetas y vínculos POS que creó esta carga.`
                    )
                  );
                  setPendingReview([]);
                  onCatalogChange?.();
                }
              } catch (err) {
                setUndoMessage(
                  err instanceof Error
                    ? err.message
                    : t(lang, "Undo failed", "No se pudo deshacer")
                );
              } finally {
                setUndoing(false);
              }
            }}
            onSkip={async (id) => {
              const res = await fetch(`/api/restaurant/costs/review/${id}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "skip" }),
              });
              if (res.ok) {
                setPendingReview((rows) => rows.filter((r) => r.id !== id));
              }
            }}
            onApprove={async (item) => {
              const res = await fetch(
                `/api/restaurant/costs/review/${item.id}`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "approve",
                    ingredient_name:
                      (item.suggested?.ingredient_name as string) ?? undefined,
                    unit: (item.suggested?.unit as string) ?? undefined,
                    quantity: (item.suggested?.quantity as number) ?? undefined,
                    total_cost:
                      (item.suggested?.total_cost as number) ?? undefined,
                  }),
                }
              );
              if (res.ok) {
                setPendingReview((rows) =>
                  rows.filter((r) => r.id !== item.id)
                );
              }
            }}
          />
        )}

        {/* Summary */}
        {summary && (
          <Card className="border-green-200 dark:border-green-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                {t(lang, "Import complete", "Importación completa")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat
                  label={t(lang, "Rows in file", "Filas en el archivo")}
                  value={summary.total_rows_in_file}
                />
                <Stat
                  label={t(lang, "Rows inserted", "Filas insertadas")}
                  value={summary.inserted_rows}
                />
                <Stat
                  label={t(lang, "Suppliers created", "Proveedores creados")}
                  value={summary.suppliers_created}
                />
                <Stat
                  label={t(lang, "Ingredients created", "Ingredientes creados")}
                  value={summary.ingredients_created}
                />
                <Stat
                  label={t(lang, "Supplier links", "Vínculos de proveedor")}
                  value={summary.supplier_links_upserted}
                />
                <Stat
                  label={t(lang, "Skipped duplicates", "Duplicados omitidos")}
                  value={summary.skipped_duplicate_rows}
                />
                <Stat
                  label={t(
                    lang,
                    "Unmatched ingredients",
                    "Ingredientes sin coincidencia"
                  )}
                  value={summary.unmatched_ingredient_rows}
                />
                <Stat
                  label={t(lang, "Failed rows", "Filas con error")}
                  value={summary.failed_rows.length}
                />
              </div>
              <p className="text-sm">
                {t(lang, "Currency applied:", "Moneda aplicada:")}{" "}
                <span className="font-semibold">
                  {summary.default_currency}
                </span>
              </p>
              {summary.warning && (
                <p className="text-sm text-muted-foreground">
                  {summary.warning}
                </p>
              )}

              {summary.failed_rows.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    {t(
                      lang,
                      `Rows not imported (${summary.failed_rows.length})`,
                      `Filas no importadas (${summary.failed_rows.length})`
                    )}
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-0.5 max-h-60 overflow-y-auto">
                    {summary.failed_rows.slice(0, 100).map((r, i) => (
                      <li key={i}>
                        {t(lang, "Row", "Fila")} {r.rowIndex + 2}: {r.reason}
                        {r.ingredient_name ? ` (${r.ingredient_name})` : ""}
                      </li>
                    ))}
                  </ul>
                  {summary.failed_rows.length > 100 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t(
                        lang,
                        `+ ${summary.failed_rows.length - 100} more`,
                        `+ ${summary.failed_rows.length - 100} más`
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/restaurant/ingredients">
                    {t(lang, "View ingredients", "Ver ingredientes")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/restaurant/menu">
                    {t(lang, "View menu costs", "Ver costos del menú")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5 tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function WorkbookResult({
  lang,
  workbook,
  pendingReview,
  showDetails,
  onToggleDetails,
  undoing,
  undoMessage,
  onUndo,
  onSkip,
  onApprove,
}: {
  lang: PreferredLanguage;
  workbook: WorkbookSummary;
  pendingReview: WorkbookReviewItem[];
  showDetails: boolean;
  onToggleDetails: () => void;
  undoing: boolean;
  undoMessage: string | null;
  onUndo: () => void;
  onSkip: (id: string) => void;
  onApprove: (item: WorkbookReviewItem) => void;
}) {
  return (
    <Card className="border-green-200 dark:border-green-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          {workbook.headline}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {workbook.restaurant_name
            ? t(
                lang,
                `Saved for ${workbook.restaurant_name} in ${workbook.default_currency}`,
                `Guardado para ${workbook.restaurant_name} en ${workbook.default_currency}`
              )
            : t(
                lang,
                `Saved for this restaurant in ${workbook.default_currency}`,
                `Guardado para este restaurante en ${workbook.default_currency}`
              )}
          {workbook.file_month
            ? t(
                lang,
                ` · dated ${workbook.file_month}`,
                ` · fecha ${workbook.file_month}`
              )
            : ""}
          . {t(lang, "Mapping:", "Mapeo:")}{" "}
          {mappingSourceLabel(lang, workbook.mapping_source)}.
          {workbook.recipe_tab_count > 0
            ? t(
                lang,
                ` ${workbook.recipes_created ?? 0} recipe${
                  (workbook.recipes_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.sub_recipes_created ?? 0} sub-recipe${
                  (workbook.sub_recipes_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.menu_items_created ?? 0} menu item${
                  (workbook.menu_items_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.pos_links_created ?? 0} POS link${
                  (workbook.pos_links_created ?? 0) === 1 ? "" : "s"
                }.`,
                ` ${workbook.recipes_created ?? 0} receta${
                  (workbook.recipes_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.sub_recipes_created ?? 0} sub-receta${
                  (workbook.sub_recipes_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.menu_items_created ?? 0} platillo${
                  (workbook.menu_items_created ?? 0) === 1 ? "" : "s"
                }, ${workbook.pos_links_created ?? 0} vínculo${
                  (workbook.pos_links_created ?? 0) === 1 ? "" : "s"
                } POS.`
              )
            : ""}
        </p>
        {workbook.skipped_plain ? (
          <p className="text-sm text-muted-foreground">
            {workbook.skipped_plain}
          </p>
        ) : null}
        {workbook.recipe_match?.headline ? (
          <p className="text-sm font-medium">
            {workbook.recipe_match.headline}
          </p>
        ) : null}
        {workbook.recipe_match &&
        workbook.recipe_match.mismatches.length > 0 ? (
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm space-y-1">
            <p className="font-medium">
              {t(
                lang,
                "Recipes that do not match the Excel",
                "Recetas que no coinciden con el Excel"
              )}
            </p>
            <ul className="space-y-1">
              {workbook.recipe_match.mismatches.map((row) => (
                <li key={`${row.kind}-${row.name}`}>
                  <span className="font-medium">{row.name}</span>
                  {": "}
                  {t(lang, "Excel", "Excel")}{" "}
                  {row.excel_cost == null ? "—" : row.excel_cost.toFixed(2)}
                  {" · Milton "}
                  {row.milton_cost == null ? "—" : row.milton_cost.toFixed(2)}
                  {" — "}
                  {row.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleDetails}
          >
            {showDetails
              ? t(lang, "Hide mapping details", "Ocultar el detalle del mapeo")
              : t(
                  lang,
                  "See how Milton mapped this",
                  "Ver cómo Milton mapeó esto"
                )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              undoing ||
              Boolean(
                undoMessage?.startsWith("Undone") ||
                undoMessage?.startsWith("Deshecho")
              )
            }
            onClick={onUndo}
          >
            {undoing
              ? t(lang, "Undoing…", "Deshaciendo…")
              : t(lang, "Undo this import", "Deshacer esta carga")}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/restaurant">
              {t(lang, "Open cockpit", "Abrir el cockpit")}
            </Link>
          </Button>
        </div>
        {undoMessage && (
          <p className="text-sm text-muted-foreground">{undoMessage}</p>
        )}

        {showDetails && (
          <div className="space-y-3">
            {workbook.tabs.map((tab) => (
              <div
                key={tab.name}
                className="rounded-md border border-border p-3 space-y-2"
              >
                <p className="text-sm font-medium">
                  {tab.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    · {tabTypeLabel(lang, tab.type)} ·{" "}
                    {Math.round(tab.confidence * 100)}% ·{" "}
                    {mappingSourceLabel(lang, tab.mapping_source)}
                    {tab.note ? ` · ${tab.note}` : ""}
                  </span>
                </p>
                {Object.keys(tab.column_mapping).length > 0 && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {Object.entries(tab.column_mapping)
                      .map(
                        ([field, bind]) =>
                          `${field} ← ${bind.column} (${Math.round(
                            bind.confidence * 100
                          )}%)`
                      )
                      .join(" · ")}
                  </p>
                )}
                {tab.preview.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(lang, "Preview:", "Vista previa:")}{" "}
                    {tab.preview
                      .slice(0, 3)
                      .map((row) =>
                        Object.values(row)
                          .filter((v) => String(v).trim() !== "")
                          .slice(0, 4)
                          .join(" / ")
                      )
                      .join(" · ")}
                  </p>
                )}
                {(tab.skipped_reasons?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(lang, "Skipped:", "Omitidas:")}{" "}
                    {(tab.skipped_reasons ?? [])
                      .map((row) => `${row.count} ${row.reason}`)
                      .join(", ")}
                  </p>
                )}
              </div>
            ))}
            {(workbook.skipped_reasons?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {t(lang, "All skipped:", "Todas las omitidas:")}{" "}
                {(workbook.skipped_reasons ?? [])
                  .map((row) => `${row.count} ${row.reason}`)
                  .join(", ")}
              </p>
            )}
          </div>
        )}

        {pendingReview.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">
              {t(
                lang,
                `Needs a look (${pendingReview.length}) — optional, does not block the cockpit`,
                `Necesitan una mirada (${pendingReview.length}) — opcional, no bloquea el cockpit`
              )}
            </p>
            <ul className="text-xs space-y-2 max-h-72 overflow-y-auto">
              {pendingReview.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border border-border px-3 py-2 flex flex-wrap items-start justify-between gap-2"
                >
                  <span className="text-muted-foreground">
                    {item.tab_name} {t(lang, "row", "fila")}{" "}
                    {item.row_index + 1}: {item.reason}
                    {item.suggested?.ingredient_name
                      ? ` (${String(item.suggested.ingredient_name)})`
                      : ""}
                  </span>
                  <span className="flex gap-1">
                    {Boolean(
                      item.suggested?.ingredient_name &&
                      item.suggested?.unit &&
                      item.suggested?.total_cost != null
                    ) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onApprove(item)}
                      >
                        {t(lang, "Approve", "Aprobar")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onSkip(item.id)}
                    >
                      {t(lang, "Skip", "Omitir")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
