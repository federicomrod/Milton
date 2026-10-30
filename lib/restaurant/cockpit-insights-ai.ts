// lib/restaurant/cockpit-insights-ai.ts
//
// Words the already-selected Cockpit insights. OpenAI may only rephrase;
// every number must already be in the facts or we keep the fallback.
// 10s timeout. Cache per company + resolved location + period + facts.
// LRU-bounded so a Sync (new facts hash / data version) refreshes.

import { createHash } from "crypto";
import { logAiFallback, runChat } from "@/lib/ai/call";
import {
  applyAiWordingOrFallback,
  wordedFromFacts,
  type CockpitInsightFact,
  type WordedCockpitInsight,
} from "@/lib/restaurant/cockpit-insights";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";

export const COCKPIT_INSIGHT_CACHE_TTL_MS = 90_000;
export const COCKPIT_INSIGHT_AI_TIMEOUT_MS = 10_000;
export const COCKPIT_INSIGHT_CACHE_MAX_ENTRIES = 200;

const cache = new Map<
  string,
  { expiresAt: number; value: WordedCockpitInsights }
>();

export interface WordedCockpitInsights {
  insights: WordedCockpitInsight[];
  source: "openai" | "deterministic";
}

export function hashCockpitInsightFacts(facts: CockpitInsightFact[]): string {
  const payload = facts
    .map((fact) => {
      const keys = Object.keys(fact.facts).sort();
      const pairs = keys.map((key) => `${key}=${String(fact.facts[key])}`);
      return `${fact.id}:${pairs.join(",")}`;
    })
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

export function cockpitFactsDataVersion(input: {
  latestSaleDate?: string | null;
  rowCount: number;
}): string {
  return `${input.latestSaleDate ?? "none"}:${input.rowCount}`;
}

export function cockpitInsightCacheKey(parts: {
  companyId: string;
  locationId?: string | null;
  preset: string;
  from: string;
  to: string;
  lang: PreferredLanguage;
  factsHash: string;
  dataVersion: string;
}): string {
  return [
    parts.companyId,
    parts.locationId ?? "all",
    parts.preset,
    parts.from,
    parts.to,
    parts.lang,
    parts.factsHash,
    parts.dataVersion,
  ].join(":");
}

export function insightCacheSizeForTests(): number {
  return cache.size;
}

export function readInsightCache(key: string): WordedCockpitInsights | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

export function writeInsightCache(
  key: string,
  value: WordedCockpitInsights,
  now = Date.now(),
  ttlMs = COCKPIT_INSIGHT_CACHE_TTL_MS
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { expiresAt: now + ttlMs, value });
  while (cache.size > COCKPIT_INSIGHT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearInsightCacheForTests(): void {
  cache.clear();
}

export async function wordCockpitInsights(
  facts: CockpitInsightFact[],
  lang: PreferredLanguage,
  cacheKey?: string,
  options: { blockOnMiss?: boolean } = {}
): Promise<WordedCockpitInsights> {
  const started = Date.now();
  if (cacheKey) {
    const cached = readInsightCache(cacheKey);
    if (cached) {
      logCockpitTiming("insights", {
        ms: Date.now() - started,
        source: cached.source,
        cache: "hit",
      });
      return cached;
    }
  }

  const fallback: WordedCockpitInsights = {
    insights: wordedFromFacts(facts),
    source: "deterministic",
  };
  if (facts.length === 0) {
    if (cacheKey) writeInsightCache(cacheKey, fallback);
    logCockpitTiming("insights", {
      ms: Date.now() - started,
      source: "deterministic",
      cache: "empty",
    });
    return fallback;
  }

  const blockOnMiss = options.blockOnMiss !== false;
  if (!blockOnMiss) {
    void wordAndCacheInsights(facts, lang, cacheKey);
    logCockpitTiming("insights", {
      ms: Date.now() - started,
      source: "deterministic",
      cache: "miss",
      desc: "nonblocking",
    });
    return fallback;
  }

  const result = await wordAndCacheInsights(facts, lang, cacheKey);
  logCockpitTiming("insights", {
    ms: Date.now() - started,
    source: result.source,
    cache: "miss",
  });
  return result;
}

async function wordAndCacheInsights(
  facts: CockpitInsightFact[],
  lang: PreferredLanguage,
  cacheKey?: string
): Promise<WordedCockpitInsights> {
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
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const payload = facts.map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    facts: fact.facts,
  }));

  const result = await runChat({
    feature: "cockpit-insights",
    timeoutMs: COCKPIT_INSIGHT_AI_TIMEOUT_MS,
    params: {
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
            "4. Write in the requested language. Neutral Latin American Spanish with tú when es; formal German with Sie when de (no jargon, hedge estimates).",
            "5. Each insight: one title (max 12 words) and one body (max 2 sentences).",
            "6. Do not include URLs. Do not contradict the sign of delta_pct / vs_average_pct.",
            '7. JSON only: {"insights":[{"id","title","body"}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ language: lang, insights: payload }),
        },
      ],
    },
  });
  if (!result.ok) {
    if (result.kind !== "not_configured") {
      console.error("[cockpit-insights-ai] openai call failed:", result.kind);
    }
    return null;
  }
  try {
    const raw = result.value.choices?.[0]?.message?.content ?? "";
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { insights?: unknown };
    return Array.isArray(parsed.insights) ? parsed.insights : null;
  } catch {
    logAiFallback({ feature: "cockpit-insights", model, kind: "bad_output" });
    return null;
  }
}
