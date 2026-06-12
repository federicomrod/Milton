// app/api/restaurant/ask-milton/route.ts
//
// POST /api/restaurant/ask-milton
//
// Stage 1 — read-only chat grounded in structured restaurant context.
//
// Behavior:
//   1. Authenticate + resolve company (RLS still applies).
//   2. Parse message + recent conversation (capped to 6 turns).
//   3. Detect intent and resolve follow-up references (e.g. "these ingredients")
//      deterministically in code — no AI needed for that.
//   4. Build AskMiltonContext (broad, rounded, capped snapshot).
//   5. If OPENAI_API_KEY is set, call OpenAI server-side. Validate response
//      against schema; fall back on any failure.
//   6. If OpenAI unavailable or fails, return a deterministic answer routed
//      by the detected intent.
//
// Safety guarantees:
//   * OpenAI key read from server env only, never returned in responses.
//   * Model receives only the rounded context — no raw DB rows.
//   * Response is schema-validated and link-sanitized before returning.
//   * No DB writes, no agent runs, no chat memory stored.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  buildAskMiltonContext,
  type AskMiltonContext,
} from "@/lib/restaurant/ask-milton-context";
import {
  ASK_MILTON_SYSTEM_PROMPT,
  buildAskMiltonUserPrompt,
  buildDeterministicAnswer,
  detectIntent,
  isAskMiltonAnswer,
  resolveFollowupReferences,
  sanitizeRelatedLinks,
  type AskMiltonAnswer,
  type AskMiltonChatTurn,
  type AskMiltonIntent,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import { generateSuggestedActions } from "@/lib/restaurant/ask-milton-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MESSAGE_CHARS = 2_000;
const MAX_CONVERSATION_TURNS = 6;

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

interface AskMiltonRequestBody {
  message: string;
  conversation?: AskMiltonChatTurn[];
}

function parseConversation(raw: unknown): AskMiltonChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: AskMiltonChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const role = r.role === "user" || r.role === "assistant" ? r.role : null;
    const content = typeof r.content === "string" ? r.content : null;
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  return out.slice(-MAX_CONVERSATION_TURNS);
}

// ---------------------------------------------------------------------------
// OpenAI caller — isolated so any failure cleanly falls back.
// ---------------------------------------------------------------------------

async function callOpenAI(
  ctx: AskMiltonContext,
  message: string,
  conversation: AskMiltonChatTurn[],
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): Promise<AskMiltonAnswer | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[ask-milton] openai sdk import failed:", err);
    return null;
  }
  if (!OpenAIctor) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: ASK_MILTON_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildAskMiltonUserPrompt(
            ctx,
            message,
            conversation,
            intent,
            resolved
          ),
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      console.error("[ask-milton] openai returned empty content");
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("[ask-milton] openai response was not valid JSON:", err);
      return null;
    }
    if (!isAskMiltonAnswer(parsed)) {
      console.error("[ask-milton] openai response failed schema validation");
      return null;
    }
    return {
      answer: parsed.answer,
      supporting_facts: parsed.supporting_facts.slice(0, 6),
      related_links: sanitizeRelatedLinks(parsed.related_links),
      suggested_followups: parsed.suggested_followups.slice(0, 4),
      confidence_notes: parsed.confidence_notes.slice(0, 3),
    };
  } catch (err) {
    console.error(
      "[ask-milton] openai call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  let body: AskMiltonRequestBody;
  try {
    body = (await req.json()) as AskMiltonRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "`message` is required" },
      { status: 400 }
    );
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` },
      { status: 400 }
    );
  }

  const conversation = parseConversation(body.conversation);

  // Detect intent and resolve any follow-up references before building
  // context — intent detection is pure string matching (no I/O), so it
  // runs instantly and lets us build context before resolving entities
  // (which need the ingredient names from context).
  const intent = detectIntent(message);

  let ctx: AskMiltonContext;
  try {
    ctx = await buildAskMiltonContext(supabase, companyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ask-milton] context build failed:", msg);
    return NextResponse.json(
      { error: "Could not build context", details: msg },
      { status: 500 }
    );
  }

  // Resolve follow-up references now that we have the context.
  const resolved = resolveFollowupReferences(message, conversation, ctx);

  const aiAnswer = await callOpenAI(
    ctx,
    message,
    conversation,
    intent,
    resolved
  );
  const answer =
    aiAnswer ?? buildDeterministicAnswer(ctx, message, intent, resolved);
  const source: "openai" | "deterministic" = aiAnswer
    ? "openai"
    : "deterministic";

  const suggested_actions = generateSuggestedActions(message, ctx, intent);

  return NextResponse.json({
    source,
    generated_at: new Date().toISOString(),
    ...answer,
    suggested_actions,
  });
}
