// components/restaurant/sales/SalesInterpretationUpgrade.tsx
//
// Streams AI wording after first paint. Same number-validation and
// fallback as cockpit-insights-ai.ts.

import { wordCockpitInsights } from "@/lib/restaurant/cockpit-insights-ai";
import type { CockpitInsightFact } from "@/lib/restaurant/cockpit-insights";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { SalesInterpretation } from "./SalesInterpretation";

export async function SalesInterpretationUpgrade({
  fact,
  lang,
  cacheKey,
}: {
  fact: CockpitInsightFact;
  lang: PreferredLanguage;
  cacheKey: string;
}) {
  const worded = await wordCockpitInsights([fact], lang, cacheKey);
  const line = worded.insights[0];
  return (
    <SalesInterpretation
      lang={lang}
      title={line?.title ?? fact.title}
      body={line?.body ?? fact.body}
      source={worded.source}
    />
  );
}
