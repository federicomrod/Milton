// components/restaurant/sales/SalesRankedBars.tsx
//
// Compact SVG ranked bars. Lengths come from already-aggregated net sales.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { localeForCurrency } from "@/lib/restaurant/currency";

export interface RankedBarRow {
  key: string;
  label: string;
  net_sales: number;
}

export function SalesRankedBars({
  rows,
  currency,
  lang,
  emptyLabel,
}: {
  rows: RankedBarRow[];
  currency: string;
  lang: PreferredLanguage;
  emptyLabel?: string;
}) {
  const locale = localeForCurrency(currency);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const max = rows.reduce((m, row) => Math.max(m, row.net_sales), 0);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        {emptyLabel ??
          t(lang, "Nothing to show yet.", "Aún no hay nada para mostrar.")}
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="sales-ranked-bars">
      {rows.map((row) => {
        const width = max > 0 ? Math.max(4, (row.net_sales / max) * 100) : 4;
        return (
          <li key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{row.label}</span>
              <span className="tabular-nums shrink-0 text-muted-foreground">
                {money.format(row.net_sales)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-[hsl(24_80%_50%)]"
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
