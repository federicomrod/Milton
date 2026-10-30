import { describe, expect, it } from "vitest";
import type { AppResult } from "../api/types";
import { de, en, es } from "../i18n/strings";
import { dayGroup, formatClock, initialsOf } from "./format";
import {
  STUCK_AFTER_MS,
  awaitsResult,
  describeResult,
  isStuck,
  offlineText,
  unclearText,
} from "./result";

const done = (over: Partial<AppResult> = {}): AppResult => ({
  state: "done",
  noted: false,
  draft: false,
  unclear: null,
  recipe: false,
  understood: [],
  ...over,
});
const labels = (r: AppResult | null, s = es) =>
  describeResult(r, s).chips.map((c) => `${c.tone}:${c.label}`);

describe("describeResult", () => {
  it("nothing yet (or still reading, or failed) is just «Enviado»", () => {
    for (const r of [
      null,
      undefined,
      done({}),
      { ...done(), state: "processing" as const },
      { ...done(), state: "failed" as const },
    ]) {
      expect(labels(r as AppResult | null)).toEqual(["mint:Enviado"]);
    }
  });

  it("a stock alert is «Anotado» (mint) with «Esto entendí» (lavender) for what was understood", () => {
    const v = describeResult(
      done({ noted: true, understood: ["queso fresco"] }),
      es
    );
    expect(v.chips).toEqual([
      { tone: "mint", label: "Anotado" },
      { tone: "lavender", label: "Esto entendí" },
    ]);
    expect(v.understood).toBe("queso fresco");
    expect(v.priceNote).toBeNull();
  });

  it("a price waits for approval (grey) and says the manager sees prices", () => {
    const v = describeResult(done({ draft: true, understood: ["pan"] }), es);
    expect(v.chips.map((c) => c.label)).toEqual([
      "Espera aprobación",
      "Esto entendí",
    ]);
    expect(v.chips[0].tone).toBe("grey");
    expect(v.priceNote).toBe("Los precios los ve tu encargado.");
    expect(v.understood).toBe("pan");
  });

  it("«could not read it» is the app's own words for a reason code, in every language", () => {
    const codes = [
      "unreadable",
      "ai_unavailable",
      "price_unclear",
      "currency_mismatch",
      "save_failed",
      "other",
    ] as const;
    for (const s of [es, en, de]) {
      const seen = new Set<string>();
      for (const code of codes) {
        const v = describeResult(done({ unclear: code }), s);
        expect(v.unclear).toBe(unclearText(code, s));
        expect(v.unclear).not.toMatch(/[\d$€£]/);
        expect(v.chips.map((c) => c.tone)).toEqual(["grey"]);
        seen.add(v.unclear as string);
      }
      expect(seen.size).toBe(codes.length); // one distinct sentence per code
    }
    // Anything the server might send that is not a known code reads as «other».
    expect(unclearText("No entendí. «aguacate $1.50»", es)).toBe(
      es.status.unclear.other
    );
    expect(describeResult(done({ unclear: "price_unclear" }), de).unclear).toBe(
      de.status.unclear.priceUnclear
    );
  });

  it("a recipe is grey", () => {
    expect(labels(done({ recipe: true }), en)).toEqual([
      `grey:${en.status.recipeSeen}`,
    ]);
  });

  it("never renders an amount or a currency symbol, whatever the server sends", () => {
    for (const s of [es, en, de]) {
      const v = describeResult(
        done({
          draft: true,
          noted: true,
          understood: ["pan"],
        }),
        s
      );
      const text = JSON.stringify(v);
      expect(text).not.toMatch(/[$€£]/);
    }
  });
});

describe("helpers", () => {
  it("offline text counts what is saved on the phone", () => {
    expect(offlineText(0, es)).toBe("Sin conexión");
    expect(offlineText(1, es)).toContain("1 envío guardado");
    expect(offlineText(3, es)).toContain("3 envíos guardados");
    expect(offlineText(2, en)).toContain("2 items saved");
  });

  it("keeps checking only for a text or voice note that Milton has not read yet", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const fresh = "2026-10-30T11:59:30Z";
    const old = "2026-10-30T11:50:00Z";
    expect(
      awaitsResult({ kind: "text", result: null, createdAt: fresh }, now)
    ).toBe(true);
    expect(
      awaitsResult({ kind: "text", result: null, createdAt: old }, now)
    ).toBe(false);
    // Still «processing» but young: keep checking. Two minutes on: stop.
    const processing = { ...done(), state: "processing" as const };
    expect(
      awaitsResult(
        {
          kind: "voice",
          result: processing,
          createdAt: "2026-10-30T11:59:00Z",
        },
        now
      )
    ).toBe(true);
    expect(
      awaitsResult({ kind: "voice", result: processing, createdAt: old }, now)
    ).toBe(false);
    expect(
      awaitsResult({ kind: "voice", result: done(), createdAt: fresh }, now)
    ).toBe(false);
    expect(
      awaitsResult({ kind: "photo", result: null, createdAt: fresh }, now)
    ).toBe(false);
  });

  it("groups by day, formats the clock and makes initials", () => {
    const now = new Date(2026, 9, 30, 15, 0);
    expect(dayGroup(new Date(2026, 9, 30, 9, 0).toISOString(), now)).toBe(
      "today"
    );
    expect(dayGroup(new Date(2026, 9, 29, 23, 0).toISOString(), now)).toBe(
      "yesterday"
    );
    expect(dayGroup(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toBe(
      "earlier"
    );
    expect(formatClock(new Date(2026, 9, 30, 9, 5).toISOString())).toBe(
      "09:05"
    );
    expect(initialsOf("Carlos Mejía")).toBe("CM");
    expect(initialsOf("luis")).toBe("L");
    expect(initialsOf("Ana María de la Cruz")).toBe("AC");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("a card stuck on «processing»", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const processing = { ...done(), state: "processing" as const };
  const at = (secondsAgo: number) =>
    new Date(now - secondsAgo * 1000).toISOString();

  it("is polled for two minutes, then it is stuck and polling stops", () => {
    expect(STUCK_AFTER_MS).toBe(120_000);
    const young = {
      kind: "text" as const,
      result: processing,
      createdAt: at(60),
    };
    const old = {
      kind: "text" as const,
      result: processing,
      createdAt: at(130),
    };
    expect(awaitsResult(young, now)).toBe(true);
    expect(isStuck(young, now)).toBe(false);
    expect(awaitsResult(old, now)).toBe(false);
    expect(isStuck(old, now)).toBe(true);
  });

  it("«Reintentar» restarts the two minutes from that moment", () => {
    const old = {
      kind: "voice" as const,
      result: processing,
      createdAt: at(600),
    };
    const retriedAt = now - 10_000;
    expect(awaitsResult(old, now, retriedAt)).toBe(true);
    expect(isStuck(old, now, retriedAt)).toBe(false);
    expect(isStuck(old, now + STUCK_AFTER_MS, retriedAt)).toBe(true);
  });

  it("a finished or failed card, a photo and an old row without a result are never stuck", () => {
    const old = at(600);
    expect(isStuck({ kind: "text", result: done(), createdAt: old }, now)).toBe(
      false
    );
    expect(
      isStuck(
        {
          kind: "text",
          result: { ...done(), state: "failed" },
          createdAt: old,
        },
        now
      )
    ).toBe(false);
    expect(isStuck({ kind: "photo", result: null, createdAt: old }, now)).toBe(
      false
    );
    expect(
      isStuck(
        {
          kind: "text",
          result: null,
          createdAt: at(3 * 86400),
          status: "processed",
        },
        now
      )
    ).toBe(false);
    // No result yet, never processed, a few minutes old: stuck.
    expect(
      isStuck(
        { kind: "text", result: null, createdAt: old, status: "received" },
        now
      )
    ).toBe(true);
  });
});

describe("the card lists every product and never asks", () => {
  it("«pan, tomates» with «Espera aprobación» and «Esto entendí», in each language", () => {
    for (const dict of [es, en, de]) {
      const view = describeResult(
        done({ draft: true, understood: ["pan", "tomates"] }),
        dict
      );
      expect(view.understood).toBe("pan, tomates");
      expect(view.chips.map((c) => c.label)).toEqual([
        dict.status.awaiting,
        dict.status.understood,
      ]);
      expect(JSON.stringify(view)).not.toMatch(/[\d$€]/);
      expect(view).not.toHaveProperty("question");
      expect(view).not.toHaveProperty("extras");
    }
  });

  it("the dictionaries have no question strings left", () => {
    for (const dict of [es, en, de]) {
      for (const key of [
        "asks",
        "unitAsk",
        "amountAsk",
        "answerHint",
        "extrasAsk",
      ]) {
        expect(dict.status).not.toHaveProperty(key);
      }
    }
  });
});
