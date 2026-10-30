import { describe, expect, it } from "vitest";
import type { AppResult } from "../api/types";
import { de, en, es } from "../i18n/strings";
import { dayGroup, formatClock, initialsOf } from "./format";
import { awaitsResult, describeResult, offlineText } from "./result";

const done = (over: Partial<AppResult> = {}): AppResult => ({
  state: "done",
  noted: false,
  draft: false,
  asks: null,
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

  it("a question is amarillo; an amount question uses the app's own words", () => {
    const unit = describeResult(
      done({ asks: { kind: "unit", text: "¿Por kilo o por libra?" } }),
      es
    );
    expect(unit.chips).toEqual([
      { tone: "amarillo", label: "Milton te pregunta" },
    ]);
    expect(unit.question).toBe("¿Por kilo o por libra?");
    const amount = describeResult(
      done({ asks: { kind: "amount", text: null } }),
      es
    );
    expect(amount.question).toBe(es.status.amountAsk);
  });

  it("unclear and recipe are grey, in the device language", () => {
    expect(describeResult(done({ unclear: "No entendí." }), es).unclear).toBe(
      "No entendí."
    );
    expect(labels(done({ unclear: "x" }), de)).toEqual([
      `grey:${de.status.couldNotRead}`,
    ]);
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
          asks: { kind: "amount", text: "¿1.50 o 150?" },
        }),
        s
      );
      const text = JSON.stringify(v);
      expect(text).not.toMatch(/[$€£]/);
      expect(v.question).toBe(s.status.amountAsk);
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
    expect(
      awaitsResult(
        {
          kind: "voice",
          result: { ...done(), state: "processing" },
          createdAt: old,
        },
        now
      )
    ).toBe(true);
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
