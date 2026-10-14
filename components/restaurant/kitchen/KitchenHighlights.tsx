// components/restaurant/kitchen/KitchenHighlights.tsx
//
// "Lo que destaca" — up to 3 backend facts. AI may only reword.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { KitchenHighlight } from "@/lib/restaurant/kitchen-insights";

const ICON: Record<
  KitchenHighlight["id"],
  { bg: string; fg: string; mark: string }
> = {
  most_reported: {
    bg: "bg-red-50 dark:bg-red-950/40",
    fg: "text-red-600",
    mark: "!",
  },
  peak_hour: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    fg: "text-blue-700 dark:text-blue-300",
    mark: "↻",
  },
  staff_active: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    fg: "text-emerald-700",
    mark: "✓",
  },
};

export function KitchenHighlights({
  highlights,
  empty,
  lang,
  source = "deterministic",
}: {
  highlights: KitchenHighlight[];
  empty: string;
  lang: PreferredLanguage;
  source?: "openai" | "deterministic";
}) {
  return (
    <section
      data-testid="kitchen-highlights"
      data-source={source}
      className="rounded-md border border-border bg-background px-3 py-3 h-full"
    >
      <h2 className="text-sm font-semibold">
        {t(lang, "What stands out", "Lo que destaca")}
      </h2>
      <p className="text-[12px] text-muted-foreground mb-2">
        {t(
          lang,
          "3 figures calculated from your kitchen reports",
          "3 datos calculados de los reportes de tu cocina"
        )}
      </p>
      {highlights.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="kitchen-highlights-empty"
        >
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {highlights.map((item) => {
            const icon = ICON[item.id];
            return (
              <li
                key={item.id}
                data-testid={`kitchen-highlight-${item.id}`}
                className="flex gap-2.5 pt-2 border-t border-border first:border-t-0 first:pt-0"
              >
                <span
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${icon.bg} ${icon.fg}`}
                >
                  {icon.mark}
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] text-muted-foreground">
                    {item.title}
                  </p>
                  <p className="text-sm font-semibold leading-snug">
                    {item.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[12px] text-muted-foreground text-center mt-3">
        {t(
          lang,
          "Milton explains these figures; he does not invent them.",
          "Milton explica estos datos; no los inventa."
        )}
      </p>
    </section>
  );
}
