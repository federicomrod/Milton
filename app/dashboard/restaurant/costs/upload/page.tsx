// app/dashboard/restaurant/costs/upload/page.tsx
//
// Bulk ingredient-cost importer UI. Client component — posts a CSV/XLSX
// to /api/restaurant/costs/upload and renders the deterministic summary.
//
// Lives under the restaurant shell (app/dashboard/restaurant/layout.tsx),
// so it inherits the sidebar automatically.

"use client";

import { useState } from "react";
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
  warning: string;
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
  const [defaultCurrency, setDefaultCurrency] = useState("MXN");
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<UploadError | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setSummary(null);
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
      else setSummary(json as UploadSummary);
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
            Bulk-load supplier cost observations from a CSV or XLSX. Each row
            becomes a normalized entry in{" "}
            <code className="text-xs">ingredient_cost_entries</code> feeding the
            deterministic cost engine.
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
              item_name, product_name · Qty · UOM · Amount, line_total · SKU).
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
                    setError(null);
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
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
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
