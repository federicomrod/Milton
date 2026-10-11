// components/restaurant/cockpit/SalesHero.tsx
//
// Sales tab hero: hour × weekday heatmap, lunch vs dinner, channel and
// payment mix over time. All numbers are net sales.

"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import { DINNER_START_HOUR } from "@/lib/restaurant/sales-revenue";
import { localeForCurrency } from "@/lib/restaurant/currency";
import { SalesHeatmap } from "./SalesHeatmap";
import { salesChannelLabel } from "@/lib/restaurant/sales-channel-labels";

const MIX_COLORS = [
  "hsl(24 80% 50%)",
  "hsl(210 55% 45%)",
  "hsl(160 40% 36%)",
  "hsl(280 35% 48%)",
  "hsl(40 70% 44%)",
  "hsl(200 20% 40%)",
];

export function SalesHero({
  cockpit,
  lang,
}: {
  cockpit: CockpitSalesAggregate;
  lang: PreferredLanguage;
}) {
  const locale = localeForCurrency(cockpit.currency);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(cockpit.currency) ? cockpit.currency : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="space-y-4">
      <section>
        <h2 className="text-base font-semibold mb-1">
          {t(
            lang,
            "Net sales by hour × weekday",
            "Ventas netas por hora × día"
          )}
        </h2>
        <p className="text-xs text-muted-foreground mb-2">
          {t(
            lang,
            `Restaurant timezone ${cockpit.timezone}. Lunch is before ${DINNER_START_HOUR}:00; dinner is ${DINNER_START_HOUR}:00 and after.`,
            `Zona horaria del restaurante ${cockpit.timezone}. Almuerzo es antes de las ${DINNER_START_HOUR}:00; cena es desde las ${DINNER_START_HOUR}:00.`
          )}
        </p>
        <SalesHeatmap
          cells={cockpit.heatmap}
          currency={cockpit.currency}
          lang={lang}
        />
      </section>

      <section>
        <h2 className="text-base font-semibold mb-2">
          {t(lang, "Lunch vs dinner", "Almuerzo vs cena")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cockpit.dayparts.map((part) => (
            <div
              key={part.daypart}
              className="rounded-md border border-border px-3 py-2"
            >
              <p className="text-xs font-medium text-muted-foreground">
                {part.daypart === "lunch"
                  ? t(lang, "Lunch", "Almuerzo")
                  : t(lang, "Dinner", "Cena")}{" "}
                <span className="font-normal">({part.hours})</span>
              </p>
              <p className="text-lg font-semibold tabular-nums mt-0.5">
                {money.format(part.net_sales)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t(lang, "Avg ticket", "Ticket promedio")}{" "}
                {money.format(part.avg_ticket)} · {part.tickets}{" "}
                {t(lang, "tickets", "tickets")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MixChart
          title={t(
            lang,
            "Channel mix over time",
            "Mix de canales en el tiempo"
          )}
          subtitle={t(
            lang,
            "Calendar weeks Mon–Sun (not the rolling 7-day KPI window).",
            "Semanas calendario lun–dom (no la ventana móvil de 7 días del KPI)."
          )}
          series={cockpit.channel_mix_over_time}
          currency={cockpit.currency}
          locale={locale}
          lang={lang}
          labelFor={salesChannelLabel}
        />
        <MixChart
          title={t(lang, "Payment mix over time", "Mix de pagos en el tiempo")}
          subtitle={t(
            lang,
            "Calendar weeks Mon–Sun (not the rolling 7-day KPI window).",
            "Semanas calendario lun–dom (no la ventana móvil de 7 días del KPI)."
          )}
          series={cockpit.payment_mix_over_time}
          currency={cockpit.currency}
          locale={locale}
          lang={lang}
          labelFor={(key) =>
            key === "unknown"
              ? t(lang, "Unknown payment", "Pago desconocido")
              : key
          }
        />
      </section>
    </div>
  );
}

function MixChart({
  title,
  subtitle,
  series,
  currency,
  locale,
  lang,
  labelFor,
}: {
  title: string;
  subtitle?: string;
  series: CockpitSalesAggregate["channel_mix_over_time"];
  currency: string;
  locale: string;
  lang: PreferredLanguage;
  labelFor: (key: string, lang: PreferredLanguage) => string;
}) {
  const keys = Array.from(
    new Set(series.flatMap((p) => Object.keys(p.values)))
  ).sort();
  const data = series.map((p) => ({ period: p.period.slice(5), ...p.values }));
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  if (data.length === 0 || keys.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4">
        <p className="text-sm font-medium">{title}</p>
        {subtitle ? (
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        ) : null}
        <p className="text-xs text-muted-foreground mt-1">
          {t(lang, "No mix to show yet.", "Aún no hay mix para mostrar.")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border px-3 py-3">
      <p className="text-sm font-medium mb-0.5">{title}</p>
      {subtitle ? (
        <p className="text-[11px] text-muted-foreground mb-2">{subtitle}</p>
      ) : (
        <div className="mb-2" />
      )}
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(n: number) => money.format(n)}
              width={64}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                money.format(Number(value) || 0),
                labelFor(name, lang),
              ]}
            />
            {keys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stackId="mix"
                stroke={MIX_COLORS[i % MIX_COLORS.length]}
                fill={MIX_COLORS[i % MIX_COLORS.length]}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
