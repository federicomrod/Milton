// lib/restaurant/push/copy.ts
//
// What a notification says. Figures come only from numbers the server already
// computed; a missing figure is left out (the message never shows 0 or a guess).

import { fmt, getDictionary } from "@/lib/i18n";
import { formatMoney } from "@/lib/restaurant/costs-format";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { PushScreen } from "@/lib/restaurant/push/policy";

export interface PushMessage {
  title: string;
  body: string;
  data: { screen: PushScreen };
}

export function dailyMessage(args: {
  lang: PreferredLanguage;
  currency: string;
  salesYesterday: number | null;
  profitMonth: number | null;
}): PushMessage {
  const p = getDictionary(args.lang).kitchen.push;
  const money = (n: number) => formatMoney(n, args.currency, args.lang);
  const lines: string[] = [];
  if (args.salesYesterday !== null && Number.isFinite(args.salesYesterday)) {
    lines.push(fmt(p.dailySales, { amount: money(args.salesYesterday) }));
  }
  if (args.profitMonth !== null && Number.isFinite(args.profitMonth)) {
    lines.push(fmt(p.dailyProfit, { amount: money(args.profitMonth) }));
  }
  return {
    title: p.dailyTitle,
    body: lines.length > 0 ? lines.join(" ") : p.dailyReady,
    data: { screen: "inicio" },
  };
}

export function invoicesMessage(args: {
  lang: PreferredLanguage;
  count: number;
}): PushMessage {
  const p = getDictionary(args.lang).kitchen.push;
  return {
    title: p.invoicesTitle,
    body:
      args.count === 1
        ? p.invoicesOne
        : fmt(p.invoicesMany, { count: args.count }),
    data: { screen: "costos" },
  };
}
