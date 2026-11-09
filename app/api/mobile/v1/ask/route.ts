// app/api/mobile/v1/ask/route.ts
//
// POST ?location=: Preguntar a Milton for owner / admin / manager. Same engine
// as the web (runAskMilton). Answers as server-sent events:
//   clarify  {question, options}  several restaurants and none chosen
//   delta    {text}               the grounded answer, in small pieces
//   final    {answer, facts, followups, notes, source}
//   error    {error}
// Body: {message, conversation?, scope?: "all"}. Nothing is stored.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import {
  askNeedsLocation,
  chunkAnswer,
  clarifyTurn,
  shapeFinal,
  sseEvent,
} from "@/lib/restaurant/mobile-manager/ask";
import {
  ASK_MAX_MESSAGE_CHARS,
  parseConversation,
  runAskMilton,
} from "@/lib/restaurant/ask-milton-run";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
};

export async function POST(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return mobileJson({ error: d.managerAskEmpty }, 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return mobileJson({ error: d.managerAskEmpty }, 400);
  if (message.length > ASK_MAX_MESSAGE_CHARS) {
    return mobileJson({ error: d.managerAskTooLong }, 400);
  }
  const conversation = parseConversation(body.conversation);
  const scopeAll = body.scope === "all";

  if (
    askNeedsLocation({
      locationCount: auth.locations.length,
      locationId: auth.locationId,
      scopeAll,
    })
  ) {
    const turn = clarifyTurn(
      auth.locations.map((l) => ({ id: l.id, name: l.name })),
      { question: d.managerAskClarifyLocation, all: d.managerAskAllRestaurants }
    );
    return new Response(sseEvent("clarify", turn), {
      headers: STREAM_HEADERS,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      try {
        const payload = await runAskMilton({
          supabase: auth.supabase,
          companyId: auth.companyId,
          message,
          conversation,
          selected: auth.selected,
        });
        for (const text of chunkAnswer(payload.answer)) send("delta", { text });
        send("final", shapeFinal(payload));
      } catch (err) {
        console.error(
          "[mobile-ask] failed:",
          err instanceof Error ? err.name : "Unknown error"
        );
        send("error", { error: d.managerAskFailed });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}
