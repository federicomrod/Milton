// lib/restaurant/email/briefing-email-formatter.ts
//
// Email Briefing Extension v1 — turns the SAME BriefingContext/BriefingOutput
// the dashboard and Telegram already render (lib/restaurant/briefing-generate.ts)
// into a polished, executive-friendly HTML email plus a plain-text
// fallback. No second briefing engine: every number and every risk/action
// string here is read directly from what generateBriefing() already
// produced.
//
// Period wording follows the same rule established for Telegram v1
// (Adjustment 1): BriefingContext.period_label is NOT a guaranteed
// "yesterday"/specific day — it is currently a fixed "all available POS
// data" label. This formatter never assumes a time of day ("Good
// morning") or a specific period either; it states ctx.period_label
// verbatim instead.
//
// HTML SAFETY: unlike the Telegram formatter (plain text, nothing to
// escape), every dynamic string interpolated into the HTML body — a
// restaurant name, a menu item/ingredient/supplier name, a risk or
// recommended-action sentence — is HTML-escaped via esc() below. These
// are ultimately user-entered data (e.g. a menu item literally named
// with a "&" or "<" in it), so skipping this would let arbitrary
// customer/product data corrupt the email's HTML structure.
//
// VISUAL SECTION HONESTY: this design deliberately shows only visuals
// backed by data BriefingContext genuinely contains — a cost-coverage
// gauge (a single known percentage, not a comparison) and supplier price
// increases (a REAL previous_cost -> latest_cost comparison already in
// the context). It does NOT show a revenue/margin trend chart, because
// BriefingContext carries no prior-period series to compare against —
// inventing one would violate the "do not fabricate periods/metrics"
// rule. Once the context gains real historical series data, a trend
// chart can be added here without touching the briefing engine.
//
// EMAIL CLIENT COMPATIBILITY: table-based layout, inline styles only, no
// CSS grid/flexbox, no web fonts, no external images/media queries —
// the same "spongy" (percentage-width, single max-width container)
// technique used for reliable rendering across Outlook/Gmail/Apple Mail.

import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import type { BriefingOutput } from "@/lib/restaurant/briefing-prompt";
import {
  localeFor,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { formatUnitPricePair } from "@/lib/restaurant/price-trends";
import {
  formatDeltaPct,
  noComparisonText,
  noYesterdaySalesText,
} from "@/lib/restaurant/briefing-periods";

export interface RenderedBriefingEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  return n.toLocaleString(localeFor(lang));
}

// ---------------------------------------------------------------------------
// Small email-safe building blocks
// ---------------------------------------------------------------------------

const COLORS = {
  text: "#1f2937",
  muted: "#6b7280",
  border: "#e5e7eb",
  bg: "#f4f5f7",
  card: "#ffffff",
  accent: "#2563eb",
  good: "#16a34a",
  warn: "#dc2626",
};

// One 2x2 grid cell — compact by design (Adjustment: get the reader to
// Performance/Watch/Milton Recommends faster). A plain percentage-width
// table cell, not CSS grid/flexbox, so it degrades safely everywhere;
// the "kpi-cell" class is a progressive-enhancement hook only (see the
// <style> media query in wrapHtml()) — clients that ignore <style>
// blocks (most desktop Outlook) still get a perfectly readable 2-column
// layout, they just don't get the narrow-screen stack.
function kpiCard(label: string, value: string, note?: string): string {
  return `
    <td class="kpi-cell" width="50%" valign="top" style="padding:5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:8px;">
        <tr>
          <td style="padding:10px 12px;">
            <div style="font-size:11px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.04em;">${esc(label)}</div>
            <div style="font-size:18px;font-weight:700;color:${COLORS.text};margin-top:2px;">${esc(value)}</div>
            ${note ? `<div style="font-size:11px;color:${COLORS.muted};margin-top:2px;line-height:1.3;">${esc(note)}</div>` : ""}
          </td>
        </tr>
      </table>
    </td>`;
}

/** Assembles KPI cells into a 2-column grid, two per row (Sales+Orders,
 * then Avg ticket+Gross margin) — an ordinary HTML table, so it renders
 * identically (and compactly) in every mainstream email client. */
function kpiGrid(cells: string[]): string {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>${cells[i]}${cells[i + 1] ?? ""}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;"><tbody>${rows.join("")}</tbody></table>`;
}

/** Email-safe horizontal gauge: an outer light-gray bar with an inner
 * colored bar whose width is a real, known percentage — never a
 * fabricated comparison. */
function gaugeBar(pct: number, color: string): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.border};border-radius:4px;">
      <tr>
        <td style="padding:0;">
          <table role="presentation" width="${clamped}%" cellpadding="0" cellspacing="0">
            <tr><td style="background:${color};border-radius:4px;height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** «AGUACATE: el precio cambió de USD 0.13 a USD 0.55 por oz. ¿Es correcto?» (no percentage). */
export function priceReviewLine(
  name: string,
  previous: string,
  latest: string,
  unit: string,
  lang: PreferredLanguage
): string {
  return t(
    lang,
    `${name}: the price changed from ${previous} to ${latest} per ${unit}. Is that right?`,
    `${name}: el precio cambió de ${previous} a ${latest} por ${unit}. ¿Es correcto?`,
    `${name}: Der Preis hat sich von ${previous} auf ${latest} pro ${unit} geändert. Ist das korrekt?`
  );
}

/**
 * One plain line when the pre-send Odoo sync failed. Nothing when it worked
 * or was skipped (no Odoo connection) or when the send is not the automatic one.
 */
export function syncWarningText(
  ctx: BriefingContext,
  lang: PreferredLanguage
): string | null {
  const s = ctx.sync_status;
  if (!s || s.ok || s.skipped) return null;
  return t(
    lang,
    "We couldn't update the Odoo sales before this email; the figures may be incomplete.",
    "No pudimos actualizar las ventas de Odoo antes de este correo; las cifras pueden estar incompletas.",
    "Wir konnten die Odoo-Umsätze vor dieser E-Mail nicht aktualisieren; die Zahlen können unvollständig sein."
  );
}

/** Under the button, only for companies with Telegram connected. */
export function telegramNote(lang: PreferredLanguage): string {
  return t(
    lang,
    "From Telegram, your team can send recipes, invoices and price updates for you to review in Milton.",
    "Desde Telegram, tu equipo puede mandar recetas, facturas y cambios de precio para que los revises en Milton.",
    "Über Telegram kann Ihr Team Rezepte, Rechnungen und Preisänderungen senden, die Sie in Milton prüfen."
  );
}

export function renderBriefingEmail(
  ctx: BriefingContext,
  briefing: BriefingOutput,
  appUrl: string
): RenderedBriefingEmail {
  const lang = ctx.preferred_language;
  const k = ctx.kpis;
  const c = ctx.currency;
  const sp = ctx.sales_periods;
  // With dated periods the header names the day the briefing is about;
  // otherwise it states ctx.period_label verbatim.
  const headerPeriod = sp ? sp.yesterday.current.label : ctx.period_label;
  const dashboardUrl = `${appUrl.replace(/\/+$/, "")}/dashboard/restaurant/briefing`;

  const subject = t(
    lang,
    `Your Milton briefing — ${ctx.restaurant_name}`,
    `Tu briefing de Milton — ${ctx.restaurant_name}`,
    `Ihr Milton-Briefing — ${ctx.restaurant_name}`
  );

  const heading = t(
    lang,
    "Here's your latest Milton briefing",
    "Aquí tienes tu último briefing de Milton",
    "Hier ist Ihr aktuelles Milton-Briefing"
  );

  // ---- KPI cards ----
  const cards: string[] = [];
  if (sp) {
    // Dated periods: every number carries its own date label.
    const y = sp.yesterday;
    const w = sp.last_7_days;
    cards.push(
      y.current.sales !== null
        ? kpiCard(
            y.current.label,
            fmtCurrency(y.current.sales, c),
            y.delta_pct !== null
              ? `${formatDeltaPct(y.delta_pct)} vs ${y.previous.label}`
              : `${noComparisonText(lang)} (${y.previous.label})`
          )
        : kpiCard(y.current.label, "—", noYesterdaySalesText(lang))
    );
    cards.push(
      w.current.sales !== null
        ? kpiCard(
            w.current.label,
            fmtCurrency(w.current.sales, c),
            w.delta_pct !== null
              ? `${formatDeltaPct(w.delta_pct)} vs ${w.previous.label}`
              : `${noComparisonText(lang)} (${w.previous.label})`
          )
        : kpiCard(w.current.label, "—", noComparisonText(lang))
    );
    cards.push(
      y.current.orders !== null
        ? kpiCard(
            `${t(lang, "Orders", "Órdenes", "Bestellungen")} · ${y.current.label}`,
            fmtNumber(y.current.orders, lang)
          )
        : kpiCard(
            `${t(lang, "Orders", "Órdenes", "Bestellungen")} · ${y.current.label}`,
            "—"
          )
    );
    cards.push(
      y.current.avg_ticket !== null
        ? kpiCard(
            `${t(lang, "Avg ticket", "Ticket promedio", "Ø Bon")} · ${y.current.label}`,
            fmtCurrency(y.current.avg_ticket, c)
          )
        : kpiCard(
            `${t(lang, "Avg ticket", "Ticket promedio", "Ø Bon")} · ${y.current.label}`,
            "—"
          )
    );
    cards.push(
      k.estimated_gross_margin_pct !== null
        ? kpiCard(
            t(lang, "Gross margin", "Margen bruto", "Bruttomarge"),
            `${k.estimated_gross_margin_pct}%`,
            t(
              lang,
              `${k.food_cost_pct !== null ? `Food cost ${k.food_cost_pct}% · ` : ""}${ctx.period_label} · based on ${k.cost_coverage_pct}% of sales with cost`,
              `${k.food_cost_pct !== null ? `Costo de alimentos ${k.food_cost_pct}% · ` : ""}${ctx.period_label} · basado en ${k.cost_coverage_pct}% de las ventas con costo`,
              `${k.food_cost_pct !== null ? `Wareneinsatz ${k.food_cost_pct} % · ` : ""}${ctx.period_label} · basierend auf ${k.cost_coverage_pct} % des Umsatzes mit Kosten`
            )
          )
        : kpiCard(
            t(lang, "Gross margin", "Margen bruto", "Bruttomarge"),
            "—",
            k.estimated_gross_margin_pct_reason
          )
    );
  } else {
    // The dated periods could not be built: say so. Never fall back to the
    // all-time totals, they are not yesterday's or last week's sales.
    cards.push(
      kpiCard(t(lang, "Sales", "Ventas", "Umsatz"), "—", noComparisonText(lang))
    );
  }

  // ---- Visual section: only real, known-data visuals ----
  const visualParts: string[] = [];
  for (const trend of ctx.supplier_price_increases.slice(0, 2)) {
    // Unit prices can be fractions of a cent: show enough decimals that the
    // change is visible (never "0 → 0").
    const p = formatUnitPricePair(trend.previous_cost, trend.latest_cost, c);
    visualParts.push(`
      <div style="font-size:13px;color:${COLORS.text};padding:8px 0;border-top:1px solid ${COLORS.border};">
        <span style="color:${COLORS.warn};font-weight:700;">▲ ${trend.pct_change}%</span>
        &nbsp;${esc(trend.ingredient_name)} — ${esc(p.previous)} → ${esc(p.latest)} / ${esc(trend.unit)}
      </div>`);
  }
  const visualSection =
    visualParts.length > 0
      ? section(
          t(lang, "Performance", "Desempeño", "Leistung"),
          visualParts.join("")
        )
      : "";

  // ---- Price changes to check: neutral, no percentage, no red arrow ----
  const reviewItems = (ctx.price_review_items ?? []).slice(0, 3);
  const reviewSection =
    reviewItems.length > 0
      ? section(
          t(lang, "Check price", "Revisar precio", "Preis prüfen"),
          reviewItems
            .map((item) => {
              const p = formatUnitPricePair(
                item.previous_cost,
                item.latest_cost,
                c
              );
              return `<div style="font-size:13px;color:${COLORS.text};padding:6px 0;">${esc(priceReviewLine(item.ingredient_name, p.previous, p.latest, item.unit, lang))}</div>`;
            })
            .join("")
        )
      : "";

  // ---- For your team: the cost-coverage bar (not a headline number) ----
  const teamSection =
    k.cost_coverage_pct > 0
      ? section(
          t(lang, "For your team", "Para tu equipo", "Für Ihr Team"),
          `<div style="font-size:13px;color:${COLORS.text};margin-bottom:6px;">
            ${esc(t(lang, "Cost coverage", "Cobertura de costo", "Kostenabdeckung"))}: <strong>${k.cost_coverage_pct}%</strong>
          </div>
          ${gaugeBar(k.cost_coverage_pct, k.cost_coverage_pct < 90 ? COLORS.warn : COLORS.good)}`
        )
      : "";

  // ---- Watch (top risks) ----
  const watchSection =
    briefing.top_risks.length > 0
      ? section(
          t(lang, "Watch", "Atención", "Beobachten"),
          `<ul style="margin:0;padding-left:18px;color:${COLORS.text};font-size:14px;line-height:1.6;">${briefing.top_risks
            .slice(0, 3)
            .map((r) => `<li>${esc(r)}</li>`)
            .join("")}</ul>`
        )
      : "";

  // ---- Milton recommends ----
  const actionsSection =
    briefing.recommended_actions.length > 0
      ? section(
          t(lang, "Milton recommends", "Milton recomienda", "Milton empfiehlt"),
          `<ol style="margin:0;padding-left:18px;color:${COLORS.text};font-size:14px;line-height:1.6;">${briefing.recommended_actions
            .slice(0, 3)
            .map((a) => `<li>${esc(a)}</li>`)
            .join("")}</ol>`
        )
      : "";

  const salesSection =
    sp && sp.facts.length > 0
      ? section(
          t(
            lang,
            "Sales by period",
            "Ventas por periodo",
            "Umsatz nach Zeitraum"
          ),
          `<ul style="margin:0;padding-left:18px;color:${COLORS.text};font-size:13px;line-height:1.6;">${sp.facts
            .map((f) => `<li>${esc(f)}</li>`)
            .join("")}</ul>`
        )
      : "";

  // The Odoo sync that runs right before the automatic send failed: say so in
  // one plain line (never invent or zero-fill numbers; missing stays «—»).
  const syncWarning = syncWarningText(ctx, lang);
  const syncWarningHtml = syncWarning
    ? `<p style="margin:12px 0 0 0;font-size:12px;line-height:1.4;color:${COLORS.muted};">${esc(syncWarning)}</p>`
    : "";

  const bodyHtml = [
    kpiGrid(cards),
    syncWarningHtml,
    salesSection,
    visualSection,
    reviewSection,
    teamSection,
    watchSection,
    actionsSection,
  ].join("");

  const html = wrapHtml({
    lang,
    restaurantName: ctx.restaurant_name,
    periodLabel: headerPeriod,
    heading,
    bodyHtml,
    ctaLabel: t(lang, "Open Milton", "Abrir Milton", "Milton öffnen"),
    ctaUrl: dashboardUrl,
    ctaNote: ctx.telegram_connected ? telegramNote(lang) : undefined,
  });

  // ---- Plain-text fallback ----
  const textLines: string[] = [
    "MILTON",
    heading,
    `${ctx.restaurant_name} · ${headerPeriod}`,
    "",
    ...(sp
      ? [
          ...sp.facts,
          ...(syncWarning ? [syncWarning] : []),
          `${t(lang, "Gross margin", "Margen bruto", "Bruttomarge")}: ${k.estimated_gross_margin_pct !== null ? `${k.estimated_gross_margin_pct}%` : "—"} (${ctx.period_label}; ${t(lang, `based on ${k.cost_coverage_pct}% of sales with cost`, `basado en ${k.cost_coverage_pct}% de las ventas con costo`, `basierend auf ${k.cost_coverage_pct} % des Umsatzes mit Kosten`)})`,
        ]
      : [`${t(lang, "Sales", "Ventas", "Umsatz")}: ${noComparisonText(lang)}`]),
  ];
  if (reviewItems.length > 0) {
    textLines.push(
      "",
      t(lang, "CHECK PRICE", "REVISAR PRECIO", "PREIS PRÜFEN")
    );
    for (const item of reviewItems) {
      const p = formatUnitPricePair(item.previous_cost, item.latest_cost, c);
      textLines.push(
        `- ${priceReviewLine(item.ingredient_name, p.previous, p.latest, item.unit, lang)}`
      );
    }
  }
  if (k.cost_coverage_pct > 0) {
    textLines.push(
      "",
      t(lang, "FOR YOUR TEAM", "PARA TU EQUIPO", "FÜR IHR TEAM"),
      `${t(lang, "Cost coverage", "Cobertura de costo", "Kostenabdeckung")}: ${k.cost_coverage_pct}%`
    );
  }
  if (briefing.top_risks.length > 0) {
    textLines.push("", t(lang, "WATCH", "ATENCIÓN", "BEOBACHTEN"));
    for (const r of briefing.top_risks.slice(0, 3)) textLines.push(`- ${r}`);
  }
  if (briefing.recommended_actions.length > 0) {
    textLines.push(
      "",
      t(lang, "MILTON RECOMMENDS", "MILTON RECOMIENDA", "MILTON EMPFIEHLT")
    );
    briefing.recommended_actions
      .slice(0, 3)
      .forEach((a, i) => textLines.push(`${i + 1}. ${a}`));
  }
  textLines.push(
    "",
    `${t(lang, "Open Milton", "Abrir Milton", "Milton öffnen")}: ${dashboardUrl}`
  );
  if (ctx.telegram_connected) textLines.push(telegramNote(lang));

  return { subject, html, text: textLines.join("\n") };
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

function section(title: string, innerHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
      <tr>
        <td style="font-size:13px;font-weight:700;color:${COLORS.text};text-transform:uppercase;letter-spacing:0.04em;padding-bottom:8px;">${esc(title)}</td>
      </tr>
      <tr>
        <td>${innerHtml}</td>
      </tr>
    </table>`;
}

function wrapHtml(args: {
  lang: PreferredLanguage;
  restaurantName: string;
  periodLabel: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  /** A small gray line under the button (omitted when undefined). */
  ctaNote?: string;
}): string {
  const { restaurantName, periodLabel, heading, bodyHtml, ctaLabel, ctaUrl } =
    args;
  return `<!DOCTYPE html>
<html lang="${args.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(heading)}</title>
<style>
  /* Conservative, widely-supported progressive enhancement only — clients
     that ignore <style> blocks (e.g. desktop Outlook) simply keep the
     2-column KPI grid, which remains fully readable. Never relied upon
     for base layout (table widths/percentages above already work
     everywhere without this). */
  @media only screen and (max-width: 480px) {
    .kpi-cell { display: block !important; width: 100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${COLORS.card};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:${COLORS.accent};">MILTON</div>
              <div style="font-size:20px;font-weight:700;color:${COLORS.text};margin-top:10px;">${esc(heading)}</div>
              <div style="font-size:13px;color:${COLORS.muted};margin-top:4px;">${esc(restaurantName)} · ${esc(periodLabel)}</div>
              <div style="height:1px;background:${COLORS.border};margin-top:18px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0 28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px 28px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background:${COLORS.accent};">
                    <a href="${esc(ctaUrl)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              ${args.ctaNote ? `<div style="font-size:12px;color:${COLORS.muted};margin-top:12px;line-height:1.4;">${esc(args.ctaNote)}</div>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
