// components/restaurant/kitchen/KitchenHighlights.tsx
//
// «Para que sepas» — short sub-list under «Necesita atención hoy».
// Empty highlights render nothing (no empty box).

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { KitchenHighlight } from "@/lib/restaurant/kitchen-insights";

export function KitchenHighlights({
  highlights,
  lang,
  source = "deterministic",
}: {
  highlights: KitchenHighlight[];
  empty: string;
  lang: PreferredLanguage;
  source?: "openai" | "deterministic";
}) {
  if (highlights.length === 0) return null;

  return (
    <section
      data-testid="kitchen-highlights"
      data-source={source}
      className="mt-3 pt-3 border-t border-border"
    >
      <h3 className="text-sm font-semibold text-[#0D1117] mb-2">
        {t(lang, "So you know", "Para que sepas")}
      </h3>
      <ul className="space-y-2">
        {highlights.map((item) => (
          <li
            key={item.id}
            data-testid={`kitchen-highlight-${item.id}`}
            className="min-w-0"
          >
            <p className="text-[12px] text-muted-foreground">{item.title}</p>
            <p className="text-sm font-semibold leading-snug">{item.value}</p>
            {item.hint ? (
              <p className="text-xs text-muted-foreground">{item.hint}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
