import { describe, expect, it } from "vitest";
import { DICTIONARIES, de, en, es, fmt, languageOf } from "./strings";

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  return Object.entries(node as object).flatMap(([k, v]) =>
    leaves(v, path ? `${path}.${k}` : k)
  );
}
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

describe("app strings", () => {
  const flat = Object.fromEntries(
    Object.entries(DICTIONARIES).map(([l, d]) => [l, new Map(leaves(d))])
  );

  it("es, en and de have exactly the same keys", () => {
    const keys = [...flat.es.keys()].sort();
    expect([...flat.en.keys()].sort()).toEqual(keys);
    expect([...flat.de.keys()].sort()).toEqual(keys);
  });

  it("no text is empty and every {placeholder} matches Spanish", () => {
    for (const [lang, map] of Object.entries(flat)) {
      for (const [key, value] of map) {
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
        expect(placeholders(value), `${lang}.${key}`).toBe(
          placeholders(flat.es.get(key) as string)
        );
      }
    }
  });

  it("English and German are really translated (not copies of Spanish)", () => {
    const same = [...flat.es].filter(
      ([k, v]) =>
        v.length > 12 && (flat.en.get(k) === v || flat.de.get(k) === v)
    );
    expect(same.map(([k]) => k)).toEqual([]);
  });

  it("no text mentions money or a currency symbol (cooks do not see prices)", () => {
    for (const [lang, map] of Object.entries(flat)) {
      for (const [key, value] of map) {
        expect(value, `${lang}.${key}`).not.toMatch(/[$€£]|\bUSD\b|\bEUR\b/);
      }
    }
  });

  it("the word «platillo» is never used", () => {
    for (const [, v] of flat.es)
      expect(v.toLowerCase()).not.toContain("platillo");
  });

  it("fills placeholders and picks the language", () => {
    expect(fmt(es.hello, { name: "Luis" })).toBe("Hola, Luis");
    expect(fmt(de.send.recording, { time: "0:12" })).toBe("Aufnahme… 0:12");
    expect(fmt(en.hello, {})).toBe("Hi, {name}");
    expect(languageOf("de-DE")).toBe("de");
    expect(languageOf("en-GB")).toBe("en");
    expect(languageOf("es-SV")).toBe("es");
    expect(languageOf("fr")).toBe("es");
    expect(languageOf(null)).toBe("es");
  });
});
