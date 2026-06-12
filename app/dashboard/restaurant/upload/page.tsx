// app/dashboard/restaurant/upload/page.tsx
// First real POS upload UI. Requires authenticated Supabase access — this
// page lives under app/dashboard/* on purpose, so the proxy.ts auth gate
// applies and unauthenticated users get redirected to /auth/login.
//
// The mock cockpit at /dashboard/restaurant remains in the (restaurant-cockpit)
// route group (dev-only bypass). This page is the protected counterpart.

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UploadSummary {
  inserted_rows: number;
  /** Rows deleted before insert when replace_existing was true. */
  deleted_rows: number;
  unique_orders: number;
  total_revenue: number;
  unmatched_menu_items: string[];
  unmatched_locations: string[];
  validation_errors: Array<{
    rowIndex: number;
    reason: string;
    rawOrderNumber?: string;
  }>;
  resolved_columns: Record<string, string>;
  total_rows_in_file: number;
  replace_existing: boolean;
}

interface UploadError {
  error: string;
  missing?: string[];
  headers?: string[];
  details?: string;
  validation_errors?: Array<{
    rowIndex: number;
    reason: string;
    rawOrderNumber?: string;
  }>;
}

const mxnFmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
});

export default function RestaurantPOSUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  // Default-true for MVP: re-uploading the same file is the most common
  // case during pilot testing, and silently doubling revenue is much
  // worse than an explicit replace. Users can untick to append.
  const [replaceExisting, setReplaceExisting] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setSummary(null);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      // Sent as a string so the FormData body works across runtimes; the
      // API accepts "true"/"1"/"on".
      form.append("replace_existing", replaceExisting ? "true" : "false");
      const res = await fetch("/api/restaurant/pos/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json as UploadError);
      } else {
        setSummary(json as UploadSummary);
      }
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
        {/* Back link */}
        <Link
          href="/dashboard/restaurant"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to restaurant cockpit
        </Link>

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FileSpreadsheet className="h-7 w-7 text-blue-500" />
            Import POS Sales (Revel)
          </h1>
          <p className="text-base text-muted-foreground mt-2">
            Upload a Revel-style item-level customer items export. The first
            sheet is parsed; each row is normalized into{" "}
            <code className="text-xs">pos_sales_items</code>.
          </p>
        </div>

        {/* Expected format */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expected file format</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              CSV or XLSX from Revel (Customer Items export). Required columns
              (header variants are matched case-insensitively):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Order_Number",
                "Order_Date",
                "Product_Name",
                "Product_Quantity",
                "Gross_Item_Total or Total_Sales",
              ].map((c) => (
                <Badge key={c} variant="outline" className="text-xs font-mono">
                  {c}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Optional columns used when present: Establishment, POS_Station,
              Order_Type, Payment_Type, Discount, Total_Product_Tax.
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
              {/* Duplicate-protection toggle. Default-on. When the user
                  unchecks this, we surface an inline warning so they don't
                  silently double their revenue by re-uploading the same
                  file. The server enforces the actual behavior; this UI is
                  just a clear signal. */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-blue-600"
                />
                <span className="text-sm leading-tight">
                  Replace existing POS sales for this company before import
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Recommended. Deletes this company&apos;s prior{" "}
                    <code>pos_sales_items</code> rows so re-uploading the same
                    file doesn&apos;t double-count.
                  </span>
                </span>
              </label>
              {!replaceExisting && (
                <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Append mode: uploading the same file twice will{" "}
                    <span className="font-medium">
                      duplicate rows and double revenue
                    </span>
                    .
                  </span>
                </div>
              )}
              <Button
                type="submit"
                disabled={!file || submitting}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {submitting
                  ? "Uploading…"
                  : replaceExisting
                    ? "Replace & upload"
                    : "Append upload"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Error display */}
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
              {error.validation_errors &&
                error.validation_errors.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">
                      Row errors ({error.validation_errors.length}):
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                      {error.validation_errors.slice(0, 50).map((e, i) => (
                        <li key={i}>
                          Row {e.rowIndex + 2}: {e.reason}
                          {e.rawOrderNumber
                            ? ` (order ${e.rawOrderNumber})`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </CardContent>
          </Card>
        )}

        {/* Success summary */}
        {summary && (
          <Card className="border-green-200 dark:border-green-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Upload complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {summary.replace_existing && (
                <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
                  Replace mode was active.{" "}
                  <span className="font-medium">
                    {summary.deleted_rows.toLocaleString()} prior row
                    {summary.deleted_rows === 1 ? "" : "s"}
                  </span>{" "}
                  for this company were removed before this import.
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <StatBlock
                  label="Rows inserted"
                  value={summary.inserted_rows.toLocaleString()}
                />
                <StatBlock
                  label="Unique orders"
                  value={summary.unique_orders.toLocaleString()}
                />
                <StatBlock
                  label="Total revenue"
                  value={mxnFmt.format(summary.total_revenue)}
                />
                <StatBlock
                  label="Rows in file"
                  value={summary.total_rows_in_file.toLocaleString()}
                />
                <StatBlock
                  label="Rows deleted"
                  value={summary.deleted_rows.toLocaleString()}
                />
              </div>

              {summary.unmatched_menu_items.length > 0 && (
                <Section
                  label={`Unmatched menu items (${summary.unmatched_menu_items.length})`}
                  hint="Stored as raw_item_name; will not contribute to recipe costing until matched."
                >
                  <ItemList items={summary.unmatched_menu_items} />
                </Section>
              )}

              {summary.unmatched_locations.length > 0 && (
                <Section
                  label={`Unmatched locations (${summary.unmatched_locations.length})`}
                  hint="Stored with location_id NULL. Create matching restaurant_locations rows to associate them."
                >
                  <ItemList items={summary.unmatched_locations} />
                </Section>
              )}

              {summary.validation_errors.length > 0 && (
                <Section
                  label={`Skipped rows (${summary.validation_errors.length})`}
                  hint="These rows were not inserted because they failed validation."
                >
                  <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                    {summary.validation_errors.slice(0, 50).map((e, i) => (
                      <li key={i}>
                        Row {e.rowIndex + 2}: {e.reason}
                        {e.rawOrderNumber ? ` (order ${e.rawOrderNumber})` : ""}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section
                label="Resolved columns"
                hint="How file headers were mapped to logical fields."
              >
                <div className="text-xs font-mono space-y-0.5">
                  {Object.entries(summary.resolved_columns).map(
                    ([logical, actual]) => (
                      <div key={logical} className="flex gap-2">
                        <span className="text-muted-foreground">{logical}</span>
                        <span>→</span>
                        <span>{actual}</span>
                      </div>
                    )
                  )}
                </div>
              </Section>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function ItemList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
      {items.slice(0, 100).map((it) => (
        <Badge key={it} variant="outline" className="text-xs">
          {it}
        </Badge>
      ))}
      {items.length > 100 && (
        <span className="text-xs text-muted-foreground self-center">
          + {items.length - 100} more
        </span>
      )}
    </div>
  );
}
