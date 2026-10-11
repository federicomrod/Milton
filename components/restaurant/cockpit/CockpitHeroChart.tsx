// components/restaurant/cockpit/CockpitHeroChart.tsx
//
// Daily net sales for the selected period (solid) vs previous (dashed).
// Hover values come from the backend DTO — no KPI math here.

"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { localeForCurrency } from "@/lib/restaurant/currency";
import type { DailyNetPoint } from "@/lib/restaurant/cockpit-executive";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export function CockpitHeroChart({
  lang,
  currency,
  points,
}: {
  lang: PreferredLanguage;
  currency: string;
  points: DailyNetPoint[];
}) {
  const locale = localeForCurrency(currency);
  const dateLocale = lang === "es" ? "es" : "en-US";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moneyAxis = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    maximumFractionDigits: 0,
  });

  const data = points.map((p) => ({
    ...p,
    label: shortDay(p.date, dateLocale),
  }));
  const summary =
    points.length === 0
      ? t(
          lang,
          "No daily net sales in this period.",
          "No hay ventas netas diarias en este periodo."
        )
      : t(
          lang,
          `Daily net sales from ${points[0].date} to ${points[points.length - 1].date}.`,
          `Ventas netas diarias del ${points[0].date} al ${points[points.length - 1].date}.`
        );

  return (
    <section
      data-testid="cockpit-hero-chart"
      aria-label={summary}
      className="rounded-md border border-border px-3 py-2.5 min-h-[220px]"
    >
      <h2 className="text-sm font-semibold">
        {t(lang, "Net sales by day", "Ventas netas por día")}
      </h2>
      <p className="text-[11px] text-muted-foreground mb-1.5">
        {t(
          lang,
          "Solid = this period. Dashed = previous period. Tips excluded.",
          "Línea continua = este periodo. Punteada = periodo anterior. Sin propinas."
        )}
      </p>
      {data.length === 0 ? (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "No daily sales in this period.",
            "No hay ventas diarias en este periodo."
          )}
        />
      ) : (
        <>
          <table className="sr-only">
            <caption>{summary}</caption>
            <thead>
              <tr>
                <th>{t(lang, "Date", "Fecha")}</th>
                <th>{t(lang, "Net sales", "Ventas netas")}</th>
                <th>{t(lang, "Previous period", "Periodo anterior")}</th>
                <th>{t(lang, "Tickets", "Tickets")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{money.format(point.current_net)}</td>
                  <td>
                    {point.previous_net == null
                      ? t(lang, "n/a", "n/d")
                      : money.format(point.previous_net)}
                  </td>
                  <td>{point.current_tickets}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-[168px]" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={64}
                  tickFormatter={(n: number) => moneyAxis.format(n)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const point = payload[0].payload as DailyNetPoint & {
                      label: string;
                    };
                    const vs =
                      point.vs_previous_pct == null
                        ? t(lang, "no previous day", "sin día anterior")
                        : `${point.vs_previous_pct > 0 ? "+" : ""}${point.vs_previous_pct.toFixed(1)}%`;
                    return (
                      <div className="rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-sm">
                        <p className="font-medium mb-1">{point.label}</p>
                        <p>
                          {t(lang, "Net sales", "Ventas netas")}{" "}
                          {money.format(point.current_net)}
                        </p>
                        <p>
                          {t(lang, "vs previous", "vs anterior")} {vs}
                        </p>
                        <p>
                          {t(lang, "Tickets", "Tickets")}{" "}
                          {point.current_tickets}
                        </p>
                        <p>
                          {t(lang, "Avg ticket", "Ticket promedio")}{" "}
                          {money.format(point.current_avg_ticket)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="current_net"
                  name="current"
                  stroke="hsl(24 80% 45%)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="previous_net"
                  name="previous"
                  stroke="hsl(210 20% 45%)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

export function CockpitHeroChartSkeleton() {
  return (
    <div className="rounded-md border border-border px-3 py-2.5 min-h-[220px]">
      <PageSkeleton height="220px" width="100%" />
    </div>
  );
}

function shortDay(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
