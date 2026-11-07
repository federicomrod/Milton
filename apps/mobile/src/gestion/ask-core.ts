// Pure parts of Preguntar a Milton: the server-sent-event reader, the request
// body and the shape of what the server sends. Tested without a device.

export interface AskOption {
  id: string | null;
  label: string;
}

export type AskEvent =
  | { type: "clarify"; question: string; options: AskOption[] }
  | { type: "delta"; text: string }
  | {
      type: "final";
      answer: string;
      facts: { label: string; value: string }[];
      followups: string[];
      notes: string[];
      source: "openai" | "deterministic";
      aiUnavailable: boolean;
    }
  | { type: "error"; error: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** The server only reads the last 6 turns; the phone sends no more than that. */
export const MAX_TURNS = 6;

export function trimConversation(turns: ChatTurn[]): ChatTurn[] {
  return turns
    .filter((t) => t.content.trim().length > 0)
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
}

/** Turns one server-sent-event block into an AskEvent (null for anything unknown or broken). */
export function parseEventBlock(block: string): AskEvent | null {
  const name = /^event: (.*)$/m.exec(block)?.[1]?.trim();
  const raw = /^data: (.*)$/m.exec(block)?.[1];
  if (!name || raw === undefined) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  switch (name) {
    case "clarify":
      return Array.isArray(d.options) && typeof d.question === "string"
        ? {
            type: "clarify",
            question: d.question,
            options: (d.options as AskOption[]).filter(
              (o) => o && typeof o.label === "string"
            ),
          }
        : null;
    case "delta":
      return typeof d.text === "string"
        ? { type: "delta", text: d.text }
        : null;
    case "final":
      return typeof d.answer === "string"
        ? {
            type: "final",
            answer: d.answer,
            facts: Array.isArray(d.facts)
              ? (d.facts as { label: string; value: string }[])
              : [],
            followups: Array.isArray(d.followups)
              ? (d.followups as string[])
              : [],
            notes: Array.isArray(d.notes) ? (d.notes as string[]) : [],
            source: d.source === "openai" ? "openai" : "deterministic",
            aiUnavailable: d.aiUnavailable === true,
          }
        : null;
    case "error":
      return typeof d.error === "string"
        ? { type: "error", error: d.error }
        : null;
    default:
      return null;
  }
}

/** Feed it text as it arrives (any split); it calls `onEvent` once per complete event. */
export function createSseReader(onEvent: (e: AskEvent) => void) {
  let buffer = "";
  const drain = (flush: boolean) => {
    const blocks = buffer.split("\n\n");
    buffer = flush ? "" : (blocks.pop() ?? "");
    for (const b of blocks) {
      const e = b.trim() ? parseEventBlock(b) : null;
      if (e) onEvent(e);
    }
  };
  return {
    push(text: string) {
      buffer = (buffer + text).replace(/\r\n/g, "\n");
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}
