// lib/restaurant/telegram/briefing-formatter.ts
//
// Telegram Daily Briefing v1 — turns the SAME BriefingContext/BriefingOutput
// the dashboard card renders (lib/restaurant/briefing-generate.ts) into a
// concise, operator-oriented plain-text Telegram message. No second
// briefing engine: every number and every risk/action string here is read
// directly from what generateBriefing() already produced.
//
// Adjustment 1 (approved architecture): BriefingContext.period_label is NOT
// a guaranteed "yesterday" — buildBriefingContext() currently sets it to a
// fixed "all available POS data" label, not a specific calendar day. This
// formatter therefore never hardcodes "yesterday"/"de ayer"; it uses
// neutral, always-true greeting language and states the actual
// `period_label` from the context instead of implying a period the data
// does not guarantee.
//
// Plain text only — no Markdown/MarkdownV2 parse_mode is requested by the
// send utility, so there is no escaping to get wrong (a stray "." or "-" in
// a supplier/ingredient/dish name would otherwise silently break Telegram's
// MarkdownV2 parser). Pure function — no I/O, directly unit-testable.

import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { BriefingOutput } from "@/lib/restaurant/briefing-prompt";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

// Telegram's hard limit for a single sendMessage `text` field.
const TELEGRAM_MESSAGE_LIMIT = 4096;

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

function fmtNumber(n: number, lang: PreferredLanguage): string {
  return n.toLocaleString(lang === "es" ? "es-MX" : "en-US");
}

/**
 * Builds the full Telegram message text for one company's briefing.
 * Never translates ctx.restaurant_name, item/ingredient/supplier names, or
 * any string already produced by briefing (those already respect the
 * proper-noun rule — see lib/restaurant/briefing-prompt.ts).
 */
export function formatBriefingForTelegram(
  ctx: BriefingContext,
  briefing: BriefingOutput
): string {
  const lang = ctx.preferred_language;
  const k = ctx.kpis;
  const c = ctx.currency;

  const lines: string[] = [];

  lines.push(t(lang, "Good morning 👋", "Buenos días 👋"));
  lines.push(
    t(
      lang,
      "Here's your latest Milton briefing.",
      "Aquí tienes tu último briefing de Milton."
    )
  );
  lines.push(`📍 ${ctx.restaurant_name} · ${ctx.period_label}`);
  lines.push("");

  // 💰 Sales
  lines.push(t(lang, "💰 Sales", "💰 Ventas"));
  if (k.revenue > 0) {
    const parts = [fmtCurrency(k.revenue, c)];
    if (k.orders !== null) {
      parts.push(
        t(
          lang,
          `${fmtNumber(k.orders, lang)} orders`,
          `${fmtNumber(k.orders, lang)} órdenes`
        )
      );
    }
    if (k.avg_ticket !== null) {
      parts.push(
        t(
          lang,
          `${fmtCurrency(k.avg_ticket, c)} avg ticket`,
          `${fmtCurrency(k.avg_ticket, c)} de ticket promedio`
        )
      );
    }
    lines.push(parts.join(" · "));
  } else {
    lines.push(
      t(
        lang,
        "No POS revenue recorded yet.",
        "Aún no hay ingresos de POS registrados."
      )
    );
  }
  lines.push("");

  // 📊 Margin
  lines.push(t(lang, "📊 Margin", "📊 Margen"));
  if (k.estimated_gross_margin_pct !== null) {
    const foodCost = k.food_cost_pct !== null ? `${k.food_cost_pct}%` : "—";
    lines.push(
      t(
        lang,
        `Est. gross margin ${k.estimated_gross_margin_pct}% · Food cost ${foodCost}`,
        `Margen bruto est. ${k.estimated_gross_margin_pct}% · Costo de alimentos ${foodCost}`
      )
    );
  } else {
    lines.push(
      k.estimated_gross_margin_pct_reason ??
        t(lang, "Margin not available yet.", "Margen aún no disponible.")
    );
  }

  // ⚠️ Watch (top risks, already bilingual + proper-noun-safe from `briefing`)
  if (briefing.top_risks.length > 0) {
    lines.push("");
    lines.push(t(lang, "⚠️ Watch", "⚠️ Atención"));
    for (const risk of briefing.top_risks.slice(0, 3)) {
      lines.push(`• ${risk}`);
    }
  }

  // ✅ Actions
  if (briefing.recommended_actions.length > 0) {
    lines.push("");
    lines.push(t(lang, "✅ Actions", "✅ Acciones"));
    briefing.recommended_actions.slice(0, 3).forEach((action, i) => {
      lines.push(`${i + 1}. ${action}`);
    });
  }

  let message = lines.join("\n").trim();
  if (message.length > TELEGRAM_MESSAGE_LIMIT) {
    message = `${message.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
  }
  return message;
}
