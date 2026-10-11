// components/restaurant/cockpit/CockpitKpiStrip.tsx
//
// Above-the-fold KPI strip at 1280×800 (#123 / #85): net sales, average
// ticket, tickets, week vs last week. Food cost % and margin appear only
// when recipe costs exist.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import { formatCompactDateRange } from "@/lib/restaurant/cockpit-aggregates";
import { localeForCurrency } from "@/lib/restaurant/currency";

export function CockpitKpiStrip({
  cockpit,
  lang,
  foodCostPct,
  marginPct,
  hasRecipeCosts,
}: {
  cockpit: CockpitSalesAggregate;
  lang: PreferredLanguage;
  foodCostPct: number | null;
  marginPct: number | null;
  hasRecipeCosts: boolean;
}) {
  const locale = localeForCurrency(cockpit.currency);
  const dateLocale = lang === "es" ? "es" : "en-GB";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(cockpit.currency) ? cockpit.currency : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moneyCompact = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(cockpit.currency) ? cockpit.currency : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const rev = cockpit.revenue;
  const weekDelta = cockpit.week_delta_pct;
  const weekUp = weekDelta != null && weekDelta > 0;
  const weekDown = weekDelta != null && weekDelta < 0;
  const estimatedHint = rev.discounts_estimated
    ? ` ${t(lang, "(estimated)", "(estimado)")}`
    : "";
  const periodLabel =
    cockpit.period_from && cockpit.period_to
      ? formatCompactDateRange(
          cockpit.period_from,
          cockpit.period_to,
          dateLocale
        )
      : null;
  const weekRangeLabel =
    cockpit.this_week && cockpit.last_week
      ? `${formatCompactDateRange(cockpit.this_week.from, cockpit.this_week.to, dateLocale)} vs ${formatCompactDateRange(cockpit.last_week.from, cockpit.last_week.to, dateLocale)}`
      : t(lang, "needs two weeks of sales", "hacen falta dos semanas");

  return (
    <section aria-label={t(lang, "Key numbers", "Cifras clave")}>
      <p className="text-[11px] text-muted-foreground mb-1">
        {t(
          lang,
          "KPI strip · all loaded data",
          "Cifras clave · todos los datos cargados"
        )}
        {periodLabel ? ` · ${periodLabel}` : ""}
        {t(
          lang,
          " (not the Explorer date filter)",
          " (no el filtro de fechas del Explorer)"
        )}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
        <Kpi
          label={t(
            lang,
            "Net sales (all loaded data)",
            "Ventas netas (todos los datos cargados)"
          )}
          value={moneyCompact.format(rev.net_sales)}
          sub={
            rev.tips > 0
              ? t(
                  lang,
                  `Tips ${money.format(rev.tips)} excluded`,
                  `Propinas ${money.format(rev.tips)} excluidas`
                )
              : undefined
          }
        />
        <Kpi
          label={t(lang, "Average ticket", "Ticket promedio")}
          value={money.format(cockpit.avg_ticket)}
          sub={t(lang, "per order · net", "por orden · neto")}
        />
        <Kpi
          label={t(lang, "Tickets", "Tickets")}
          value={cockpit.tickets.toLocaleString(locale)}
          sub={t(lang, "unique checks", "cuentas únicas")}
        />
        <Kpi
          label={t(lang, "Week vs last week", "Semana vs anterior")}
          value={
            weekDelta == null
              ? "—"
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
      </div>

      <p className="text-[11px] text-muted-foreground mt-1">
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

      {hasRecipeCosts ? (
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          <Kpi
            label={t(lang, "Food cost %", "% costo de comida")}
            value={foodCostPct != null ? `${foodCostPct.toFixed(1)}%` : "—"}
            sub={t(
              lang,
              "on covered net sales",
              "sobre ventas netas cubiertas"
            )}
          />
          <Kpi
            label={t(lang, "Margin", "Margen")}
            value={marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
            sub={t(
              lang,
              "on covered net sales",
              "sobre ventas netas cubiertas"
            )}
          />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground mt-1">
          {t(
            lang,
            "Add recipes to see food cost % and margin.",
            "Agrega recetas para ver % de costo y margen."
          )}
        </p>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5">
      <p
        className="text-[11px] font-medium text-muted-foreground truncate"
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
      {sub ? (
        <p
          className="text-[10px] text-muted-foreground mt-0.5 leading-snug"
          title={sub}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
