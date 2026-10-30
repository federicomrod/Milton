// lib/restaurant/sales-channel-labels.ts
//
// Shared POS channel labels (Eat In / To Go / …). Used by the Sales
// heatmap mix chart and the Cockpit channel breakdown. The words live in
// lib/i18n/*/sales.ts › labels.

import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export function salesChannelLabel(
  key: string,
  lang: PreferredLanguage
): string {
  const c = getDictionary(lang).sales.labels.channels;
  const known: Record<string, string> = {
    in_store: c.inStore,
    takeaway: c.takeaway,
    delivery: c.delivery,
    online: c.online,
    unknown: c.unknown,
  };
  return known[key] ?? key;
}

export function salesPaymentLabel(
  key: string,
  lang: PreferredLanguage
): string {
  const p = getDictionary(lang).sales.labels.payments;
  const known: Record<string, string> = {
    card: p.card,
    cash: p.cash,
    digital: p.digital,
    unknown: p.unknown,
  };
  return known[key] ?? key;
}

export function salesCategoryLabel(
  category: string | null | undefined,
  lang: PreferredLanguage
): string {
  if (category == null || category.trim() === "") {
    return getDictionary(lang).sales.labels.uncategorized;
  }
  return category;
}
