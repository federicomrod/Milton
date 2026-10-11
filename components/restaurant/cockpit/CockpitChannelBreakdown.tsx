// components/restaurant/cockpit/CockpitChannelBreakdown.tsx
//
// Compact channel mix bars. Shares come from the backend snapshot.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { localeForCurrency } from "@/lib/restaurant/currency";
import type { ChannelShare } from "@/lib/restaurant/cockpit-executive";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";

export function CockpitChannelBreakdown({
  lang,
  currency,
  channels,
}: {
  lang: PreferredLanguage;
  currency: string;
  channels: ChannelShare[];
}) {
  const locale = localeForCurrency(currency);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    maximumFractionDigits: 0,
  });
  const max = Math.max(...channels.map((c) => c.net_sales), 0);

  return (
    <section
      data-testid="cockpit-channel-breakdown"
      className="rounded-md border border-border px-3 py-2.5 min-h-[220px]"
    >
      <h2 className="text-sm font-semibold">
        {t(lang, "Sales by channel", "Ventas por canal")}
      </h2>
      <p className="text-[11px] text-muted-foreground mb-2">
        {t(lang, "Net sales, tips excluded.", "Ventas netas, sin propinas.")}
      </p>
      {channels.length === 0 ? (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "No channel mix in this period.",
            "No hay mix de canales en este periodo."
          )}
        />
      ) : (
        <ul className="space-y-2">
          {channels.map((channel) => {
            const width = max > 0 ? (channel.net_sales / max) * 100 : 0;
            const shift =
              channel.delta_pp == null
                ? null
                : `${channel.delta_pp > 0 ? "+" : ""}${channel.delta_pp.toFixed(1)} pp`;
            return (
              <li key={channel.channel}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium truncate">{channel.label}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {money.format(channel.net_sales)} ·{" "}
                    {channel.share_pct.toFixed(1)}%{shift ? ` (${shift})` : ""}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-orange-500"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
