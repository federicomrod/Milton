// lib/restaurant/price-update-refs.ts
//
// A Telegram price update is a PRICE, not a PURCHASE (#313). After a person
// approves it, it writes an ingredient cost entry (that is how the price
// reaches the ingredient and its history), and that must keep working. But it
// must NEVER count as a purchase amount, spend, purchase line or invoice.
//
// Every purchase total / count uses these helpers: `isPurchaseInvoice` (in
// price-update-note.ts) for invoice rows and `isPurchaseCostEntry` here for
// cost entries. No other copy of the prefix check should exist. The exclusion
// is explicit: it does not rely on the price update's supplier_id being NULL.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEGACY_PRICE_UPDATE_NOTE_PREFIX,
  PRICE_UPDATE_NOTE_PREFIX,
} from "@/lib/restaurant/price-update-note";

export interface PriceUpdateRefs {
  invoiceIds: ReadonlySet<string>;
  lineIds: ReadonlySet<string>;
}

/** LIKE needs % and _ escaped, or the prefix would match more than itself. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const PAGE = 1000;
const ID_CHUNK = 200;

/**
 * Ids of this company's Telegram price-update invoices (any status) and their
 * lines. Positive LIKE on notes for the current and the legacy prefix (never
 * NOT LIKE: NULL notes must never be dropped), always company-scoped; lines are
 * read with company_id + invoice_id in (...) and never with an empty list.
 * Returns null when a read fails (callers then show «—», never a total that
 * may include price updates).
 */
export async function loadPriceUpdateRefs(
  client: unknown,
  companyId: string
): Promise<PriceUpdateRefs | null> {
  const supabase = client as SupabaseClient;
  try {
    const invoiceIds = new Set<string>();
    // One plain `.like` per prefix (not `.or(...)`: the prefixes contain
    // parentheses, which PostgREST logical filters would need quoted).
    for (const prefix of [
      PRICE_UPDATE_NOTE_PREFIX,
      LEGACY_PRICE_UPDATE_NOTE_PREFIX,
    ]) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("supplier_invoices")
          .select("id")
          .eq("company_id", companyId)
          .like("notes", likePrefix(prefix))
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Array<{ id: string }>;
        for (const row of rows) invoiceIds.add(String(row.id));
        if (rows.length < PAGE) break;
      }
    }
    const lineIds = new Set<string>();
    const ids = [...invoiceIds];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("supplier_invoice_lines")
          .select("id")
          .eq("company_id", companyId)
          .in("invoice_id", chunk)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Array<{ id: string }>;
        for (const row of rows) lineIds.add(String(row.id));
        if (rows.length < PAGE) break;
      }
    }
    return { invoiceIds, lineIds };
  } catch (err) {
    console.error(
      "[price-update-refs] read failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return null;
  }
}

/** false for an ingredient cost entry that came from a price-update line. */
export function isPurchaseCostEntry(
  entry: { source_type: string | null; source_id: string | null },
  refs: PriceUpdateRefs
): boolean {
  return !(
    entry.source_type === "invoice_line" &&
    entry.source_id !== null &&
    refs.lineIds.has(entry.source_id)
  );
}
