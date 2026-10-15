// lib/restaurant/sales-channel-labels.ts
//
// Shared POS channel labels (Eat In / To Go / …). Used by the Sales
// heatmap mix chart and the Cockpit channel breakdown.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";

const CHANNEL_LABELS: Record<string, { en: string; es: string }> = {
  in_store: { en: "Eat In", es: "En salón" },
  takeaway: { en: "To Go", es: "Para llevar" },
  delivery: { en: "Delivery", es: "Domicilio" },
  online: { en: "Online", es: "En línea" },
  unknown: { en: "Unknown channel", es: "Canal desconocido" },
};

const PAYMENT_LABELS: Record<string, { en: string; es: string }> = {
  card: { en: "Card", es: "Tarjeta" },
  cash: { en: "Cash", es: "Efectivo" },
  digital: { en: "Digital", es: "Digital" },
  unknown: { en: "Unknown payment", es: "Pago desconocido" },
};

export function salesChannelLabel(
  key: string,
  lang: PreferredLanguage
): string {
  const known = CHANNEL_LABELS[key];
  if (known) return lang === "es" ? known.es : known.en;
  if (key === "unknown") {
    return t(lang, "Unknown", "Desconocido");
  }
  return key;
}

export function salesPaymentLabel(
  key: string,
  lang: PreferredLanguage
): string {
  const known = PAYMENT_LABELS[key];
  if (known) return lang === "es" ? known.es : known.en;
  if (key === "unknown") {
    return t(lang, "Unknown payment", "Pago desconocido");
  }
  return key;
}

export function salesCategoryLabel(
  category: string | null | undefined,
  lang: PreferredLanguage
): string {
  if (category == null || category.trim() === "") {
    return t(lang, "Uncategorized", "Sin categoría");
  }
  return category;
}
