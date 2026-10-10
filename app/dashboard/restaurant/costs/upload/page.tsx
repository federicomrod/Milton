// app/dashboard/restaurant/costs/upload/page.tsx
//
// Bulk ingredient-cost importer UI. Client component — posts a CSV/XLSX
// to /api/restaurant/costs/upload and renders the deterministic summary.
//
// Lives under the restaurant shell (app/dashboard/restaurant/layout.tsx),
// so it inherits the sidebar automatically.

"use client";

import { useEffect, useState } from "react";
import { useCompanyCurrency } from "@/lib/restaurant/use-company-currency";
import { CURRENCY_OPTIONS } from "@/lib/restaurant/currency";
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
  mapping_source: "ai" | "saved" | "mixed";
  default_currency: string;
  file_month: string | null;
  filename: string;
  tabs: WorkbookTabSummary[];
  review_items: WorkbookReviewItem[];
  ingredients_created: number;
  costs_updated: number;
}

interface UploadError {
  error: string;
  missing?: string[];
  headers?: string[];
  details?: string;
}

export default function CostUploadPage() {
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
    if (!file) return;
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
      } else setSummary(json as UploadSummary);
    } catch (err) {
      setError({
        error: "Network error",
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
          Back to Ingredients
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FileSpreadsheet className="h-7 w-7 text-orange-500" />
            Import Ingredient Costs
          </h1>
          <p className="text-base text-muted-foreground mt-2">
            Bulk-load supplier cost observations from a CSV or a multi-tab
            workbook. High-confidence rows save immediately into{" "}
            <code className="text-xs">ingredient_cost_entries</code> so the
            cockpit can show margins. Rows Milton is unsure about wait in a
            needs-a-look list and never block anything.
          </p>
        </div>

        {/* Expected format */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expected columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium mb-1">Required</p>
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
              <p className="text-sm font-medium mb-1">Optional</p>
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
              Headers are matched case-insensitively and accept variants (Cost
              Date, date, invoice_date · Supplier, vendor · Ingredient,
              item_name, product_name · Qty · UOM · Amount, line_total · SKU). A
              multi-tab workbook with Spanish headers or a price-list first
              sheet does not need these English names — Milton maps it.
            </p>
          </CardContent>
        </Card>

        {/* Form */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium">Select file</span>
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
                    Create missing ingredients
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      New ingredient rows use the file&apos;s unit as default.
                      Off = unknown ingredients are skipped and reported.
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
                    Skip exact duplicate rows
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Dedupe key: ingredient + supplier + date + quantity + unit
                      + total cost.
                    </span>
                  </span>
                </label>
              </div>

              <label className="block max-w-[180px]">
                <span className="text-sm font-medium">Default currency</span>
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
                    Uploading the same file twice will{" "}
                    <span className="font-medium">
                      create duplicate cost entries
                    </span>{" "}
                    unless &ldquo;Skip exact duplicate rows&rdquo; is enabled.
                  </span>
                </div>
              )}

              <Button
                type="submit"
                disabled={!file || submitting}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {submitting ? "Uploading…" : "Upload costs"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {!workbook && pendingReview.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Needs a look ({pendingReview.length}) — optional
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
                      {item.tab_name} row {item.row_index + 1}: {item.reason}
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
                      Skip
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
                    Missing required columns:
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
                    Headers seen in your file:
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
                  setUndoMessage(json.error ?? "Undo failed");
                } else {
                  setUndoMessage(
                    `Undone. Removed ${json.deleted_cost_entries ?? 0} cost rows.`
                  );
                  setPendingReview([]);
                }
              } catch (err) {
                setUndoMessage(
                  err instanceof Error ? err.message : "Undo failed"
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
                Import complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Rows in file" value={summary.total_rows_in_file} />
                <Stat label="Rows inserted" value={summary.inserted_rows} />
                <Stat
                  label="Suppliers created"
                  value={summary.suppliers_created}
                />
                <Stat
                  label="Ingredients created"
                  value={summary.ingredients_created}
                />
                <Stat
                  label="Supplier links"
                  value={summary.supplier_links_upserted}
                />
                <Stat
                  label="Skipped duplicates"
                  value={summary.skipped_duplicate_rows}
                />
                <Stat
                  label="Unmatched ingredients"
                  value={summary.unmatched_ingredient_rows}
                />
                <Stat label="Failed rows" value={summary.failed_rows.length} />
              </div>
              <p className="text-sm">
                Currency applied:{" "}
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
                    Rows not imported ({summary.failed_rows.length})
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-0.5 max-h-60 overflow-y-auto">
                    {summary.failed_rows.slice(0, 100).map((r, i) => (
                      <li key={i}>
                        Row {r.rowIndex + 2}: {r.reason}
                        {r.ingredient_name ? ` (${r.ingredient_name})` : ""}
                      </li>
                    ))}
                  </ul>
                  {summary.failed_rows.length > 100 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      + {summary.failed_rows.length - 100} more
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/restaurant/ingredients">
                    View ingredients
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/restaurant/menu">View menu costs</Link>
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

function tabTypeLabel(type: string): string {
  if (type === "price_list") return "Price list";
  if (type === "category_cost") return "Category costs";
  if (type === "purchases") return "Purchases";
  if (type === "recipe") return "Recipes, coming soon";
  return "Skipped";
}

function WorkbookResult({
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
          Saved for this restaurant in {workbook.default_currency}
          {workbook.file_month ? ` · dated ${workbook.file_month}` : ""}.
          Mapping:{" "}
          {workbook.mapping_source === "saved" ? "remembered layout" : "AI"}.
          {workbook.recipe_tab_count > 0
            ? ` ${workbook.recipe_tab_count} recipe tab${
                workbook.recipe_tab_count === 1 ? "" : "s"
              } listed as coming soon.`
            : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleDetails}
          >
            {showDetails
              ? "Hide mapping details"
              : "See how Milton mapped this"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={undoing || Boolean(undoMessage?.startsWith("Undone"))}
            onClick={onUndo}
          >
            {undoing ? "Undoing…" : "Undo this import"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/restaurant">Open cockpit</Link>
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
                    · {tabTypeLabel(tab.type)} ·{" "}
                    {Math.round(tab.confidence * 100)}% · {tab.mapping_source}
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
                    Preview:{" "}
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
              </div>
            ))}
          </div>
        )}

        {pendingReview.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">
              Needs a look ({pendingReview.length}) — optional, does not block
              the cockpit
            </p>
            <ul className="text-xs space-y-2 max-h-72 overflow-y-auto">
              {pendingReview.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border border-border px-3 py-2 flex flex-wrap items-start justify-between gap-2"
                >
                  <span className="text-muted-foreground">
                    {item.tab_name} row {item.row_index + 1}: {item.reason}
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
                        Approve
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onSkip(item.id)}
                    >
                      Skip
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
