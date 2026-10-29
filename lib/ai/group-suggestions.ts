// R1-15g (F4): asks the existing OpenAI setup (gpt-4o-mini, OPENAI_API_KEY)
// for group suggestions. Names and categories only; the reply is validated
// against what was sent (lib/restaurant/groups/ai-clusters.ts).

import { openai } from "@/lib/openai-client";
import { runChat, unwrapAi } from "./call";
import {
  MAX_AI_ITEMS,
  aiPrompt,
  validateAiClusters,
} from "@/lib/restaurant/groups/ai-clusters";
import type {
  Cluster,
  ClusterItem,
} from "@/lib/restaurant/groups/cluster-suggest";

export type AiSuggestResult =
  | { ok: true; clusters: Cluster[] }
  | { ok: false; unavailable: true };

export async function suggestGroupsWithAi(input: {
  scope: "product" | "preparation" | "ingredient";
  items: readonly ClusterItem[];
  takenNames?: readonly string[];
}): Promise<AiSuggestResult> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, unavailable: true };
  const items = input.items.slice(0, MAX_AI_ITEMS);
  if (items.length < 4) return { ok: true, clusters: [] };
  const { system, user } = aiPrompt(input.scope, items);
  const completion = unwrapAi(
    await runChat({
      feature: "group-suggestions",
      client: openai,
      params: {
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
    })
  );
  const raw = completion?.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(
      raw
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim()
    );
  } catch {
    parsed = {};
  }
  return {
    ok: true,
    clusters: validateAiClusters(
      parsed,
      items,
      new Set(input.takenNames ?? [])
    ),
  };
}
