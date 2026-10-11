// lib/restaurant/cockpit-insights-ai.ts
//
// Words the already-selected Cockpit insights. OpenAI may only rephrase;
// every number must already be in the facts or we keep the fallback.
// 10s timeout. Cache per company + period for 90s.

import {
  applyAiWordingOrFallback,
  wordedFromFacts,
  type CockpitInsightFact,
  type WordedCockpitInsight,
} from "@/lib/restaurant/cockpit-insights";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export const COCKPIT_INSIGHT_CACHE_TTL_MS = 90_000;
export const COCKPIT_INSIGHT_AI_TIMEOUT_MS = 10_000;

const cache = new Map<
  string,
  { expiresAt: number; value: WordedCockpitInsights }
>();

export interface WordedCockpitInsights {
  insights: WordedCockpitInsight[];
  source: "openai" | "deterministic";
}

export function cockpitInsightCacheKey(parts: {
  companyId: string;
  locationId?: string | null;
  preset: string;
  from: string;
  to: string;
  lang: PreferredLanguage;
}): string {
  return [
    parts.companyId,
    parts.locationId ?? "all",
    parts.preset,
    parts.from,
    parts.to,
    parts.lang,
  ].join(":");
}

export function readInsightCache(key: string): WordedCockpitInsights | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function writeInsightCache(
  key: string,
  value: WordedCockpitInsights,
  now = Date.now(),
  ttlMs = COCKPIT_INSIGHT_CACHE_TTL_MS
): void {
  cache.set(key, { expiresAt: now + ttlMs, value });
}

export function clearInsightCacheForTests(): void {
  cache.clear();
}

export async function wordCockpitInsights(
  facts: CockpitInsightFact[],
  lang: PreferredLanguage,
  cacheKey?: string
): Promise<WordedCockpitInsights> {
  if (cacheKey) {
    const cached = readInsightCache(cacheKey);
    if (cached) return cached;
  }

  const fallback: WordedCockpitInsights = {
    insights: wordedFromFacts(facts),
    source: "deterministic",
  };
  if (facts.length === 0) {
    if (cacheKey) writeInsightCache(cacheKey, fallback);
    return fallback;
  }

  const ai = await callInsightOpenAI(facts, lang);
  const applied = applyAiWordingOrFallback(facts, ai);
  const result: WordedCockpitInsights = {
    insights: applied.insights,
    source: applied.usedFallback || !ai ? "deterministic" : "openai",
  };
  if (cacheKey) writeInsightCache(cacheKey, result);
  return result;
}

async function callInsightOpenAI(
  facts: CockpitInsightFact[],
  lang: PreferredLanguage
): Promise<Array<{ id?: unknown; title?: unknown; body?: unknown }> | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[cockpit-insights-ai] openai sdk import failed:", err);
    return null;
  }
  if (!OpenAIctor) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: COCKPIT_INSIGHT_AI_TIMEOUT_MS,
  });

  const payload = facts.map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    facts: fact.facts,
  }));

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You word restaurant-operator insights. Rules:",
            "1. Use ONLY the numbers and names in each insight's facts.",
            "2. Do not invent, round into a new figure, or add extra numbers.",
            "3. Copy numeric values exactly as given (you may add $ or %).",
            "4. Write in the requested language. Neutral Latin American Spanish with tú when es.",
            "5. Each insight: one title (max 12 words) and one body (max 2 sentences).",
            '6. JSON only: {"insights":[{"id","title","body"}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ language: lang, insights: payload }),
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { insights?: unknown };
    return Array.isArray(parsed.insights) ? parsed.insights : null;
  } catch (err) {
    console.error(
      "[cockpit-insights-ai] openai call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
