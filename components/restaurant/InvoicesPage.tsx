// components/restaurant/InvoicesPage.tsx
//
// Client component for Costos › Compras (was /dashboard/restaurant/invoices). Three top-level
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
import { useRouter } from "next/navigation";
import { markTabsStale } from "@/lib/restaurant/recipe-costing/menu-tab-cache";
import { SortTh } from "@/components/restaurant/sort/SortTh";
import { useTableSort } from "@/components/restaurant/sort/use-table-sort";
import { sortRows, type SortValue } from "@/lib/restaurant/table-sort";
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

import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import { INVOICE_UPLOAD_ANCHOR } from "@/lib/restaurant/costs-tabs";
import type {
  SupplierInvoiceLine,
  InvoiceEvent,
} from "@/types/supplier-invoices";

// ---------------------------------------------------------------------------
// Local UI primitives (match the redesigned app look)
// ---------------------------------------------------------------------------

const CARD_CLS = "rounded-[14px] border border-[#eef0f4] bg-white";
const CARD_TITLE_CLS =
  "text-[13px] font-bold text-[#151c2c] flex items-center gap-2";
const INPUT_CLS =
  "w-full rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] text-[#151c2c] focus:border-[#1B40C8] focus:outline-none focus:ring-2 focus:ring-[#c6d3f5] disabled:opacity-60";
const SELECT_CLS =
  "w-full h-9 rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] text-[#151c2c] focus:border-[#1B40C8] focus:outline-none focus:ring-2 focus:ring-[#c6d3f5] disabled:opacity-60";
const SELECT_SM_CLS =
  "w-full h-8 rounded-lg border border-[#e3e7ee] bg-white px-2 text-xs text-[#151c2c] focus:border-[#1B40C8] focus:outline-none focus:ring-2 focus:ring-[#c6d3f5] disabled:opacity-60";
const LABEL_CLS = "text-xs font-semibold text-[#6b7385]";
const BADGE_CLS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

function Card({
  className = "",
  flush = false,
  children,
}: {
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${CARD_CLS} ${flush ? "" : "px-4 py-3.5"} ${className}`}
    >
      {children}
    </section>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={CARD_TITLE_CLS}>{children}</h3>;
}

/** Text input. Call sites that pass `h-7`/`h-8` get the compact (32px) height. */
function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const compact = /\bh-[78]\b/.test(className);
  const extra = className.replace(/\bh-[78]\b|\btext-xs\b/g, "").trim();
  return (
    <input
      className={`${INPUT_CLS} ${compact ? "h-8" : "h-9"} ${extra}`}
      {...props}
    />
  );
}

type BtnVariant = "primary" | "secondary" | "danger";

/** Brand button: one primary per card, everything else secondary / danger. */
function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "md" | "sm" | "icon";
}) {
  const v =
    variant === "primary"
      ? "bg-[#1B40C8] text-white hover:bg-[#1535a6] disabled:bg-[#b9c7f0] disabled:text-white"
      : variant === "danger"
        ? "border border-red-500 bg-white text-red-600 hover:bg-red-50 disabled:border-red-200 disabled:text-red-200"
        : "border border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#f6f8fe] disabled:border-[#b9c7f0] disabled:text-[#b9c7f0]";
  const sz =
    size === "icon"
      ? "h-8 w-8 p-0"
      : size === "sm"
        ? "h-8 px-2.5"
        : "h-9 px-3.5";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1 rounded-lg text-[13px] font-semibold transition-colors disabled:cursor-not-allowed ${sz} ${v} ${className}`}
      {...props}
    />
  );
}

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

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  needs_review: "Por revisar",
  approved: "Aprobada",
  rejected: "Rechazada",
  posted: "Publicada",
};
const SOURCE_LABEL: Record<string, string> = {
  csv: "CSV",
  xlsx: "Excel",
  manual: "Manual",
  image: "Foto",
  pdf: "PDF",
};
const statusLabel = (st: string) => STATUS_LABEL[st] ?? st;

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  needs_review: "bg-gray-100 text-gray-700",
  approved: "bg-[#eef2fd] text-[#1B40C8]",
  rejected: "bg-red-100 text-red-700",
  posted: "bg-green-100 text-green-800",
};

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = "es-MX";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${safe}`;
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
  companyCurrency = "USD",
  canEditPrices = true,
}: {
  initialInvoices: InvoiceListItem[];
  suppliers: SupplierLite[];
  ingredients: IngredientLite[];
  companyCurrency?: string;
  /** The server's can("prices.edit") answer; false = read-only. */
  canEditPrices?: boolean;
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

  // Rendered inside Costos › Compras (R1-09b): no page header here.
  return (
    <div className="w-full">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={refreshList}
            disabled={refreshing}
          >
            <RefreshCw
              className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")}
            />
            Actualizar
          </Button>
        </div>

        {/* Entry options OR focused AI extraction review */}
        {!canEditPrices ? (
          <p data-testid="prices-readonly" className="text-xs text-[#6b7280]">
            {CAPABILITY_MESSAGES["prices.edit"]}
          </p>
        ) : aiDraft ? (
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
          <div
            id={INVOICE_UPLOAD_ANCHOR}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 scroll-mt-4"
          >
            <UploadCard onUploaded={refreshList} />
            <AIExtractCard
              onExtracted={(draft, meta) => {
                setAiDraft(draft);
                setAiDraftMeta(meta);
              }}
            />
            <ManualCreateCard
              suppliers={suppliers}
              companyCurrency={companyCurrency}
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
            canEdit={canEditPrices}
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
    default_currency?: string;
    currency_mismatch_rows?: number;
    warning?: string;
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
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-2.5">
        <CardTitle>
          <Upload className="h-4 w-4 text-[#1B40C8]" /> Subir CSV / Excel{" "}
        </CardTitle>{" "}
      </div>{" "}
      <div className="space-y-3">
        <p className="text-xs text-[#6b7385]">
          Sube un archivo con tus facturas de proveedores. Se crean como
          borradores para que las revises.{" "}
        </p>
        <form onSubmit={onSubmit} className="space-y-2">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <Button type="submit" disabled={!file || busy}>
            {busy ? "Subiendo…" : "Subir facturas"}
          </Button>
        </form>
        <details className="text-xs">
          <summary className="cursor-pointer text-[#6b7385]">
            Columnas esperadas
          </summary>
          <div className="mt-2 space-y-1 text-[#6b7385]">
            <p>
              Obligatorias: <span className="font-mono">supplier_name</span>,{" "}
              <span className="font-mono">invoice_number</span>,{" "}
              <span className="font-mono">invoice_date</span>,{" "}
              <span className="font-mono">description</span>,{" "}
              <span className="font-mono">quantity</span>,{" "}
              <span className="font-mono">unit</span>,{" "}
              <span className="font-mono">line_total</span>.
            </p>
            <p>
              Opcionales: <span className="font-mono">due_date</span>,{" "}
              <span className="font-mono">supplier_item_name</span>,{" "}
              <span className="font-mono">supplier_sku</span>,{" "}
              <span className="font-mono">ingredient_name</span>,{" "}
              <span className="font-mono">unit_cost</span>,{" "}
              <span className="font-mono">tax_amount</span>,{" "}
              <span className="font-mono">currency</span>,{" "}
              <span className="font-mono">notes</span>.
            </p>
            <p>
              Las filas con el mismo{" "}
              <span className="font-mono">
                supplier_name + invoice_number + invoice_date
              </span>{" "}
              se agrupan en una sola factura. Las facturas nuevas quedan en
              estado <strong>Por revisar</strong>. Los nombres de las columnas
              van en inglés porque el archivo los necesita así.
            </p>
          </div>
        </details>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {summary && (
          <div className="rounded-lg border border-[#eef0f4] bg-[#f9fafc] p-3 text-xs space-y-1">
            <p>
              <strong>{summary.invoices_created}</strong>{" "}
              {summary.invoices_created === 1
                ? "factura creada"
                : "facturas creadas"}{" "}
              con <strong>{summary.lines_inserted}</strong>{" "}
              {summary.lines_inserted === 1 ? "línea" : "líneas"}.
            </p>
            <p className="text-[#6b7385]">
              {summary.suppliers_created}{" "}
              {summary.suppliers_created === 1
                ? "proveedor nuevo"
                : "proveedores nuevos"}{" "}
              · {summary.auto_matched_lines} con coincidencia automática ·{" "}
              {summary.unmatched_lines} sin coincidencia
              {summary.default_currency
                ? ` · moneda ${summary.default_currency}`
                : ""}
              .
            </p>
            {summary.warning && (
              <p className="text-[#6b7385]">{summary.warning}</p>
            )}
            {summary.failed_rows && summary.failed_rows.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-gray-500">
                  {summary.failed_rows.length}{" "}
                  {summary.failed_rows.length === 1
                    ? "fila con error"
                    : "filas con error"}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {summary.failed_rows.slice(0, 8).map((f) => (
                    <li key={f.rowIndex} className="text-[#6b7385]">
                      Fila {f.rowIndex}: {f.reason}
                      {f.description ? ` — ${f.description}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}{" "}
      </div>{" "}
    </Card>
  );
} // ---------------------------------------------------------------------------
// Manual create card
// ---------------------------------------------------------------------------

function ManualCreateCard({
  suppliers,
  companyCurrency,
  onCreated,
}: {
  suppliers: SupplierLite[];
  companyCurrency: string;
  onCreated: (id: string) => Promise<void> | void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [currency, setCurrency] = useState(companyCurrency);
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
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-2.5">
        <CardTitle>
          <Plus className="h-4 w-4 text-[#1B40C8]" /> Crear factura a mano{" "}
        </CardTitle>{" "}
      </div>{" "}
      <div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2">
          <label className="col-span-2 text-xs">
            <span className={LABEL_CLS}>Proveedor</span>
            <select
              className={`mt-1 ${SELECT_CLS}`}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={busy}
            >
              <option value="">— Proveedor nuevo —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!supplierId && (
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Nombre del proveedor nuevo"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                disabled={busy}
              />
            )}
          </label>

          <label className="text-xs">
            <span className={LABEL_CLS}>Nº de factura</span>
            <Input
              className="mt-1 h-8 text-xs"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            <span className={LABEL_CLS}>Fecha</span>
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
            <span className={LABEL_CLS}>Moneda</span>
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
            <span className={LABEL_CLS}>Total</span>
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
            <span className={LABEL_CLS}>Notas</span>
            <Input
              className="mt-1 h-8 text-xs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="col-span-2 flex items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Crear factura"}
            </Button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </form>
        <p className="text-xs text-[#6b7385] mt-2">
          Crea el encabezado como borrador. Agrega las líneas desde el panel de
          revisión que aparece abajo.{" "}
        </p>{" "}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invoice list card
// ---------------------------------------------------------------------------

function invoiceValue(inv: InvoiceListItem, key: string): SortValue {
  switch (key) {
    case "supplier":
      return inv.supplier_name;
    case "number":
      return inv.invoice_number;
    case "date":
      return inv.invoice_date;
    case "total":
      return inv.total_amount;
    case "status":
      return inv.status;
    case "lines":
      return inv.line_counts.unmatched;
    default:
      return null;
  }
}

function InvoiceListCard({
  invoices,
  reviewingId,
  onReview,
}: {
  invoices: InvoiceListItem[];
  reviewingId: string | null;
  onReview: (id: string) => void;
}) {
  const { sort, toggle } = useTableSort("compras-facturas");
  const sorted = sortRows(invoices, sort, invoiceValue);
  if (invoices.length === 0) {
    return (
      <Card>
        <div className="px-6 py-8 text-center">
          <Receipt className="h-8 w-8 text-[#b9c7f0] mx-auto mb-3" />{" "}
          <p className="text-[13px] font-bold text-[#151c2c]">
            Aún no hay facturas{" "}
          </p>{" "}
          <p className="text-xs text-[#6b7385] mt-1">
            Sube un archivo o crea una factura a mano para empezar a registrar
            los costos de tus proveedores.{" "}
          </p>{" "}
        </div>{" "}
      </Card>
    );
  }

  return (
    <Card flush>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-[#eef0f4] bg-[#f9fafc]">
            <tr className="text-left text-xs text-[#6b7385]">
              <SortTh
                sortKey="supplier"
                sort={sort}
                onSort={toggle}
                className="px-4 py-3 font-medium"
              >
                Proveedor
              </SortTh>
              <SortTh
                sortKey="number"
                sort={sort}
                onSort={toggle}
                className="px-4 py-3 font-medium"
              >
                Nº de factura{" "}
              </SortTh>
              <SortTh
                sortKey="date"
                sort={sort}
                onSort={toggle}
                className="px-4 py-3 font-medium"
              >
                Fecha{" "}
              </SortTh>
              <SortTh
                sortKey="total"
                sort={sort}
                onSort={toggle}
                align="right"
                className="px-4 py-3 font-medium"
              >
                Total
              </SortTh>
              <SortTh
                sortKey="status"
                sort={sort}
                onSort={toggle}
                className="px-4 py-3 font-medium"
              >
                Estado{" "}
              </SortTh>
              <SortTh
                sortKey="lines"
                sort={sort}
                onSort={toggle}
                className="px-4 py-3 font-medium"
              >
                Líneas (asignadas / total){" "}
              </SortTh>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((inv, i) => (
              <tr
                key={inv.id}
                className={
                  (i % 2 === 1 ? "bg-[#f9fafc]" : "bg-white") +
                  " border-b border-[#eef0f4] last:border-0"
                }
              >
                <td className="px-4 py-3">
                  {inv.supplier_name ?? (
                    <span className="text-[#6b7385] italic">
                      (sin proveedor)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {inv.invoice_number ?? "—"}
                </td>
                <td className="px-4 py-3 text-[#6b7385] whitespace-nowrap">
                  {fmtDate(inv.invoice_date)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtMoney(inv.total_amount, inv.currency)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`${BADGE_CLS} ${STATUS_STYLE[inv.status] ?? ""}`}
                  >
                    {statusLabel(inv.status)}{" "}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {inv.line_counts.matched} / {inv.line_counts.total}
                  {inv.line_counts.unmatched > 0 && (
                    <span className="ml-1 text-gray-500">
                      · {inv.line_counts.unmatched} sin asignar
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onReview(reviewingId === inv.id ? "" : inv.id)
                    }
                  >
                    {reviewingId === inv.id ? "Ocultar" : "Revisar"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>{" "}
      </div>{" "}
    </Card>
  );
} // ---------------------------------------------------------------------------
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
  canEdit = true,
}: {
  invoiceId: string;
  ingredients: IngredientLite[];
  onIngredientCreated: (ing: IngredientLite) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  canEdit?: boolean;
}) {
  const router = useRouter();
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
      setError(err instanceof Error ? err.message : "Error de red");
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
      alert(err instanceof Error ? err.message : "Error de red");
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
      // The price now lives in ingredient_cost_entries: every page that shows
      // it (Menú, Costos, Cockpit) must read it again.
      markTabsStale();
      await load();
      void onChanged();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error de red");
    } finally {
      setPostingBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="text-[13px] text-[#6b7385]">Cargando factura…</div>{" "}
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <div className="text-[13px] text-red-600">
          {error ?? "No se pudo cargar la factura"}{" "}
        </div>{" "}
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
      <div className="mb-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>
            <FileText className="h-4 w-4 text-[#1B40C8]" />
            {inv.supplier_name ?? "(sin proveedor)"} ·{" "}
            <span className="font-mono">{inv.invoice_number ?? "—"}</span>
            <span className={`${BADGE_CLS} ${STATUS_STYLE[inv.status] ?? ""}`}>
              {statusLabel(inv.status)}{" "}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowEvents((v) => !v)}
            >
              {showEvents ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Historial{" "}
            </Button>{" "}
            <Button size="sm" variant="secondary" onClick={onClose}>
              Cerrar{" "}
            </Button>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
      <div className="space-y-3">
        {/* Header summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <div className="text-[#6b7385]">Fecha</div>
            <div>{fmtDate(inv.invoice_date)}</div>
          </div>
          <div>
            <div className="text-[#6b7385]">Vencimiento</div>
            <div>{inv.due_date ? fmtDate(inv.due_date) : "—"}</div>
          </div>
          <div>
            <div className="text-[#6b7385]">Total</div>
            <div className="font-mono">
              {fmtMoney(inv.total_amount, inv.currency)}
            </div>
          </div>
          <div>
            <div className="text-[#6b7385]">Origen</div>{" "}
            <div>{SOURCE_LABEL[inv.source_type] ?? inv.source_type}</div>
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
          disabled={inv.status === "posted" || !canEdit}
        />
        {lines.length === 0 ? (
          <p className="text-[13px] text-[#6b7385] italic">
            Aún no hay líneas. Agrega una arriba o sube un CSV / Excel.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-[#eef0f4] bg-[#f9fafc] text-left text-xs text-[#6b7385]">
                <tr>
                  <th className="px-2 py-2 font-medium">Descripción</th>
                  <th className="px-2 py-2 font-medium">Ingrediente</th>
                  <th className="px-2 py-2 font-medium text-right">Cant. </th>
                  <th className="px-2 py-2 font-medium">Unidad</th>
                  <th className="px-2 py-2 font-medium text-right">
                    Costo unitario{" "}
                  </th>{" "}
                  <th className="px-2 py-2 font-medium text-right">
                    Total de línea{" "}
                  </th>{" "}
                  <th className="px-2 py-2 font-medium">Revisión</th>
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
                    disabled={inv.status === "posted" || !canEdit}
                    onChange={(patch) => patchLine(line.id, patch)}
                    currency={inv.currency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Post invoice CTA */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-[#eef0f4]">
          <div className="text-xs text-[#6b7385]">
            {approvedMatched.length} de {lines.length}{" "}
            {lines.length === 1 ? "línea lista" : "líneas listas"} para
            publicar.
          </div>
          <Button
            onClick={postInvoice}
            disabled={!canPost || postingBusy || !canEdit}
            title={
              !canPost
                ? "Primero aprueba y asigna al menos una línea"
                : "Registra los costos de los ingredientes y marca la factura como publicada"
            }
          >
            {postingBusy ? "Publicando…" : "Publicar factura"}
          </Button>
        </div>
        {postResult && (
          <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-xs space-y-2">
            <p className="font-semibold text-green-800">
              {postResult.posted_lines === 1 ? "Se publicó" : "Se publicaron"}{" "}
              {postResult.posted_lines}{" "}
              {postResult.posted_lines === 1
                ? "registro de costo"
                : "registros de costo"}
              .
            </p>
            {postResult.skipped_lines.length > 0 && (
              <details>
                <summary className="cursor-pointer text-gray-700">
                  {postResult.skipped_lines.length}{" "}
                  {postResult.skipped_lines.length === 1
                    ? "línea omitida"
                    : "líneas omitidas"}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {postResult.skipped_lines.map((s, i) => (
                    <li key={i} className="text-[#6b7385]">
                      {s.description}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-[#151c2c]">
              {postResult.next_steps}{" "}
              <Link
                className="text-[#1B40C8] hover:underline"
                href="/dashboard/restaurant/agents"
              >
                Abrir el Centro de agentes →
              </Link>
            </p>
          </div>
        )}
        {/* Event history */}
        {showEvents && (
          <div className="rounded-lg border border-[#eef0f4] bg-[#f9fafc] p-3 space-y-1.5 text-xs">
            <p className="text-xs font-semibold text-[#6b7385]">
              Historial de eventos
            </p>
            {data.events.length === 0 ? (
              <p className="text-[#6b7385]">
                Esta factura aún no tiene eventos.
              </p>
            ) : (
              <ol className="border-l-2 border-[#eef0f4] pl-3 space-y-1.5">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{e.event_type}</span>
                      <span className="text-xs text-[#6b7385] ml-auto">
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
                      <p className="text-xs italic text-[#6b7385]">
                        “{e.note}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}{" "}
      </div>{" "}
    </Card>
  );
} // ---------------------------------------------------------------------------
// Line row + add-line form
// ---------------------------------------------------------------------------

const REVIEW_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
};
const REVIEW_LABEL: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
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
    <tr
      className={(striped ? "bg-[#f9fafc]" : "") + " border-b border-[#eef0f4]"}
    >
      <td className="px-2 py-2 max-w-[260px]">
        <div className="truncate font-medium" title={line.description}>
          {line.description}
        </div>
        {(line.supplier_sku || line.supplier_item_name) && (
          <div className="text-xs text-[#6b7385]">
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
              className={SELECT_SM_CLS}
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
              aria-label="Cambiar ingrediente asignado"
            >
              <option value="">— Quitar asignación —</option>
              <option value={INGREDIENT_PICK_NEW}>
                + Crear ingrediente nuevo{" "}
              </option>{" "}
              {ingredients.length > 0 && (
                <optgroup label="Existentes">
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
            <span className={`${BADGE_CLS} bg-gray-100 text-gray-700`}>
              Sin asignar
            </span>
            <select
              className={SELECT_SM_CLS}
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
              aria-label="Asignar a un ingrediente"
            >
              <option value="">— Elegir ingrediente —</option>
              <option value={INGREDIENT_PICK_NEW}>
                + Crear ingrediente nuevo{" "}
              </option>{" "}
              {ingredients.length > 0 && (
                <optgroup label="Existentes">
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
          <div className="mt-2 rounded-lg border border-[#c6d3f5] bg-[#f6f8fe] p-2 space-y-1.5">
            <div className="text-xs text-[#6b7385] font-medium">
              Crear ingrediente nuevo{" "}
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Nombre del ingrediente"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
            <Input
              className="h-7 text-xs"
              placeholder="Unidad por defecto (kg, l, pieza…)"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              disabled={creating}
            />
            <Input
              className="h-7 text-xs"
              placeholder="Categoría (opcional)"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              disabled={creating}
            />
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={submitInlineCreate}
                disabled={creating || !newName.trim() || !newUnit.trim()}
                title="Crea el ingrediente y asigna esta línea a él"
              >
                {creating ? "Creando…" : "Crear y asignar"}{" "}
              </Button>{" "}
              <Button
                size="sm"
                variant="secondary"
                onClick={cancelInlineCreate}
                disabled={creating}
              >
                Cancelar
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
          className={`${BADGE_CLS} ${REVIEW_STYLE[line.review_status] ?? ""}`}
        >
          {REVIEW_LABEL[line.review_status] ?? line.review_status}
        </span>
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          {line.review_status !== "approved" && (
            <Button
              size="icon"
              variant="secondary"
              onClick={() => onChange({ review_status: "approved" })}
              disabled={disabled}
              title="Aprobar línea"
              aria-label="Aprobar línea"
            >
              <CheckCircle2 className="h-3 w-3" />
            </Button>
          )}
          {line.review_status !== "rejected" && (
            <Button
              size="icon"
              variant="danger"
              onClick={() => onChange({ review_status: "rejected" })}
              disabled={disabled}
              title="Rechazar línea"
              aria-label="Rechazar línea"
            >
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {line.review_status !== "pending" && (
            <Button
              size="icon"
              variant="secondary"
              onClick={() => onChange({ review_status: "pending" })}
              disabled={disabled}
              title="Volver a pendiente"
              aria-label="Volver a pendiente"
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
      setError("El nombre del ingrediente nuevo es obligatorio.");
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
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  };

  if (disabled) return null;

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-[#eef0f4] bg-[#f9fafc] p-3 space-y-3 text-xs"
    >
      {/* Row 1: Ingredient selector (+ inline create-new fields) */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <label className="md:col-span-2">
          <span className={LABEL_CLS}>Ingrediente</span>{" "}
          <select
            className={`mt-1 ${SELECT_CLS}`}
            value={pick}
            onChange={(e) => onPickChange(e.target.value)}
          >
            <option value={INGREDIENT_PICK_UNMATCHED}>
              — Dejar sin asignar —
            </option>
            <option value={INGREDIENT_PICK_NEW}>
              + Crear ingrediente nuevo{" "}
            </option>{" "}
            {ingredients.length > 0 && (
              <optgroup label="Existentes">
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
              <span className={LABEL_CLS}>Nombre del ingrediente nuevo</span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej. Aceite de oliva"
                required
              />
            </label>
            <label>
              <span className={LABEL_CLS}>Unidad por defecto</span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newDefaultUnit}
                onChange={(e) => setNewDefaultUnit(e.target.value)}
                placeholder="kg / l / pieza"
              />
            </label>
            <label>
              <span className={LABEL_CLS}>Categoría (opcional)</span>
              <Input
                className="mt-1 h-7 text-xs"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Verduras, Lácteos…"
              />
            </label>
          </>
        )}
      </div>

      {/* Row 2: Description spans wide */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <label className="md:col-span-6">
          <span className={LABEL_CLS}>
            Descripción (texto de la línea en la factura)
          </span>
          <Input
            className="mt-1 h-7 text-xs"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isExistingPick
                ? "Opcional — por defecto se usa el nombre del ingrediente"
                : "Ej. Cebolla blanca, saco de 5 kg"
            }
            required
          />
        </label>
      </div>

      {/* Row 3: numerics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <label>
          <span className={LABEL_CLS}>Cant.</span>
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
          <span className={LABEL_CLS}>Unidad</span>
          <Input
            className="mt-1 h-7 text-xs"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            required
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Costo unitario</span>
          <Input
            type="number"
            step="0.0001"
            className="mt-1 h-7 text-xs"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Total de línea</span>
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
          <span className={LABEL_CLS}>
            Nombre del artículo del proveedor (opcional)
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
          <span className={LABEL_CLS}>SKU del proveedor (opcional)</span>
          <Input
            className="mt-1 h-7 text-xs"
            value={supplierSku}
            onChange={(e) => setSupplierSku(e.target.value)}
          />
        </label>
        <label className="md:col-span-4">
          <span className={LABEL_CLS}>Notas (opcional)</span>
          <Input
            className="mt-1 h-7 text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>
          <Plus className="h-3.5 w-3.5" />{" "}
          {busy ? "Agregando…" : "Agregar línea"}
        </Button>
        <span className="text-xs text-[#6b7385]">
          {isCreatingNew
            ? "Se creará un ingrediente nuevo y se vinculará a este proveedor."
            : isExistingPick
              ? "La línea quedará asignada."
              : "La línea quedará sin asignar. Puedes asignarla después."}
        </span>
        {error && (
          <span className="text-xs text-red-600 flex items-center gap-1 ml-auto">
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
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card>
      <div className="mb-2.5">
        <CardTitle>
          <Sparkles className="h-4 w-4 text-[#1B40C8]" /> Subir factura
          (foto){" "}
        </CardTitle>{" "}
      </div>{" "}
      <div className="space-y-3">
        <p className="text-xs text-[#6b7385]">
          Milton lee los datos de la factura para que los revises. Los costos no
          cambian hasta que publiques la factura revisada.{" "}
        </p>
        <form onSubmit={onExtract} className="space-y-2">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={extracting}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!file || extracting}>
              {extracting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
                  Leyendo…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Leer con IA
                </>
              )}
            </Button>
            <span className="text-xs text-[#6b7385]">
              Foto de la factura: PNG / JPG / WEBP de hasta 10 MB. El PDF
              todavía no se puede leer; tómale una foto.
            </span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>{" "}
      </div>{" "}
    </Card>
  );
} // ---------------------------------------------------------------------------
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
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <div className="mb-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>
            <Sparkles className="h-4 w-4 text-[#1B40C8]" /> Revisar factura
            leída
            {meta?.fileName && (
              <span className="text-xs font-normal text-[#6b7385] font-mono">
                · {meta.fileName}
              </span>
            )}
          </CardTitle>{" "}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              onClick={onDiscard}
              disabled={creating}
            >
              Volver a las opciones de carga{" "}
            </Button>{" "}
            <Button
              size="sm"
              variant="danger"
              onClick={onDiscard}
              disabled={creating}
            >
              Descartar borrador{" "}
            </Button>{" "}
            <Button size="sm" onClick={onCreate} disabled={creating}>
              <ImageIcon className="h-3.5 w-3.5" />{" "}
              {creating ? "Creando…" : "Crear factura para revisar"}{" "}
            </Button>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
      <div>
        <ExtractedDraftBody
          draft={draft}
          setDraft={setDraft}
          error={error}
        />{" "}
      </div>{" "}
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
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          La lectura con IA es un borrador. Revisa todos los campos antes de
          crear la factura.{" "}
          {needsReviewCount > 0 && (
            <span className="ml-1 font-semibold">
              {needsReviewCount}{" "}
              {needsReviewCount === 1 ? "línea necesita" : "líneas necesitan"}{" "}
              atención.
            </span>
          )}
        </span>
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <label className="col-span-2 md:col-span-1">
          <span className={LABEL_CLS}>Proveedor</span>
          <Input
            className="mt-1 h-7 text-xs"
            value={draft.supplier_name ?? ""}
            onChange={(e) =>
              setHeader("supplier_name", strOrNull(e.target.value))
            }
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Nº de factura</span>
          <Input
            className="mt-1 h-7 text-xs"
            value={draft.invoice_number ?? ""}
            onChange={(e) =>
              setHeader("invoice_number", strOrNull(e.target.value))
            }
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Moneda</span>
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
          <span className={LABEL_CLS}>Fecha</span>
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
          <span className={LABEL_CLS}>Fecha de vencimiento</span>
          <Input
            type="date"
            className="mt-1 h-7 text-xs"
            value={draft.due_date ?? ""}
            onChange={(e) => setHeader("due_date", strOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Subtotal</span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={draft.subtotal ?? ""}
            onChange={(e) => setHeader("subtotal", numOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Impuesto</span>
          <Input
            type="number"
            step="0.01"
            className="mt-1 h-7 text-xs"
            value={draft.tax_amount ?? ""}
            onChange={(e) => setHeader("tax_amount", numOrNull(e.target.value))}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Total</span>
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
      <div className="rounded-lg border border-[#eef0f4] bg-white">
        <div className="px-3 py-2 border-b border-[#eef0f4] flex items-center justify-between text-xs font-semibold text-[#6b7385]">
          <span>Líneas leídas ({draft.lines.length})</span>{" "}
          <Button
            size="sm"
            variant="secondary"
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
            <Plus className="h-3 w-3" /> Agregar fila
          </Button>
        </div>
        {draft.lines.length === 0 ? (
          <p className="text-xs text-[#6b7385] px-3 py-3">
            No se detectaron líneas. Usa «Agregar fila» o sube una imagen más
            nítida.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#f9fafc] text-left text-xs text-[#6b7385]">
                <tr>
                  <th className="px-2 py-1.5 font-medium w-[110px]">SKU</th>
                  <th className="px-2 py-1.5 font-medium">Descripción</th>
                  <th className="px-2 py-1.5 font-medium w-[160px]">
                    Artículo del proveedor{" "}
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[80px]">
                    Cant.{" "}
                  </th>
                  <th className="px-2 py-1.5 font-medium w-[70px]">Unidad</th>
                  <th className="px-2 py-1.5 font-medium text-right w-[100px]">
                    Costo unitario{" "}
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[110px]">
                    Total de línea{" "}
                  </th>
                  <th className="px-2 py-1.5 font-medium text-right w-[90px]">
                    Impuesto{" "}
                  </th>{" "}
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
                        "border-b border-[#eef0f4] align-top " +
                        (needs
                          ? "bg-gray-50/60"
                          : i % 2 === 1
                            ? "bg-[#f9fafc]"
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
                          <span
                            className={`${BADGE_CLS} mt-1 bg-[#eef2fd] text-[#1B40C8]`}
                          >
                            Calculado
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
                          <span
                            className={`${BADGE_CLS} mt-1 bg-[#eef2fd] text-[#1B40C8]`}
                          >
                            Calculado
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
                          size="icon"
                          variant="danger"
                          onClick={() => removeLine(i)}
                          title="Quitar línea"
                          aria-label="Quitar línea"
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
          <summary className="cursor-pointer text-[#6b7385]">
            Notas de confianza de la IA ({draft.confidence_notes.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {draft.confidence_notes.map((n, i) => (
              <li key={i} className="text-[#6b7385] italic">
                · {n}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <p className="text-xs text-[#6b7385]">
        Al crear la factura, las líneas quedan en estado{" "}
        <strong>Por revisar</strong>. Los costos solo se registran cuando
        publicas la factura en el panel de revisión de abajo.
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
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700"
      >
        Por revisar
      </span>
    );
  }
  if (line.confidence === "low") {
    chips.push(
      <span
        key="low"
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700"
        title={line.confidence_notes ?? undefined}
      >
        Confianza baja
      </span>
    );
  } else if (line.confidence === "medium") {
    chips.push(
      <span
        key="medium"
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700"
        title={line.confidence_notes ?? undefined}
      >
        Confianza media
      </span>
    );
  } else if (line.confidence === "high") {
    chips.push(
      <span
        key="high"
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800"
        title={line.confidence_notes ?? undefined}
      >
        Confianza alta
      </span>
    );
  }
  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1 mt-1">{chips}</div>;
}
