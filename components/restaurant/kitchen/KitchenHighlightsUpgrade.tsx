// components/restaurant/kitchen/KitchenHighlightsUpgrade.tsx
//
// Streams AI wording after first paint. Numbers stay grounded.

import { wordCockpitInsights } from "@/lib/restaurant/cockpit-insights-ai";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { KitchenHighlight } from "@/lib/restaurant/kitchen-insights";
import { KitchenHighlights } from "./KitchenHighlights";

export async function KitchenHighlightsUpgrade({
  highlights,
  facts,
  empty,
  lang,
  cacheKey,
}: {
  highlights: KitchenHighlight[];
  facts: CockpitInsightFact[];
  empty: string;
  lang: PreferredLanguage;
  cacheKey: string;
}) {
  if (facts.length === 0) {
    return (
      <KitchenHighlights
        highlights={highlights}
        empty={empty}
        lang={lang}
        source="deterministic"
      />
    );
  }
  const worded = await wordCockpitInsights(facts, lang, cacheKey, {
    blockOnMiss: false,
  });
  const next = highlights.map((item) => {
    const match = worded.insights.find(
      (row) =>
        row.id === `kitchen_${item.id}` ||
        row.id === item.id ||
        (item.id === "most_reported" && row.id === "kitchen_most_reported") ||
        (item.id === "peak_hour" && row.id === "kitchen_peak_hour") ||
        (item.id === "staff_active" && row.id === "kitchen_staff_active")
    );
    if (!match) return item;
    return {
      ...item,
      title: match.title || item.title,
      value: match.body || item.value,
      hint: "",
    };
  });
  return (
    <KitchenHighlights
      highlights={next}
      empty={empty}
      lang={lang}
      source={worded.source}
    />
  );
}
