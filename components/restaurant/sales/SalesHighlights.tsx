// components/restaurant/sales/SalesHighlights.tsx
//
// "Lo que destaca" — up to 3 deterministic facts. No per-item Ask Milton.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type {
  SalesAvailability,
  SalesHighlight,
} from "@/lib/restaurant/sales-insights";

export function SalesHighlights({
  highlights,
  availability,
  lang,
}: {
  highlights: SalesHighlight[];
  availability: SalesAvailability;
  lang: PreferredLanguage;
}) {
  return (
    <section
      data-testid="sales-highlights"
      className="rounded-md border border-border bg-background px-3 py-3 h-full"
    >
      <h2 className="text-sm font-semibold mb-2">
        {t(lang, "What stands out", "Lo que destaca")}
      </h2>
      {highlights.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="sales-highlights-empty"
        >
          {availability === "empty"
            ? t(
                lang,
                "No sales in this period.",
                "No hay ventas en este periodo."
              )
            : t(
                lang,
                "Not enough history yet to name a strongest day or slot.",
                "Aún no hay suficiente historia para marcar un día o una franja."
              )}
        </p>
      ) : (
        <ul className="space-y-3">
          {highlights.map((item) => (
            <li key={item.id} data-testid={`sales-highlight-${item.id}`}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.title}
              </p>
              <p className="text-sm font-medium leading-snug">{item.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
