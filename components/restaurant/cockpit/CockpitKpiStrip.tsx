// components/restaurant/cockpit/CockpitKpiStrip.tsx
//
// Above-the-fold KPI strip at 1280×800 (#123 / #85 / #129).
// Numbers and availability come from the backend DTO. Never a bare dash.

"use client";

import type { ReactNode } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { formatCompactDateRange } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";
import {
  polishCockpitCopy,
  type CockpitKpiStripModel,
} from "@/lib/restaurant/cockpit-executive";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";

export function CockpitKpiStrip({
  model,
  lang,
  costSlot,
}: {
  model: CockpitKpiStripModel;
  lang: PreferredLanguage;
  /** When set, replaces the two cost KPI cells (used to stream them in). */
  costSlot?: ReactNode;
}) {
  const locale = localeForCurrency(model.currency);
  const dateLocale = lang === "es" ? "es" : "en-GB";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(model.currency) ? model.currency : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moneyCompact = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(model.currency) ? model.currency : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const rev = model.secondary;
  const week = model.week_vs_last_week;
  const weekDelta = week.delta_pct;
  const weekUp = weekDelta != null && weekDelta > 0;
  const weekDown = weekDelta != null && weekDelta < 0;
  const estimatedHint = rev.discounts_estimated
    ? ` ${t(lang, "(estimated)", "(estimado)")}`
    : "";
  const weekRangeLabel =
    week.available && week.this_week && week.last_week
      ? `${formatCompactDateRange(week.this_week.from, week.this_week.to, dateLocale)} vs ${formatCompactDateRange(week.last_week.from, week.last_week.to, dateLocale)}`
      : t(lang, "This week is not available yet.", "Aún no disponible");

  return (
    <section aria-label={t(lang, "Key numbers", "Cifras clave")}>
      <p className="text-[12px] text-muted-foreground mb-1">
        {t(lang, "Key numbers", "Cifras clave")}
        {model.period_label ? ` · ${model.period_label}` : ""}
      </p>
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-1.5">
        <Kpi
          label={t(lang, "Net sales", "Ventas netas")}
          value={moneyCompact.format(model.net_sales.value)}
          delta={model.net_sales.delta_pct}
          lang={lang}
          sub={
            rev.tips > 0
              ? polishCockpitCopy(
                  lang,
                  t(
                    lang,
                    `Tips ${money.format(rev.tips)} excluded`,
                    `Propinas ${money.format(rev.tips)} excluidas`
                  )
                )
              : polishCockpitCopy(
                  lang,
                  t(
                    lang,
                    "versus the previous period",
                    "frente al periodo anterior"
                  )
                )
          }
        />
        {costSlot ? (
          costSlot
        ) : model.cost_pending ? (
          <>
            <div
              role="status"
              aria-label={t(lang, "Gross margin %", "Margen bruto %")}
              className="animate-pulse rounded-md bg-muted/70 min-h-[4.5rem]"
            />
            <div
              role="status"
              aria-label={t(lang, "Food cost %", "% costo de comida")}
              className="animate-pulse rounded-md bg-muted/70 min-h-[4.5rem]"
            />
          </>
        ) : model.gross_margin_pct.available ? (
          <Kpi
            label={t(lang, "Gross margin %", "Margen bruto %")}
            value={`${model.gross_margin_pct.value.toFixed(1)}%`}
            delta={model.gross_margin_pct.delta_pct}
            lang={lang}
            sub={t(
              lang,
              "on covered net sales",
              "sobre ventas netas cubiertas"
            )}
          />
        ) : (
          <NotAvailableYet
            lang={lang}
            compact
            reason={model.gross_margin_pct.reason}
            href={model.gross_margin_pct.href}
            linkLabel={model.gross_margin_pct.link_label}
          />
        )}
        {costSlot ? null : model.cost_pending ? null : model.food_cost_pct
            .available ? (
          <Kpi
            label={t(lang, "Food cost %", "% costo de comida")}
            value={`${model.food_cost_pct.value.toFixed(1)}%`}
            delta={model.food_cost_pct.delta_pct}
            lang={lang}
            sub={t(
              lang,
              "on covered net sales",
              "sobre ventas netas cubiertas"
            )}
          />
        ) : (
          <NotAvailableYet
            lang={lang}
            compact
            reason={model.food_cost_pct.reason}
            href={model.food_cost_pct.href}
            linkLabel={model.food_cost_pct.link_label}
          />
        )}
        <Kpi
          label={t(lang, "Average ticket", "Ticket promedio")}
          value={money.format(model.avg_ticket.value)}
          delta={model.avg_ticket.delta_pct}
          lang={lang}
          sub={t(lang, "per order · net", "por orden · neto")}
        />
        <Kpi
          label={t(lang, "Tickets", "Tickets")}
          value={model.tickets.value.toLocaleString(locale)}
          delta={model.tickets.delta_pct}
          lang={lang}
          sub={t(lang, "unique checks", "cuentas únicas")}
        />
        {week.available ? (
          <Kpi
            label={t(lang, "Week vs last week", "Semana vs anterior")}
            value={
              weekDelta == null
                ? t(lang, "No previous week", "Sin semana anterior")
                : `${weekUp ? "+" : ""}${weekDelta.toFixed(1)}%`
            }
            valueClass={
              weekUp
                ? "text-emerald-700 dark:text-emerald-400"
                : weekDown
                  ? "text-amber-800 dark:text-amber-300"
                  : undefined
            }
            sub={weekRangeLabel}
          />
        ) : (
          <NotAvailableYet
            lang={lang}
            compact
            reason={
              week.reason ??
              t(lang, "This week is not available yet.", "Aún no disponible")
            }
          />
        )}
      </div>

      <p className="text-[12px] text-muted-foreground mt-1">
        {t(lang, "Gross", "Bruto")} {money.format(rev.gross_sales)}
        {estimatedHint}
        {" · "}
        {t(lang, "Discounts", "Descuentos")} {money.format(rev.discounts)}
        {estimatedHint}
        {" · "}
        {t(lang, "Net", "Neto")} {money.format(rev.net_sales)}
        {rev.tips > 0 ? (
          <>
            {" · "}
            {t(lang, "Tips", "Propinas")} {money.format(rev.tips)}
            {". "}
            {t(
              lang,
              "Totals differ from Odoo by the tip amount.",
              "Los totales difieren de Odoo por el monto de propinas."
            )}
          </>
        ) : null}
      </p>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass,
  delta,
  lang,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  delta?: number | null;
  lang?: PreferredLanguage;
}) {
  const deltaClass =
    delta == null
      ? ""
      : delta > 0
        ? "text-emerald-700 dark:text-emerald-400"
        : delta < 0
          ? "text-amber-800 dark:text-amber-300"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 min-h-[4.5rem]">
      <p
        className="text-[12px] font-medium text-muted-foreground truncate"
        title={label}
      >
        {label}
      </p>
      <p
        className={
          "text-lg font-semibold tabular-nums leading-tight " +
          (valueClass ?? "")
        }
      >
        {value}
      </p>
      {delta !== undefined ? (
        <p className={"text-[12px] tabular-nums " + deltaClass}>
          {delta == null
            ? t(lang ?? "es", "no previous period", "sin periodo anterior")
            : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
        </p>
      ) : null}
      {sub ? (
        <p
          className="text-[12px] text-muted-foreground mt-0.5 leading-snug"
          title={sub}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
