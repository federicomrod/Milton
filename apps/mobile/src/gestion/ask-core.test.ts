import { describe, expect, it } from "vitest";
import {
  createSseReader,
  parseEventBlock,
  trimConversation,
  type AskEvent,
} from "./ask-core";

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function read(chunks: string[]): AskEvent[] {
  const out: AskEvent[] = [];
  const r = createSseReader((e) => out.push(e));
  for (const c of chunks) r.push(c);
  r.end();
  return out;
}

describe("server-sent events", () => {
  const stream =
    frame("delta", { text: "Vendiste " }) +
    frame("delta", { text: "más." }) +
    frame("final", {
      answer: "Vendiste más.",
      facts: [{ label: "Viernes", value: "$1,200" }],
      followups: ["¿Y el sábado?"],
      notes: [],
      source: "deterministic",
      aiUnavailable: false,
    });

  it("reads whole events", () => {
    expect(read([stream]).map((e) => e.type)).toEqual([
      "delta",
      "delta",
      "final",
    ]);
  });
  it("reads events split anywhere, even in the middle of a word", () => {
    for (const cut of [1, 7, 20, 41, stream.length - 3]) {
      const got = read([stream.slice(0, cut), stream.slice(cut)]);
      expect(got.map((e) => e.type)).toEqual(["delta", "delta", "final"]);
    }
  });
  it("reads one character at a time and Windows line ends", () => {
    const got = read([...stream.replace(/\n/g, "\r\n")]);
    expect(got).toHaveLength(3);
  });
  it("shows the clarify question with its options", () => {
    const [e] = read([
      frame("clarify", {
        type: "clarify",
        question: "¿Cuál?",
        options: [
          { id: "l1", label: "Centro" },
          { id: null, label: "Todos" },
        ],
      }),
    ]);
    expect(e).toMatchObject({ type: "clarify", question: "¿Cuál?" });
    expect((e as { options: unknown[] }).options).toHaveLength(2);
  });
  it("ignores broken or unknown events instead of crashing", () => {
    expect(parseEventBlock("event: delta\ndata: {nope")).toBeNull();
    expect(parseEventBlock("event: weird\ndata: {}")).toBeNull();
    expect(parseEventBlock("data: {}")).toBeNull();
    expect(parseEventBlock("event: delta\ndata: 5")).toBeNull();
    expect(read(["garbage\n\n", frame("error", { error: "x" })])).toEqual([
      { type: "error", error: "x" },
    ]);
  });
});

describe("conversation sent to the server", () => {
  it("keeps the last 6 non-empty turns, trimmed", () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: i === 3 ? "  " : `t${i}`,
    }));
    const out = trimConversation(turns);
    expect(out).toHaveLength(6);
    expect(out.every((t) => t.content.trim())).toBe(true);
    expect(out.at(-1)!.content).toBe("t8");
  });
});
