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
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

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
  return n.toLocaleString(lang === "es" ? "es-MX" : "en-US");
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

export function renderBriefingEmail(
  ctx: BriefingContext,
  briefing: BriefingOutput,
  appUrl: string
): RenderedBriefingEmail {
  const lang = ctx.preferred_language;
  const k = ctx.kpis;
  const c = ctx.currency;
  const dashboardUrl = `${appUrl.replace(/\/+$/, "")}/dashboard/restaurant/briefing`;

  const subject = t(
    lang,
    `Your Milton briefing — ${ctx.restaurant_name}`,
    `Tu briefing de Milton — ${ctx.restaurant_name}`
  );

  const heading = t(
    lang,
    "Here's your latest Milton briefing",
    "Aquí tienes tu último briefing de Milton"
  );

  // ---- No revenue yet: simplified body, no fabricated KPIs ----
  if (k.revenue <= 0) {
    const noDataLine = t(
      lang,
      "No POS revenue is loaded yet — import sales to see live KPIs here.",
      "Aún no hay ingresos de POS cargados — importa tus ventas para ver KPIs en vivo aquí."
    );
    const html = wrapHtml({
      lang,
      restaurantName: ctx.restaurant_name,
      periodLabel: ctx.period_label,
      heading,
      bodyHtml: `<p style="font-size:14px;color:${COLORS.text};line-height:1.5;">${esc(noDataLine)}</p>`,
      ctaLabel: t(lang, "Open Milton", "Abrir Milton"),
      ctaUrl: dashboardUrl,
    });
    const text = [
      "MILTON",
      heading,
      `${ctx.restaurant_name} · ${ctx.period_label}`,
      "",
      noDataLine,
      "",
      `${t(lang, "Open Milton", "Abrir Milton")}: ${dashboardUrl}`,
    ].join("\n");
    return { subject, html, text };
  }

  // ---- KPI cards ----
  const cards: string[] = [];
  cards.push(kpiCard(t(lang, "Sales", "Ventas"), fmtCurrency(k.revenue, c)));
  cards.push(
    k.orders !== null
      ? kpiCard(t(lang, "Orders", "Órdenes"), fmtNumber(k.orders, lang))
      : kpiCard(t(lang, "Orders", "Órdenes"), "—", k.orders_reason)
  );
  cards.push(
    k.avg_ticket !== null
      ? kpiCard(
          t(lang, "Avg ticket", "Ticket promedio"),
          fmtCurrency(k.avg_ticket, c)
        )
      : kpiCard(
          t(lang, "Avg ticket", "Ticket promedio"),
          "—",
          k.avg_ticket_reason
        )
  );
  cards.push(
    k.estimated_gross_margin_pct !== null
      ? kpiCard(
          t(lang, "Gross margin", "Margen bruto"),
          `${k.estimated_gross_margin_pct}%`,
          k.food_cost_pct !== null
            ? t(
                lang,
                `Food cost ${k.food_cost_pct}%`,
                `Costo de alimentos ${k.food_cost_pct}%`
              )
            : undefined
        )
      : kpiCard(
          t(lang, "Gross margin", "Margen bruto"),
          "—",
          k.estimated_gross_margin_pct_reason
        )
  );

  // ---- Visual section: only real, known-data visuals ----
  const visualParts: string[] = [];
  if (k.cost_coverage_pct > 0) {
    visualParts.push(`
      <div style="margin-bottom:14px;">
        <div style="font-size:13px;color:${COLORS.text};margin-bottom:6px;">
          ${esc(t(lang, "Cost coverage", "Cobertura de costo"))}: <strong>${k.cost_coverage_pct}%</strong>
        </div>
        ${gaugeBar(k.cost_coverage_pct, k.cost_coverage_pct < 90 ? COLORS.warn : COLORS.good)}
      </div>`);
  }
  for (const trend of ctx.supplier_price_increases.slice(0, 2)) {
    visualParts.push(`
      <div style="font-size:13px;color:${COLORS.text};padding:8px 0;border-top:1px solid ${COLORS.border};">
        <span style="color:${COLORS.warn};font-weight:700;">▲ ${trend.pct_change}%</span>
        &nbsp;${esc(trend.ingredient_name)} — ${fmtCurrency(trend.previous_cost, c)} → ${fmtCurrency(trend.latest_cost, c)} / ${esc(trend.unit)}
      </div>`);
  }
  const visualSection =
    visualParts.length > 0
      ? section(t(lang, "Performance", "Desempeño"), visualParts.join(""))
      : "";

  // ---- Watch (top risks) ----
  const watchSection =
    briefing.top_risks.length > 0
      ? section(
          t(lang, "Watch", "Atención"),
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
          t(lang, "Milton recommends", "Milton recomienda"),
          `<ol style="margin:0;padding-left:18px;color:${COLORS.text};font-size:14px;line-height:1.6;">${briefing.recommended_actions
            .slice(0, 3)
            .map((a) => `<li>${esc(a)}</li>`)
            .join("")}</ol>`
        )
      : "";

  const bodyHtml = [
    kpiGrid(cards),
    visualSection,
    watchSection,
    actionsSection,
  ].join("");

  const html = wrapHtml({
    lang,
    restaurantName: ctx.restaurant_name,
    periodLabel: ctx.period_label,
    heading,
    bodyHtml,
    ctaLabel: t(lang, "Open Milton", "Abrir Milton"),
    ctaUrl: dashboardUrl,
  });

  // ---- Plain-text fallback ----
  const textLines: string[] = [
    "MILTON",
    heading,
    `${ctx.restaurant_name} · ${ctx.period_label}`,
    "",
    `${t(lang, "Sales", "Ventas")}: ${fmtCurrency(k.revenue, c)}`,
    `${t(lang, "Orders", "Órdenes")}: ${k.orders !== null ? fmtNumber(k.orders, lang) : "—"}`,
    `${t(lang, "Avg ticket", "Ticket promedio")}: ${k.avg_ticket !== null ? fmtCurrency(k.avg_ticket, c) : "—"}`,
    `${t(lang, "Gross margin", "Margen bruto")}: ${k.estimated_gross_margin_pct !== null ? `${k.estimated_gross_margin_pct}%` : "—"}`,
  ];
  if (briefing.top_risks.length > 0) {
    textLines.push("", t(lang, "WATCH", "ATENCIÓN"));
    for (const r of briefing.top_risks.slice(0, 3)) textLines.push(`- ${r}`);
  }
  if (briefing.recommended_actions.length > 0) {
    textLines.push("", t(lang, "MILTON RECOMMENDS", "MILTON RECOMIENDA"));
    briefing.recommended_actions
      .slice(0, 3)
      .forEach((a, i) => textLines.push(`${i + 1}. ${a}`));
  }
  textLines.push(
    "",
    `${t(lang, "Open Milton", "Abrir Milton")}: ${dashboardUrl}`
  );

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
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
