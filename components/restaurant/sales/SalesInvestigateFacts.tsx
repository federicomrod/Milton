// components/restaurant/sales/SalesInvestigateFacts.tsx
//
// Overflow facts (strongest weekday, best date) live on Investigate.

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { t } from "@/lib/restaurant/language";
import type { SalesHighlight } from "@/lib/restaurant/sales-insights";

export function SalesInvestigateFacts({
  facts,
  lang,
}: {
  facts: SalesHighlight[];
  lang: PreferredLanguage;
}) {
  if (facts.length === 0) return null;

  return (
    <section
      data-testid="sales-investigate-facts"
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <h2 className="text-sm font-semibold">
        {t(lang, "More findings", "Más hallazgos")}
      </h2>
      <ul className="space-y-3">
        {facts.map((item) => (
          <li key={item.id} className="space-y-1">
            <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
              {item.title}
            </p>
            <p className="text-sm font-medium leading-snug">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
