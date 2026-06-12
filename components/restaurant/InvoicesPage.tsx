// components/restaurant/InvoicesPage.tsx
//
// Client component for /dashboard/restaurant/invoices. Three top-level
// sections:
//
//   1) Invoice list (with action: Review)
//   2) Upload CSV/XLSX (replaces the legacy "soon" placeholder)
//   3) Manual invoice creation
//
// When the user clicks Review on a row, an inline review panel slides in
// under the list with the invoice header, every line, an ingredient-match
// dropdown per line, per-line approve/reject buttons, and a Post Invoice
// CTA. Posting goes through /invoices/:id/approve which writes the cost
// entries.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Upload,
  Plus,
  Receipt,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  FileText,
  Sparkles,
  ImageIcon,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  SupplierInvoiceLine,
  InvoiceEvent,
} from "@/types/supplier-invoices";

// ---------------------------------------------------------------------------
// Shared types (server page → here)
// ---------------------------------------------------------------------------

export interface InvoiceListItem {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number | null;
  status: string;
  source_type: string;
  created_at: string;
  line_counts: {
    total: number;
    matched: number;
    approved: number;
    unmatched: number;
    pending: number;
  };
}

interface IngredientLite {
  id: string;
  name: string;
  default_unit: string | null;
}
interface SupplierLite {
  id: string;
  name: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  needs_review:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200",
  posted:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
};

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "MXN",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InvoicesPage({
  initialInvoices,
  suppliers,
  ingredients: initialIngredients,
}: {
  initialInvoices: InvoiceListItem[];
  suppliers: SupplierLite[];
  ingredients: IngredientLite[];
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>(initialInvoices);
  const [ingredients, setIngredients] =
    useState<IngredientLite[]>(initialIngredients);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Lift the AI extraction draft into the parent so we can collapse the
  // three entry cards into a focused, full-width review when a draft exists.
  const [aiDraft, setAiDraft] = useState<ExtractedDraft | null>(null);
  const [aiDraftMeta, setAiDraftMeta] = useState<{
    fileName: string | null;
    sourceType: "image" | "pdf";
  } | null>(null);

  // Merge a freshly-created ingredient into the catalog so every line on
  // every invoice immediately sees it in the dropdown. The API may also
  // return it after a line save, which goes through here.
  const upsertIngredient = useCallback((ing: IngredientLite) => {
    setIngredients((prev) =>
      prev.some((i) => i.id === ing.id)
        ? prev
        : [...prev, ing].sort((a, b) => a.name.localeCompare(b.name))
    );
  }, []);

  const refreshList = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/restaurant/invoices", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { invoices: InvoiceListItem[] };
      if (Array.isArray(body.invoices)) setInvoices(body.invoices);
    } catch {
      // best-effort
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-6 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Receipt className="h-6 w-6 text-orange-500" />
          <h1 className="text-2xl font-bold tracking-tight">
            Supplier Invoices
          </h1>
          <Badge className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0">
            Stage 2
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1"
            onClick={refreshList}
          >
            <RefreshCw
              className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")}
            />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground -mt-4 max-w-3xl">
          Upload or create supplier invoices, review and match lines to
          ingredients, then post to update cost history. Cost entries are only
          written after you approve and post — bulk cost upload still works as a
          side path.
        </p>

        {/* Entry options OR focused AI extraction review */}
        {aiDraft ? (
          <ExtractedDraftReview
            draft={aiDraft}
            setDraft={setAiDraft}
            meta={aiDraftMeta}
            onDiscard={() => {
              setAiDraft(null);
              setAiDraftMeta(null);
            }}
            onCreated={async (id) => {
              setAiDraft(null);
              setAiDraftMeta(null);
              await refreshList();
              setReviewingId(id);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <UploadCard onUploaded={refreshList} />
            <AIExtractCard
              onExtracted={(draft, meta) => {
                setAiDraft(draft);
                setAiDraftMeta(meta);
              }}
            />
            <ManualCreateCard
              suppliers={suppliers}
              onCreated={async (id) => {
                await refreshList();
                setReviewingId(id);
              }}
            />
          </div>
        )}

        {/* Invoice list */}
        <InvoiceListCard
          invoices={invoices}
          reviewingId={reviewingId}
          onReview={setReviewingId}
        />

        {/* Review detail */}
        {reviewingId && (
          <ReviewDetail
            invoiceId={reviewingId}
            ingredients={ingredients}
            onIngredientCreated={upsertIngredient}
            onClose={() => setReviewingId(null)}
            onChanged={refreshList}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload card
// ---------------------------------------------------------------------------

function UploadCard({
  onUploaded,
}: {
  onUploaded: () => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    total_rows_in_file: number;
    invoices_created: number;
    lines_inserted: number;
    suppliers_created: number;
    auto_matched_lines: number;
    unmatched_lines: number;
    failed_rows?: { rowIndex: number; reason: string; description?: string }[];
  } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/restaurant/invoices/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSummary(body.summary);
      await onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload CSV / XLSX
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="space-y-2">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!file || busy}
            className="bg-orange-500 hover:bg-orange-600 text-white border-0"
          >
            {busy ? "Uploading…" : "Upload invoices"}
          </Button>
        </form>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Expected columns
          </summary>
          <div className="mt-2 space-y-1 text-muted-foreground">
            <p>
              Required: <span className="font-mono">supplier_name</span>,{" "}
              <span className="font-mono">invoice_number</span>,{" "}
              <span className="font-mono">invoice_date</span>,{" "}
              <span className="font-mono">description</span>,{" "}
              <span className="font-mono">quantity</span>,{" "}
              <span className="font-mono">unit</span>,{" "}
              <span className="font-mono">line_total</span>.
            </p>
            <p>
              Optional: <span className="font-mono">due_date</span>,{" "}
              <span className="font-mono">supplier_item_name</span>,{" "}
              <span className="font-mono">supplier_sku</span>,{" "}
              <span className="font-mono">ingredient_name</span>,{" "}
              <span className="font-mono">unit_cost</span>,{" "}
              <span className="font-mono">tax_amount</span>,{" "}
              <span className="font-mono">currency</span>,{" "}
              <span className="font-mono">notes</span>.
            </p>
            <p>
              Rows with the same{" "}
              <span className="font-mono">
                supplier_name + invoice_number + invoice_date
              </span>{" "}
              are grouped into one invoice. New invoices land in{" "}
              <span className="font-mono">needs_review</span>.
            </p>
          </div>
        </details>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {summary && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
            <p>
              <strong>{summary.invoices_created}</strong> invoice
              {summary.invoices_created === 1 ? "" : "s"} created with{" "}
              <strong>{summary.lines_inserted}</strong> line
              {summary.lines_inserted === 1 ? "" : "s"}.
            </p>
            <p className="text-muted-foreground">
              {summary.suppliers_created} new supplier
              {summary.suppliers_created === 1 ? "" : "s"} ·{" "}
              {summary.auto_matched_lines} auto-matched ·{" "}
              {summary.unmatched_lines} unmatched.
            </p>
            {summary.failed_rows && summary.failed_rows.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-amber-600">
                  {summary.failed_rows.length} failed row
                  {summary.failed_rows.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {summary.failed_rows.slice(0, 8).map((f) => (
                    <li key={f.rowIndex} className="text-muted-foreground">
                      Row {f.rowIndex}: {f.reason}
                      {f.description ? ` — ${f.description}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Manual create card
// ---------------------------------------------------------------------------

function ManualCreateCard({
  suppliers,
  onCreated,
}: {
  suppliers: SupplierLite[];
  onCreated: (id: string) => Promise<void> | void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [currency, setCurrency] = useState("MXN");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        invoice_date: invoiceDate,
        invoice_number: invoiceNumber || null,
        currency,
        notes: notes || null,
      };
      if (supplierId) body.supplier_id = supplierId;
      else if (supplierName.trim()) body.supplier_name = supplierName.trim();
      const tot = Number(totalAmount);
      if (Number.isFinite(tot) && tot > 0) body.total_amount = tot;

      const res = await fetch("/api/restaurant/invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reset and surface the new id.
      setInvoiceNumber("");
      setTotalAmount("");
      setNotes("");
      await onCreated(j.invoice.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create invoice manually
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2">
          <label className="col-span-2 text-xs">
            <span className="text-muted-foreground">Supplier</span>
            <select
              className="mt-1 w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={busy}
            >
              <option value="">— New supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!supplierId && (
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="New supplier name"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                disabled={busy}
              />
            )}
          </label>

          <label className="text-xs">
            <span className="text-muted-foreground">Invoice number</span>
            <Input
              className="mt-1 h-8 text-xs"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Invoice date</span>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
              disabled={busy}
            />
          </label>

          <label className="text-xs">
            <span className="text-muted-foreground">Currency</span>
            <Input
              className="mt-1 h-8 text-xs uppercase"
              value={currency}
              onChange={(e) =>
                setCurrency(e.target.value.toUpperCase().slice(0, 3))
              }
              maxLength={3}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Total amount</span>
            <Input
              type="number"
              step="0.01"
              className="mt-1 h-8 text-xs"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="col-span-2 text-xs">
            <span className="text-muted-foreground">Notes</span>
            <Input
              className="mt-1 h-8 text-xs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="col-span-2 flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white border-0"
              disabled={busy}
            >
              {busy ? "Saving…" : "Create invoice"}
            </Button>
            {error && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
          </div>
        </form>
        <p className="text-[11px] text-muted-foreground mt-2">
          Creates a draft header. Add lines from the review panel below.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoice list card
// ---------------------------------------------------------------------------

function InvoiceListCard({
  invoices,
  reviewingId,
  onReview,
}: {
  invoices: InvoiceListItem[];
  reviewingId: string | null;
  onReview: (id: string) => void;
}) {
  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="px-6 py-10 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            No invoices yet
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload a file or create one manually to start tracking supplier
            costs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">
                  Lines (matched / total)
                </th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr
                  key={inv.id}
                  className={
                    (i % 2 === 1 ? "bg-muted/20" : "bg-background") +
                    " border-b border-border last:border-0"
                  }
                >
                  <td className="px-4 py-3">
                    {inv.supplier_name ?? (
                      <span className="text-muted-foreground italic">
                        (no supplier)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {inv.invoice_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDate(inv.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtMoney(inv.total_amount, inv.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[inv.status] ?? ""}`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {inv.line_counts.matched} / {inv.line_counts.total}
                    {inv.line_counts.unmatched > 0 && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        · {inv.line_counts.unmatched} unmatched
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant={reviewingId === inv.id ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() =>
                        onReview(reviewingId === inv.id ? "" : inv.id)
                      }
                    >
                      {reviewingId === inv.id ? "Hide" : "Review"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Review detail
// ---------------------------------------------------------------------------

interface ReviewData {
  invoice: InvoiceListItem & { notes: string | null };
  lines: SupplierInvoiceLine[];
  events: InvoiceEvent[];
}

function ReviewDetail({
  invoiceId,
  ingredients,
  onIngredientCreated,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  ingredients: IngredientLite[];
  onIngredientCreated: (ing: IngredientLite) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postingBusy, setPostingBusy] = useState(false);
  const [postResult, setPostResult] = useState<{
    posted_lines: number;
    skipped_lines: { description: string; reason: string }[];
    next_steps: string;
  } | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurant/invoices/${encodeURIComponent(invoiceId)}`,
        { credentials: "include", cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(body as ReviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Returns true on success so the LineRow can clear local UI state (e.g.
  // close its inline "create new ingredient" sub-form) only when the patch
  // actually went through.
  const patchLine = async (
    lineId: string,
    patch: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/restaurant/invoices/${encodeURIComponent(invoiceId)}/lines`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ line_id: lineId, ...patch }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.error ?? `HTTP ${res.status}`);
        return false;
      }
      // Optimistic merge; also reload events for the timeline.
      setData((cur) =>
        cur
          ? {
              ...cur,
              lines: cur.lines.map((l) =>
                l.id === lineId ? (body.line as SupplierInvoiceLine) : l
              ),
            }
          : cur
      );
      // Newly-created ingredient (from the new_ingredient block) needs to be
      // merged into the parent catalog so other LineRow dropdowns see it.
      if (
        body.created_ingredient &&
        typeof body.created_ingredient === "object" &&
        typeof body.created_ingredient.id === "string" &&
        typeof body.created_ingredient.name === "string"
      ) {
        // We don't know the new ingredient's default_unit from the API
        // response; fall back to the line's unit so the catalog entry is
        // still usable in other dropdowns.
        const lineSnapshot =
          (body.line as SupplierInvoiceLine | undefined) ?? null;
        onIngredientCreated({
          id: body.created_ingredient.id,
          name: body.created_ingredient.name,
          default_unit: lineSnapshot?.unit ?? null,
        });
      }
      void onChanged();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Network error");
      return false;
    }
  };

  const postInvoice = async () => {
    if (!data) return;
    setPostingBusy(true);
    setPostResult(null);
    try {
      const res = await fetch(
        `/api/restaurant/invoices/${encodeURIComponent(invoiceId)}/approve`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setPostResult({
        posted_lines: body.posted_lines ?? 0,
        skipped_lines: body.skipped_lines ?? [],
        next_steps: body.next_steps ?? "",
      });
      await load();
      void onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Network error");
    } finally {
      setPostingBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="px-6 py-6 text-sm text-muted-foreground">
          Loading invoice…
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="px-6 py-6 text-sm text-red-600 dark:text-red-400">
          {error ?? "Could not load invoice"}
        </CardContent>
      </Card>
    );
  }

  const inv = data.invoice;
  const lines = data.lines;
  const approvedMatched = lines.filter(
    (l) =>
      l.review_status === "approved" &&
      (l.match_status === "matched" || l.match_status === "auto_matched")
  );
  const canPost = inv.status !== "posted" && approvedMatched.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-500" />
            {inv.supplier_name ?? "(no supplier)"} ·{" "}
            <span className="font-mono">{inv.invoice_number ?? "—"}</span>
            <span
              className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[inv.status] ?? ""}`}
            >
              {inv.status}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setShowEvents((v) => !v)}
            >
              {showEvents ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              History
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Header summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Date</div>
            <div>{fmtDate(inv.invoice_date)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Due</div>
            <div>{inv.due_date ? fmtDate(inv.due_date) : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Total</div>
            <div className="font-mono">
              {fmtMoney(inv.total_amount, inv.currency)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Source</div>
            <div className="font-mono">{inv.source_type}</div>
          </div>
        </div>

        {/* Add-line + lines table */}
        <AddLineForm
          invoiceId={invoiceId}
          ingredients={ingredients}
          onAdded={(line, createdIngredient) => {
            setData((cur) =>
              cur ? { ...cur, lines: [...cur.lines, line] } : cur
            );
            if (createdIngredient) onIngredientCreated(createdIngredient);
          }}
          disabled={inv.status === "posted"}
        />

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No lines yet. Add one above or upload a CSV/XLSX.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Ingredient</th>
                  <th className="px-2 py-2 font-medium text-right">Qty</th>
                  <th className="px-2 py-2 font-medium">Unit</th>
                  <th className="px-2 py-2 font-medium text-right">
                    Unit cost
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    Line total
                  </th>
                  <th className="px-2 py-2 font-medium">Review</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    ingredients={ingredients}
                    striped={idx % 2 === 1}
                    disabled={inv.status === "posted"}
                    onChange={(patch) => patchLine(line.id, patch)}
                    currency={inv.currency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Post invoice CTA */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {approvedMatched.length} of {lines.length} line
            {lines.length === 1 ? "" : "s"} ready to post.
          </div>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white border-0"
            onClick={postInvoice}
            disabled={!canPost || postingBusy}
            title={
              !canPost
                ? "Approve and match at least one line first"
                : "Write ingredient_cost_entries and mark invoice posted"
            }
          >
            {postingBusy ? "Posting…" : "Post invoice"}
          </Button>
        </div>

        {postResult && (
          <div className="rounded-md border border-green-300 dark:border-green-900 bg-green-50 dark:bg-green-900/20 p-3 text-xs space-y-2">
            <p className="font-medium text-green-800 dark:text-green-200">
              Posted {postResult.posted_lines} cost{" "}
              {postResult.posted_lines === 1 ? "entry" : "entries"}.
            </p>
            {postResult.skipped_lines.length > 0 && (
              <details>
                <summary className="cursor-pointer text-amber-700 dark:text-amber-300">
                  {postResult.skipped_lines.length} line
                  {postResult.skipped_lines.length === 1 ? "" : "s"} skipped
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {postResult.skipped_lines.map((s, i) => (
                    <li key={i} className="text-muted-foreground">
                      {s.description}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-foreground/80">
              {postResult.next_steps}{" "}
              <Link
                className="text-orange-600 dark:text-orange-300 hover:underline"
                href="/dashboard/restaurant/agents"
              >
                Open Agent Control Center →
              </Link>
            </p>
          </div>
        )}

        {/* Event history */}
        {showEvents && (
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5 text-xs">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Event history
            </p>
            {data.events.length === 0 ? (
              <p className="text-muted-foreground">
                No events yet for this invoice.
              </p>
            ) : (
              <ol className="border-l-2 border-border pl-3 space-y-1.5">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{e.event_type}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(e.created_at).toLocaleString("es-MX", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {e.note && (
                      <p className="text-[11px] italic text-muted-foreground">
                        “{e.note}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Line row + add-line form
// ---------------------------------------------------------------------------

const REVIEW_STYLE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200",
};

function LineRow({
  line,
  ingredients,
  striped,
  disabled,
  onChange,
  currency,
}: {
  line: SupplierInvoiceLine;
  ingredients: IngredientLite[];
  striped: boolean;
  disabled: boolean;
  /** Returns true when the patch was accepted by the server, so inline
   *  sub-forms can clean up their local state only on success. */
  onChange: (patch: Record<string, unknown>) => Promise<boolean> | void;
  currency: string;
}) {
  const ingredientName = line.ingredient_id
    ? (ingredients.find((i) => i.id === line.ingredient_id)?.name ?? null)
    : null;
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);

  // Prefill the inline-create fields from the line itself the first time the
  // user opens it. Subsequent toggles preserve whatever they typed.
  const openInlineCreate = () => {
    setNewName((cur) => cur || line.description || "");
    setNewUnit((cur) => cur || line.unit || "");
    setCreatingNew(true);
  };
  const cancelInlineCreate = () => {
    setCreatingNew(false);
  };
  const submitInlineCreate = async () => {
    if (!newName.trim() || !newUnit.trim()) return;
    setCreating(true);
    try {
      const ok = await Promise.resolve(
        onChange({
          new_ingredient: {
            name: newName.trim(),
            default_unit: newUnit.trim(),
            category: newCategory.trim() || null,
          },
        })
      );
      if (ok !== false) {
        setCreatingNew(false);
        setNewName("");
        setNewUnit("");
        setNewCategory("");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <tr className={(striped ? "bg-muted/15" : "") + " border-b border-border"}>
      <td className="px-2 py-2 max-w-[260px]">
        <div className="truncate font-medium" title={line.description}>
          {line.description}
        </div>
        {(line.supplier_sku || line.supplier_item_name) && (
          <div className="text-[10px] text-muted-foreground">
            {[line.supplier_sku, line.supplier_item_name]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </td>
      <td className="px-2 py-2 min-w-[220px] max-w-[280px]">
        {ingredientName ? (
          <div className="space-y-1">
            <div
              className="text-xs font-medium truncate"
              title={ingredientName}
            >
              {ingredientName}
            </div>
            <select
              className="h-6 text-[11px] rounded border border-border bg-background px-1 w-full"
              value={line.ingredient_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === INGREDIENT_PICK_NEW) {
                  openInlineCreate();
                  return;
                }
                void onChange({ ingredient_id: v || null });
              }}
              disabled={disabled || creatingNew}
              aria-label="Change matched ingredient"
            >
              <option value="">— Unmatch —</option>
              <option value={INGREDIENT_PICK_NEW}>
                + Create new ingredient
              </option>
              {ingredients.length > 0 && (
                <optgroup label="Existing">
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <span className="inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Unmatched
            </span>
            <select
              className="h-6 text-[11px] rounded border border-border bg-background px-1 w-full"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === INGREDIENT_PICK_NEW) {
                  openInlineCreate();
                  return;
                }
                void onChange({ ingredient_id: v || null });
              }}
              disabled={disabled || creatingNew}
              aria-label="Match to ingredient"
            >
              <option value="">— Pick ingredient —</option>
              <option value={INGREDIENT_PICK_NEW}>
                + Create new ingredient
              </option>
              {ingredients.length > 0 && (
                <optgroup label="Existing">
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {creatingNew && !disabled && (
          <div className="mt-2 rounded border border-orange-200 dark:border-orange-900/40 bg-orange-50/40 dark:bg-orange-900/10 p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Create new ingredient
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Ingredient name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
            <Input
              className="h-7 text-xs"
              placeholder="Default unit (kg, l, unit…)"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              disabled={creating}
            />
            <Input
              className="h-7 text-xs"
              placeholder="Category (optional)"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              disabled={creating}
            />
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] bg-orange-500 hover:bg-orange-600 text-white border-0"
                onClick={submitInlineCreate}
                disabled={creating || !newName.trim() || !newUnit.trim()}
                title="Create the ingredient and match this line to it"
              >
                {creating ? "Creating…" : "Create & match"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={cancelInlineCreate}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{line.quantity}</td>
      <td className="px-2 py-2">{line.unit}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {line.unit_cost !== null ? fmtMoney(line.unit_cost, currency) : "—"}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {fmtMoney(line.line_total, currency)}
      </td>
      <td className="px-2 py-2">
        <span
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${REVIEW_STYLE[line.review_status] ?? ""}`}
        >
          {line.review_status}
        </span>
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          {line.review_status !== "approved" && (
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[10px] bg-green-600 hover:bg-green-700 text-white border-0"
              onClick={() => onChange({ review_status: "approved" })}
              disabled={disabled}
              title="Approve line"
            >
              <CheckCircle2 className="h-3 w-3" />
            </Button>
          )}
          {line.review_status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => onChange({ review_status: "rejected" })}
              disabled={disabled}
              title="Reject line"
            >
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {line.review_status !== "pending" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => onChange({ review_status: "pending" })}
              disabled={disabled}
              title="Reset to pending"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Add-line form
//
// The ingredient selector mirrors the supplier picker on the manual create
// card: three modes, picked via a single select.
//   * existing id    — set ingredient_id on the line (match_status='matched')
//   * "Create new"   — show inline name/unit/category fields; the API
//                      autocreates the ingredient (and upserts the
//                      supplier_ingredients link when the invoice has a
//                      supplier) before saving the line
//   * "Leave unmatched" — line saved without an ingredient_id
//                         (match_status='unmatched')
// ---------------------------------------------------------------------------

const INGREDIENT_PICK_UNMATCHED = "__unmatched__";
const INGREDIENT_PICK_NEW = "__new__";

function AddLineForm({
  invoiceId,
  ingredients,
  onAdded,
  disabled,
}: {
  invoiceId: string;
  ingredients: IngredientLite[];
  onAdded: (
    line: SupplierInvoiceLine,
    createdIngredient: IngredientLite | null
  ) => void;
  disabled: boolean;
}) {
  // Ingredient selector — defaults to "Unmatched" so accidental Saves don't
  // silently match to whatever's first in the list.
  const [pick, setPick] = useState<string>(INGREDIENT_PICK_UNMATCHED);
  // Create-new sub-form
  const [newName, setNewName] = useState("");
  const [newDefaultUnit, setNewDefaultUnit] = useState("");
  const [newCategory, setNewCategory] = useState("");
  // Line fields
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [lineTotal, setLineTotal] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierItemName, setSupplierItemName] = useState("");
  const [supplierSku, setSupplierSku] = useState("");
  const [notes, setNotes] = useState("");
  // UX
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreatingNew = pick === INGREDIENT_PICK_NEW;
  const isExistingPick =
    pick !== INGREDIENT_PICK_UNMATCHED && pick !== INGREDIENT_PICK_NEW;

  // Auto-fill the line's unit from the picked ingredient's default unit, so
  // the most common case (one-click pick) doesn't need re-typing. Only fills
  // when the user hasn't already entered a unit.
  const onPickChange = (value: string) => {
    setPick(value);
    if (
      value !== INGREDIENT_PICK_UNMATCHED &&
      value !== INGREDIENT_PICK_NEW &&
      !unit
    ) {
      const ing = ingredients.find((i) => i.id === value);
      if (ing?.default_unit) setUnit(ing.default_unit);
    }
  };

  const reset = () => {
    setPick(INGREDIENT_PICK_UNMATCHED);
    setNewName("");
    setNewDefaultUnit("");
    setNewCategory("");
    setDescription("");
    setQuantity("");
    setUnit("");
    setLineTotal("");
    setUnitCost("");
    setSupplierItemName("");
    setSupplierSku("");
    setNotes("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Validate create-new sub-form up front so the API doesn't have to.
    if (isCreatingNew && !newName.trim()) {
      setError("New ingredient name is required.");
      setBusy(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        description,
        quantity: Number(quantity),
        unit,
        line_total: Number(lineTotal),
      };
      if (unitCost) {
        const n = Number(unitCost);
        if (Number.isFinite(n)) body.unit_cost = n;
      }
      if (supplierItemName.trim())
        body.supplier_item_name = supplierItemName.trim();
      if (supplierSku.trim()) body.supplier_sku = supplierSku.trim();
      if (notes.trim()) body.notes = notes.trim();

      if (isExistingPick) {
        body.ingredient_id = pick;
      } else if (isCreatingNew) {
        body.new_ingredient = {
          name: newName.trim(),
          // Fall back to the line's unit when default_unit is left blank.
          default_unit: newDefaultUnit.trim() || unit,
          category: newCategory.trim() || null,
        };
      }
      // else: leave unmatched — no ingredient fields in the payload.

      const res = await fetch(
        `/api/restaurant/invoices/${encodeURIComponent(invoiceId)}/lines`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`);
        return;
      }
      const created: IngredientLite | null =
        j.created_ingredient && typeof j.created_ingredient === "object"
          ? {
              id: j.created_ingredient.id as string,
              name: j.created_ingredient.name as string,
              // The API doesn't echo the default_unit we just created with;
              // fall back to what the user typed so the dropdown looks right.
              default_unit: newDefaultUnit.trim() || unit || null,
            }
          : null;
      onAdded(j.line as SupplierInvoiceLine, created);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (disabled) return null;

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border bg-muted/15 p-3 space-y-3 text-xs"
    >
      {/* Row 1: Ingredient selector (+ inline create-new fields) */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <label className="md:col-span-2">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Ingredient
          </span>
          <select
            className="mt-1 h-7 text-xs w-full rounded-md border border-border bg-background px-2"
            value={pick}
            onChange={(e) => onPickChange(e.target.value)}
          >
            <option value={INGREDIENT_PICK_UNMATCHED}>
              — Leave unmatched —
            </option>
            <option value={INGREDIENT_PICK_NEW}>+ Create new ingredient</option>
            {ingredients.length > 0 && (
              <optgroup label="Existing">
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {isCreatingNew && (
          <>
            <label className="md:col-span-2">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                New ingredient name
              </span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Aceite de oliva"
                required
              />
            </label>
            <label>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                Default unit
              </span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newDefaultUnit}
                onChange={(e) => setNewDefaultUnit(e.target.value)}
                placeholder="kg / l / unit"
              />
            </label>
            <label>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                Category (optional)
              </span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Produce, Dairy…"
              />
            </label>
          </>
        )}
      </div>

      {/* Row 2: Description spans wide */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <label className="md:col-span-6">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Description (invoice line text)
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isExistingPick
                ? "Optional — defaults to ingredient name on the invoice line"
                : "e.g. Cebolla blanca 5 kg saco"
            }
            required
          />
        </label>
      </div>

      {/* Row 3: numerics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Qty
          </span>
          <Input
            type="number"
            step="0.0001"
            className="mt-1 h-7 text-xs"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Unit
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            required
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Unit cost
          </span>
          <Input
            type="number"
            step="0.0001"
            className="mt-1 h-7 text-xs"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Line total
          </span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={lineTotal}
            onChange={(e) => setLineTotal(e.target.value)}
            required
          />
        </label>
        <label className="md:col-span-2">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Supplier item name (optional)
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={supplierItemName}
            onChange={(e) => setSupplierItemName(e.target.value)}
          />
        </label>
      </div>

      {/* Row 4: SKU + notes */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <label className="md:col-span-2">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Supplier SKU (optional)
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={supplierSku}
            onChange={(e) => setSupplierSku(e.target.value)}
          />
        </label>
        <label className="md:col-span-4">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Notes (optional)
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={busy}
        >
          <Plus className="h-3.5 w-3.5" />
          {busy ? "Adding…" : "Add line"}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {isCreatingNew
            ? "A new ingredient will be created and linked to this supplier."
            : isExistingPick
              ? "Line will be marked matched."
              : "Line will be marked unmatched. You can match it later."}
        </span>
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 ml-auto">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AI extract card (Stage 2)
//
// This card owns ONLY the upload step. On success it hands the enriched
// draft up to the parent, which collapses the entry cards and renders a
// full-width <ExtractedDraftReview /> in their place.
//
// No DB writes happen here — see /api/restaurant/invoices/extract.
// ---------------------------------------------------------------------------

interface ExtractedLineDraft {
  description: string;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  line_total: number | null;
  tax_amount: number | null;
  // Optional model-reported per-line confidence.
  confidence?: "high" | "medium" | "low" | null;
  confidence_notes?: string | null;
  // Server-side enrichment flags.
  missing_description?: boolean;
  missing_quantity?: boolean;
  missing_unit?: boolean;
  missing_line_total?: boolean;
  derived_unit_cost?: boolean;
  derived_line_total?: boolean;
  low_confidence?: boolean;
}
interface ExtractedDraft {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  lines: ExtractedLineDraft[];
  confidence_notes: string[];
}

function lineNeedsReview(line: ExtractedLineDraft): boolean {
  if (
    line.missing_description ||
    line.missing_quantity ||
    line.missing_unit ||
    line.missing_line_total
  ) {
    return true;
  }
  // Fallback when flags weren't supplied (older client/server combos).
  if (!line.description || line.description.trim() === "") return true;
  if (line.quantity === null || line.quantity <= 0) return true;
  if (!line.unit) return true;
  if (line.line_total === null) return true;
  return false;
}

function AIExtractCard({
  onExtracted,
}: {
  onExtracted: (
    draft: ExtractedDraft,
    meta: { fileName: string | null; sourceType: "image" | "pdf" }
  ) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setExtracting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/restaurant/invoices/extract", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      onExtracted(body.extraction as ExtractedDraft, {
        fileName: (body.original_file_name as string | null) ?? file.name,
        sourceType: (body.source_type as "image" | "pdf") ?? "image",
      });
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card className="border-orange-200 dark:border-orange-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-500" />
          Upload invoice PDF or image
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Milton will extract invoice fields for review. Nothing updates costs
          until you post the reviewed invoice.
        </p>
        <form onSubmit={onExtract} className="space-y-2">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={extracting}
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white border-0"
              disabled={!file || extracting}
            >
              {extracting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
                  Extracting…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Extract with AI
                </>
              )}
            </Button>
            <span className="text-[10px] text-muted-foreground">
              PNG / JPG / WEBP up to 10 MB.
              <br />
              PDF support is coming next.
            </span>
          </div>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Full-width AI extraction review
//
// Mounted in place of the three entry cards once a draft exists. Owns its
// own "create invoice" request; bubbles success up to the parent so the
// list can refresh and switch to the standard review panel.
// ---------------------------------------------------------------------------

function ExtractedDraftReview({
  draft,
  setDraft,
  meta,
  onDiscard,
  onCreated,
}: {
  draft: ExtractedDraft;
  setDraft: (next: ExtractedDraft) => void;
  meta: { fileName: string | null; sourceType: "image" | "pdf" } | null;
  onDiscard: () => void;
  onCreated: (id: string) => Promise<void> | void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/invoices/from-extraction", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extraction: draft,
          original_file_name: meta?.fileName ?? null,
          source_type: meta?.sourceType ?? "image",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const id = body?.invoice?.id as string | undefined;
      if (id) {
        await onCreated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="border-orange-200 dark:border-orange-900/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-500" />
            Review extracted invoice
            {meta?.fileName && (
              <span className="text-[11px] font-normal text-muted-foreground font-mono">
                · {meta.fileName}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onDiscard}
              disabled={creating}
            >
              Back to upload options
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onDiscard}
              disabled={creating}
            >
              Discard draft
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white border-0"
              onClick={onCreate}
              disabled={creating}
            >
              <ImageIcon className="h-3.5 w-3.5 mr-1" />
              {creating ? "Creating…" : "Create invoice for review"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ExtractedDraftBody draft={draft} setDraft={setDraft} error={error} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editable extracted-draft body (header grid + lines table)
//
// Used by ExtractedDraftReview. Kept as its own component so the markup is
// easier to read.
// ---------------------------------------------------------------------------

function ExtractedDraftBody({
  draft,
  setDraft,
  error,
}: {
  draft: ExtractedDraft;
  setDraft: (next: ExtractedDraft) => void;
  error: string | null;
}) {
  const setHeader = <K extends keyof ExtractedDraft>(
    key: K,
    value: ExtractedDraft[K]
  ) => setDraft({ ...draft, [key]: value });

  const setLine = (i: number, patch: Partial<ExtractedLineDraft>) => {
    const next = draft.lines.slice();
    next[i] = { ...next[i], ...patch };
    setDraft({ ...draft, lines: next });
  };
  const removeLine = (i: number) => {
    const next = draft.lines.slice();
    next.splice(i, 1);
    setDraft({ ...draft, lines: next });
  };

  const numOrNull = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const strOrNull = (s: string): string | null => (s.trim() === "" ? null : s);

  const needsReviewCount = draft.lines.filter(lineNeedsReview).length;

  return (
    <div className="space-y-3">
      {/* Banner */}
      <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          AI extraction is a draft. Review all fields before creating the
          invoice.
          {needsReviewCount > 0 && (
            <span className="ml-1 font-medium">
              {needsReviewCount} line{needsReviewCount === 1 ? "" : "s"} need
              attention.
            </span>
          )}
        </span>
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <label className="col-span-2 md:col-span-1">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Supplier name
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={draft.supplier_name ?? ""}
            onChange={(e) =>
              setHeader("supplier_name", strOrNull(e.target.value))
            }
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Invoice number
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={draft.invoice_number ?? ""}
            onChange={(e) =>
              setHeader("invoice_number", strOrNull(e.target.value))
            }
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Currency
          </span>
          <Input
            className="mt-1 h-7 text-xs uppercase"
            value={draft.currency ?? ""}
            maxLength={3}
            onChange={(e) =>
              setHeader("currency", strOrNull(e.target.value.toUpperCase()))
            }
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Invoice date
          </span>
          <Input
            type="date"
            className="mt-1 h-7 text-xs"
            value={draft.invoice_date ?? ""}
            onChange={(e) =>
              setHeader("invoice_date", strOrNull(e.target.value))
            }
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Due date
          </span>
          <Input
            type="date"
            className="mt-1 h-7 text-xs"
            value={draft.due_date ?? ""}
            onChange={(e) => setHeader("due_date", strOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Subtotal
          </span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={draft.subtotal ?? ""}
            onChange={(e) => setHeader("subtotal", numOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Tax
          </span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={draft.tax_amount ?? ""}
            onChange={(e) => setHeader("tax_amount", numOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Total
          </span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={draft.total_amount ?? ""}
            onChange={(e) =>
              setHeader("total_amount", numOrNull(e.target.value))
            }
          />
        </label>
      </div>

      {/* Lines */}
      <div className="rounded-md border border-border bg-background">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Extracted lines ({draft.lines.length})</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] gap-1"
            onClick={() =>
              setDraft({
                ...draft,
                lines: [
                  ...draft.lines,
                  {
                    description: "",
                    supplier_item_name: null,
                    supplier_sku: null,
                    quantity: null,
                    unit: null,
                    unit_cost: null,
                    line_total: null,
                    tax_amount: null,
                    confidence: null,
                    confidence_notes: null,
                    missing_description: true,
                    missing_quantity: true,
                    missing_unit: true,
                    missing_line_total: true,
                    derived_unit_cost: false,
                    derived_line_total: false,
                    low_confidence: true,
                  },
                ],
              })
            }
          >
            <Plus className="h-3 w-3" />
            Add row
          </Button>
        </div>
        {draft.lines.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-3">
            No lines detected. Use “Add row” or upload a clearer image.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium w-[110px]">SKU</th>
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium w-[160px]">
                    Supplier item name
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[80px]">
                    Qty
                  </th>
                  <th className="px-2 py-1.5 font-medium w-[70px]">Unit</th>
                  <th className="px-2 py-1.5 font-medium text-right w-[100px]">
                    Unit cost
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[110px]">
                    Line total
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[90px]">
                    Tax
                  </th>
                  <th className="px-2 py-1.5 font-medium w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, i) => {
                  const needs = lineNeedsReview(line);
                  return (
                    <tr
                      key={i}
                      className={
                        "border-b border-border align-top " +
                        (needs
                          ? "bg-amber-50/40 dark:bg-amber-900/10"
                          : i % 2 === 1
                            ? "bg-muted/10"
                            : "")
                      }
                    >
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs font-mono"
                          value={line.supplier_sku ?? ""}
                          onChange={(e) =>
                            setLine(i, {
                              supplier_sku: strOrNull(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs"
                          value={line.description}
                          onChange={(e) =>
                            setLine(i, { description: e.target.value })
                          }
                        />
                        <LineBadges line={line} needs={needs} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs"
                          value={line.supplier_item_name ?? ""}
                          onChange={(e) =>
                            setLine(i, {
                              supplier_item_name: strOrNull(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          step="0.0001"
                          className="h-7 text-xs text-right"
                          value={line.quantity ?? ""}
                          onChange={(e) =>
                            setLine(i, { quantity: numOrNull(e.target.value) })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs"
                          value={line.unit ?? ""}
                          onChange={(e) =>
                            setLine(i, { unit: strOrNull(e.target.value) })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          step="0.0001"
                          className="h-7 text-xs text-right"
                          value={line.unit_cost ?? ""}
                          onChange={(e) =>
                            setLine(i, {
                              unit_cost: numOrNull(e.target.value),
                              derived_unit_cost: false,
                            })
                          }
                        />
                        {line.derived_unit_cost && (
                          <span className="inline-flex items-center text-[9px] uppercase tracking-wide mt-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                            Derived
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-7 text-xs text-right"
                          value={line.line_total ?? ""}
                          onChange={(e) =>
                            setLine(i, {
                              line_total: numOrNull(e.target.value),
                              derived_line_total: false,
                            })
                          }
                        />
                        {line.derived_line_total && (
                          <span className="inline-flex items-center text-[9px] uppercase tracking-wide mt-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                            Derived
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-7 text-xs text-right"
                          value={line.tax_amount ?? ""}
                          onChange={(e) =>
                            setLine(i, {
                              tax_amount: numOrNull(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => removeLine(i)}
                          title="Remove line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confidence notes from the model */}
      {draft.confidence_notes.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            AI confidence notes ({draft.confidence_notes.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {draft.confidence_notes.map((n, i) => (
              <li key={i} className="text-muted-foreground italic">
                · {n}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Lines land in <span className="font-mono">needs_review</span> after you
        create the invoice. Cost entries are only written when you post the
        invoice in the review panel below.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-line badges
// ---------------------------------------------------------------------------

function LineBadges({
  line,
  needs,
}: {
  line: ExtractedLineDraft;
  needs: boolean;
}) {
  const chips: React.ReactNode[] = [];
  if (needs) {
    chips.push(
      <span
        key="needs"
        className="inline-flex items-center text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      >
        Needs review
      </span>
    );
  }
  if (line.confidence === "low") {
    chips.push(
      <span
        key="low"
        className="inline-flex items-center text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200"
        title={line.confidence_notes ?? undefined}
      >
        Low confidence
      </span>
    );
  } else if (line.confidence === "medium") {
    chips.push(
      <span
        key="medium"
        className="inline-flex items-center text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        title={line.confidence_notes ?? undefined}
      >
        Medium confidence
      </span>
    );
  } else if (line.confidence === "high") {
    chips.push(
      <span
        key="high"
        className="inline-flex items-center text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
        title={line.confidence_notes ?? undefined}
      >
        High confidence
      </span>
    );
  }
  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1 mt-1">{chips}</div>;
}
