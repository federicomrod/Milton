// components/restaurant/costs/LatestInvoicesBox.tsx
//
// «Últimas facturas» at the top of Costos: invoices are daily work (and now
// also arrive by Telegram), so the latest ones and the pending count sit right
// under the KPIs. Presentational and server-renderable; the numbers come from
// real rows (loadLatestInvoices). A missing total is «Sin precio», never $0.

import Link from "next/link";
import { isTelegramInvoice } from "@/lib/restaurant/price-update-note";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { invoiceReviewHref } from "@/lib/restaurant/costs-tabs";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";

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

/** Where the invoice came from: Telegram, foto, CSV, manual… */
export function invoiceOrigin(inv: {
  source_type: string;
  notes?: string | null;
  original_file_name?: string | null;
}): string {
  if (isTelegramInvoice(inv)) return "Telegram";
  return SOURCE_LABEL[inv.source_type] ?? inv.source_type;
}

/** Total text: a missing (or empty) total is «Sin precio», never $0. */
export function invoiceTotalText(
  total: number | null | undefined,
  currency: string
): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0)
    return "Sin precio";
  return formatMoney(total, currency);
}

function dateText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function LatestInvoicesBox({
  latest,
  uploadHref,
  shellParams = {},
}: {
  latest: LatestInvoices;
  /** «Subir factura» (Compras, at the entry cards). */
  uploadHref: string;
  shellParams?: Record<string, string | string[] | undefined>;
}) {
  const { rows, pendingCount, firstPendingId } = latest;
  return (
    <section
      data-testid="latest-invoices"
      className="rounded-[14px] border border-[#dfe3ea] bg-white px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[14px] font-bold text-[#151c2c]">
          Últimas facturas
        </h2>
        {rows.length > 0 ? (
          <span
            data-testid="latest-invoices-pending"
            className="text-[13px] text-[#4b5466]"
          >
            {pendingCount === null
              ? "—"
              : pendingCount === 0
                ? "Nada por revisar"
                : `${pendingCount} por revisar`}
          </span>
        ) : null}
        {firstPendingId && (pendingCount ?? 0) > 0 ? (
          <Link
            href={invoiceReviewHref(firstPendingId, shellParams)}
            className="ml-auto inline-flex h-8 items-center rounded-lg bg-[#1B40C8] px-3.5 text-[13px] font-semibold text-white hover:bg-[#1535a6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
          >
            Revisar
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div
          data-testid="latest-invoices-empty"
          className="mt-2 flex flex-wrap items-center gap-3"
        >
          <p className="text-[13px] text-[#4b5466]">
            Aún no tienes facturas. Súbelas aquí o mándalas por Telegram.
          </p>
          <Link
            href={uploadHref}
            className="ml-auto inline-flex h-8 items-center rounded-lg bg-[#1B40C8] px-3.5 text-[13px] font-semibold text-white hover:bg-[#1535a6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
          >
            Subir factura
          </Link>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[#eef0f4]">
          {rows.map((inv) => (
            <li
              key={inv.id}
              data-testid="latest-invoice-row"
              className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-1.5 text-[13px]"
            >
              <Link
                href={invoiceReviewHref(inv.id, shellParams)}
                className="min-w-0 flex-1 truncate font-semibold text-[#151c2c] hover:underline"
              >
                {inv.supplier_name ?? "Sin proveedor"}
              </Link>
              <span className="w-[84px] text-[#4b5466] tabular-nums">
                {dateText(inv.invoice_date)}
              </span>
              <span className="w-[96px] text-right tabular-nums text-[#151c2c]">
                {invoiceTotalText(inv.total_amount, inv.currency)}
              </span>
              <span className="w-[64px] text-[#4b5466]">
                {invoiceOrigin(inv)}
              </span>
              <span className="w-[84px] text-[#4b5466]">
                {STATUS_LABEL[inv.status] ?? inv.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
