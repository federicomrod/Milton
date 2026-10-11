// components/restaurant/sales/SalesHighlights.tsx
//
// "Lo que destaca" — peak / strongest / weakest, already computed.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { SalesHighlight } from "@/lib/restaurant/sales-insights";
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";

export function SalesHighlights({
  highlights,
  lang,
}: {
  highlights: SalesHighlight[];
  lang: PreferredLanguage;
}) {
  const { openAskMilton } = useAskMiltonController();

  return (
    <section
      data-testid="sales-highlights"
      className="rounded-md border border-border bg-background px-3 py-3 h-full"
    >
      <h2 className="text-sm font-semibold mb-2">
        {t(lang, "What stands out", "Lo que destaca")}
      </h2>
      {highlights.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            lang,
            "Not enough sales in this period to pick a peak yet.",
            "Aún no hay suficientes ventas en este periodo para marcar un pico."
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {highlights.map((item) => (
            <li key={item.id} className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.title}
              </p>
              <p className="text-sm font-medium leading-snug">{item.body}</p>
              <button
                type="button"
                data-testid={`ask-milton-${item.id}`}
                onClick={() => openAskMilton(item.ask_question)}
                className="text-xs font-medium text-orange-700 dark:text-orange-300 hover:underline underline-offset-2"
              >
                {t(lang, "Ask Milton", "Preguntar a Milton")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
