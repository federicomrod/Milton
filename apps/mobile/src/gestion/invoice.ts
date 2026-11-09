// How an invoice's numbers read, shared by the Costos list and the invoice
// screen. A missing price is «Sin precio» and a missing quantity «Falta»,
// never $0 (the server sends null for those).

import type { Language } from "../i18n/strings";
import { formatMoney, formatNumber } from "./format";
import type { GestionStrings } from "./strings";
import type { InvoiceLine, PendingInvoice } from "./types";

export function invoiceTotalText(
  inv: Pick<PendingInvoice, "total" | "priced">,
  g: GestionStrings,
  currency: string,
  lang: Language
): string {
  if (inv.total !== null) return formatMoney(inv.total, currency, lang, 2);
  return inv.priced ? g.costs.missing : g.costs.noPrice;
}

export function lineTotalText(
  l: InvoiceLine,
  g: GestionStrings,
  currency: string,
  lang: Language
): string {
  if (l.missing.includes("quantity") && l.unitCost !== null) {
    return g.costs.missing;
  }
  return l.lineTotal !== null
    ? formatMoney(l.lineTotal, currency, lang, 2)
    : g.costs.noPrice;
}

/** «2 kg · $4.50»; «Falta» once when quantity and unit are both missing. */
export function lineDetailText(
  l: InvoiceLine,
  g: GestionStrings,
  currency: string,
  lang: Language
): string {
  const noQty = l.missing.includes("quantity");
  const noUnit = l.missing.includes("unit");
  const qtyUnit =
    noQty && noUnit
      ? g.costs.missing
      : [
          noQty ? g.costs.missing : formatNumber(l.quantity, lang, 2),
          noUnit ? g.costs.missing : (l.unit ?? ""),
        ]
          .join(" ")
          .trim();
  const price =
    l.unitCost !== null
      ? formatMoney(l.unitCost, currency, lang, 2)
      : g.costs.noPrice;
  return `${qtyUnit} · ${price}`;
}
