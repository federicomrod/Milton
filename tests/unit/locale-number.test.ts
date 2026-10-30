import { describe, expect, it } from "vitest";
import {
  formatTypedNumber,
  parseLocaleNumber,
  typedNumber,
} from "@/lib/restaurant/locale-number";

const ok = (value: number | null) => ({ ok: true, value });

describe("parseLocaleNumber", () => {
  it("de: «.» thousands, «,» decimal", () => {
    expect(parseLocaleNumber("1.234,50", "de")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("1234,5", "de")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("1.234", "de")).toEqual(ok(1234));
    expect(parseLocaleNumber("0,5", "de")).toEqual(ok(0.5));
    expect(parseLocaleNumber("12", "de")).toEqual(ok(12));
  });

  it("de: the English format is an error, never a different number", () => {
    for (const bad of ["1,234.50", "1234.5", "12.5", "1.2.3", "1,234,567.8"]) {
      expect(parseLocaleNumber(bad, "de")).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("es and en: «,» thousands, «.» decimal", () => {
    for (const lang of ["es", "en"] as const) {
      expect(parseLocaleNumber("1,234.50", lang)).toEqual(ok(1234.5));
      expect(parseLocaleNumber("1234.5", lang)).toEqual(ok(1234.5));
      expect(parseLocaleNumber("1,234", lang)).toEqual(ok(1234));
      expect(parseLocaleNumber("0.5", lang)).toEqual(ok(0.5));
    }
  });

  it("es and en: the German format is an error (1234,5 never becomes 12345)", () => {
    for (const lang of ["es", "en"] as const) {
      for (const bad of ["1234,5", "1.234,50", "12,5", "1,23,4"]) {
        expect(parseLocaleNumber(bad, lang)).toEqual({
          ok: false,
          reason: "invalid",
        });
      }
    }
  });

  it("empty is no value; junk and negatives are errors", () => {
    for (const lang of ["es", "en", "de"] as const) {
      expect(parseLocaleNumber("", lang)).toEqual(ok(null));
      expect(parseLocaleNumber("   ", lang)).toEqual(ok(null));
      expect(parseLocaleNumber("abc", lang).ok).toBe(false);
      expect(parseLocaleNumber("1e5", lang).ok).toBe(false);
      expect(parseLocaleNumber(",", lang).ok).toBe(false);
      expect(parseLocaleNumber("-5", lang)).toEqual({
        ok: false,
        reason: "negative",
      });
    }
  });

  it("ignores spaces, a currency sign and a trailing %", () => {
    expect(parseLocaleNumber("$ 1,234.50", "en")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("€ 1.234,50", "de")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("12,5 %", "de")).toEqual(ok(12.5));
    expect(parseLocaleNumber("12.5%", "es")).toEqual(ok(12.5));
    expect(parseLocaleNumber("1.234,50 €", "de")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("1.234,50\u00a0€", "de")).toEqual(ok(1234.5));
    expect(parseLocaleNumber("CHF 12,50", "de")).toEqual(ok(12.5));
    expect(parseLocaleNumber("$", "en").ok).toBe(false);
  });
});

describe("typedNumber / formatTypedNumber", () => {
  it("typedNumber is the value, or null when empty or invalid", () => {
    expect(typedNumber("1234,5", "de")).toBe(1234.5);
    expect(typedNumber("1234,5", "en")).toBeNull();
    expect(typedNumber("", "de")).toBeNull();
  });

  it("formats editable text that parses back to the same number", () => {
    for (const lang of ["es", "en", "de"] as const) {
      for (const n of [0, 5, 1234.5, 0.25, 12000, 0.0000001]) {
        const text = formatTypedNumber(n, lang);
        expect(typedNumber(text, lang)).toBeCloseTo(n, 6);
      }
    }
    expect(formatTypedNumber(1234.5, "de")).toBe("1234,5");
    expect(formatTypedNumber(1234.5, "en")).toBe("1234.5");
  });
});
