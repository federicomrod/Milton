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
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { fmt } from "@/lib/i18n";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import {
  ASK_MAX_MESSAGE_CHARS as MAX_MESSAGE_CHARS,
  parseConversation,
  runAskMilton,
} from "@/lib/restaurant/ask-milton-run";
import type { AskMiltonChatTurn } from "@/lib/restaurant/ask-milton-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AskMiltonRequestBody {
  message: string;
  conversation?: AskMiltonChatTurn[];
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
    return NextResponse.json(
      { error: (await apiDictionary()).ask.api.invalidJson },
      { status: 400 }
    );
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: (await apiDictionary()).ask.api.messageRequired },
      { status: 400 }
    );
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      {
        error: fmt((await apiDictionary()).ask.api.messageTooLong, {
          max: MAX_MESSAGE_CHARS,
        }),
      },
      { status: 400 }
    );
  }

  const conversation = parseConversation(body.conversation);

  // Multi-Restaurant UX v1: an optional `?location=` narrows Ask Milton's
  // answer context to one restaurant. Validated against the caller's OWN
  // company before being trusted — an id for another company (or
  // garbage) simply never matches and silently falls back to the
  // consolidated (company-wide) context. Same resolver the dashboard and
  // briefing routes use — no second context system.
  const requestedLocationId = req.nextUrl.searchParams.get("location");
  let selected: { locationId: string; brandId: string | null } | null = null;
  if (requestedLocationId) {
    const context = await resolveRestaurantContext(
      supabase,
      companyId,
      requestedLocationId
    );
    selected = context.selected;
  }

  try {
    const payload = await runAskMilton({
      supabase,
      companyId,
      message,
      conversation,
      selected,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ask-milton] context build failed:", msg);
    return NextResponse.json(
      { error: (await apiDictionary()).ask.api.contextFailed, details: msg },
      { status: 500 }
    );
  }
}
