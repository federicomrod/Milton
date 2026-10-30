// POST /api/restaurant/ingredients/duplicates/suggest   { items: [{id,name,unit}] }
//
// R1-15k: the AI step of the duplicate suggestions, for what the name
// heuristics left over. Only ingredient NAMES and UNITS are sent (≤ 250); the
// answer is validated against what was sent (known ids, 2–6, one unit family,
// no rejected pair). The sets are STORED as pending suggestions (source ai) so
// they survive a reload; nothing is merged here.

import { requireCapability } from "@/lib/auth/permissions";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai-client";
import { runChat, unwrapAi } from "@/lib/ai/call";
import {
  aiDuplicatePrompt,
  pairKey,
  validateAiSets,
  type DupItem,
} from "@/lib/restaurant/ingredient-duplicates";
import { gate } from "@/lib/restaurant/ingredient-duplicates-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ITEMS = 250;

export async function POST(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const g = await gate();
  if (!g.ok) return g.response;
  const denied = requireCapability(g.actor, "ingredients.manage", {
    message: api.roleMerge,
  });
  if (denied) return denied;
  const { supabase, companyId } = g.auth;
  let body: { items?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }
  const items: DupItem[] = (Array.isArray(body.items) ? body.items : [])
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.id === "string" && typeof i.name === "string")
    .slice(0, MAX_ITEMS)
    .map((i) => ({
      id: i.id as string,
      name: (i.name as string).slice(0, 200),
      unit: typeof i.unit === "string" ? i.unit.slice(0, 40) : null,
    }));
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ unavailable: true, sets: [] });
  }
  if (items.length < 4) return NextResponse.json({ sets: [] });
  // Only ids that really are this company's.
  const own = await supabase
    .from("ingredients")
    .select("id")
    .eq("company_id", companyId)
    .in(
      "id",
      items.map((i) => i.id)
    );
  const ownIds = new Set(
    ((own.data ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  const sent = items.filter((i) => ownIds.has(i.id));
  const nd = await supabase
    .from("ingredient_not_duplicates")
    .select("ingredient_a, ingredient_b")
    .eq("company_id", companyId)
    .limit(20000);
  const notDup = new Set(
    (
      (nd.data ?? []) as Array<{ ingredient_a: string; ingredient_b: string }>
    ).map((r) => pairKey(r.ingredient_a, r.ingredient_b))
  );
  try {
    const { system, user } = aiDuplicatePrompt(sent);
    const result = await runChat({
      feature: "ingredient-duplicates",
      companyId,
      client: openai,
      params: {
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
    });
    const completion = unwrapAi(result);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(completion?.choices?.[0]?.message?.content ?? "{}");
    } catch {
      parsed = {};
    }
    const sets = validateAiSets(parsed, sent, notDup);
    if (sets.length === 0) return NextResponse.json({ sets: [] });
    // Stored as pending (a set already decided stays decided: the unique key keeps it).
    const rows = sets.map((s) => ({
      company_id: companyId,
      ingredient_ids: s.ids,
      set_key: s.key,
      source: "ai",
      score: s.score,
      status: "pending",
    }));
    const saved = await supabase
      .from("ingredient_duplicate_suggestions")
      .upsert(rows, {
        onConflict: "company_id,set_key",
        ignoreDuplicates: true,
      })
      .select("id, set_key");
    if (saved.error) {
      if (saved.error.code === "42P01") {
        return NextResponse.json(
          {
            unavailable: true,
            error: api.migrationsMissing,
            sets: [],
          },
          { status: 409 }
        );
      }
      console.error("[ingredient duplicates/suggest]", saved.error.message);
    }
    return NextResponse.json({ sets, stored: saved.data ?? [] });
  } catch (err) {
    console.error("[ingredient duplicates/suggest]", err);
    return NextResponse.json(
      {
        error: api.miltonDuplicates,
      },
      { status: 502 }
    );
  }
}
