// components/restaurant/costs/LatestInvoicesCompact.tsx
//
// Compact version of «Últimas facturas» for the right column (desktop) or
// tablet cards: 3 rows (supplier, date, total on one line each), a pending
// count badge, and a «Revisar» primary button if anything is pending.

import Link from "next/link";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";
import { costsTabHref, invoiceReviewHref } from "@/lib/restaurant/costs-tabs";
import { invoiceTotalText } from "./LatestInvoicesBox";

function dateText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

export function LatestInvoicesCompact({
  latest,
  shellParams = {},
  testId,
}: {
  latest: LatestInvoices;
  shellParams?: Record<string, string | string[] | undefined>;
  /** Only the desktop aside should carry the test id (tablet/mobile also render this card). */
  testId?: string;
}) {
  const { rows, pendingCount, firstPendingId } = latest;
  const displayRows = rows.slice(0, 3);

  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-[#dfe3ea] bg-white p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold text-[#151c2c]">
          Últimas facturas
        </h2>
        {pendingCount !== null && pendingCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1B40C8] px-1.5 text-[11px] font-bold text-white">
            {pendingCount}
          </span>
        ) : null}
      </div>

      {displayRows.length === 0 ? (
        <p className="text-[12px] text-[#5B6570]">Aún no tienes facturas</p>
      ) : (
        <div className="space-y-1.5">
          {displayRows.map((inv) => (
            <Link
              key={inv.id}
              href={invoiceReviewHref(inv.id, shellParams)}
              className="block rounded px-2 py-1.5 text-[12px] hover:bg-[#E7EDFD]"
            >
              <div className="font-semibold text-[#151c2c] truncate">
                {inv.supplier_name ?? "Sin proveedor"}
              </div>
              <div className="flex items-center justify-between text-[#5B6570] mt-0.5">
                <span>{dateText(inv.invoice_date)}</span>
                <span className="font-medium text-[#0D1117]">
                  {invoiceTotalText(inv.total_amount, inv.currency)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {firstPendingId && (pendingCount ?? 0) > 0 ? (
        <Link
          href={invoiceReviewHref(firstPendingId, shellParams)}
          className="block w-full rounded-lg bg-[#1B40C8] px-3 py-2 text-center text-[13px] font-semibold text-white hover:bg-[#1533A3]"
        >
          Revisar
        </Link>
      ) : displayRows.length > 0 ? (
        <Link
          href={costsTabHref("compras", shellParams)}
          className="block text-center text-[12px] font-semibold text-[#1B40C8] hover:underline"
        >
          Ver todas
        </Link>
      ) : null}
    </section>
  );
}
