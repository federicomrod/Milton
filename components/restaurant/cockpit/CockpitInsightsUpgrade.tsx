// components/restaurant/cockpit/CockpitInsightsUpgrade.tsx
//
// Streams AI wording after first paint. The page renders deterministic
// copy immediately; this server component upgrades when ready.

import { CockpitInsightsCard } from "@/components/restaurant/cockpit/CockpitInsightsCard";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import { wordCockpitInsights } from "@/lib/restaurant/cockpit-insights-ai";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export async function CockpitInsightsUpgrade({
  facts,
  lang,
  cacheKey,
}: {
  facts: CockpitInsightFact[];
  lang: PreferredLanguage;
  cacheKey: string;
}) {
  const worded = await wordCockpitInsights(facts, lang, cacheKey);
  return (
    <CockpitInsightsCard
      lang={lang}
      insights={worded.insights}
      source={worded.source}
    />
  );
}
