// lib/restaurant/mobile-manager/ask.ts
//
// Preguntar a Milton on the phone. The answer engine is the web's
// (lib/restaurant/ask-milton-run.ts); this file only adds what a phone needs:
// the clarify rule (decided in code, never by the model), the server-sent-event
// framing, and the shape of what the screen draws.

import type { AskMiltonPayload } from "@/lib/restaurant/ask-milton-run";

export interface AskLocation {
  id: string;
  name: string;
}

export interface ClarifyTurn {
  type: "clarify";
  missing: "location";
  question: string;
  options: { id: string | null; label: string }[];
}

/**
 * Several restaurants and none chosen: ask which one, once. «Todos» is an
 * explicit choice (scope = all), so it never triggers the question.
 */
export function askNeedsLocation(args: {
  locationCount: number;
  locationId: string | null;
  scopeAll: boolean;
}): boolean {
  return args.locationCount > 1 && !args.locationId && !args.scopeAll;
}

export function clarifyTurn(
  locations: AskLocation[],
  text: { question: string; all: string }
): ClarifyTurn {
  return {
    type: "clarify",
    missing: "location",
    question: text.question,
    options: [
      ...locations.map((l) => ({ id: l.id as string | null, label: l.name })),
      { id: null, label: text.all },
    ],
  };
}

/** What the screen shows; web-only fields (links to web pages, web chips) are left out. */
export interface AskFinal {
  type: "final";
  answer: string;
  facts: { label: string; value: string }[];
  followups: string[];
  notes: string[];
  source: "openai" | "deterministic";
  aiUnavailable: boolean;
}

export function shapeFinal(p: AskMiltonPayload): AskFinal {
  return {
    type: "final",
    answer: p.answer,
    facts: p.supporting_facts.map((f) => ({ label: f.label, value: f.value })),
    followups: p.suggested_followups,
    notes: p.confidence_notes,
    source: p.source,
    aiUnavailable: p.ai_unavailable !== null,
  };
}

/** One server-sent event. Data is JSON on a single line. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The grounded answer, cut into word groups for the typing effect. The answer
 * is checked against the deterministic numbers BEFORE it is sent, so no text
 * that grounding would replace is ever shown and then taken back.
 */
export function chunkAnswer(text: string, wordsPerChunk = 4): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let buf = "";
  let n = 0;
  for (const w of words) {
    buf += w;
    if (w.trim()) n++;
    if (n >= wordsPerChunk) {
      out.push(buf);
      buf = "";
      n = 0;
    }
  }
  if (buf) out.push(buf);
  return out;
}
