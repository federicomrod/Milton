import { describe, expect, it } from "vitest";
import { GESTION, gestionDe, gestionEn, gestionEs } from "./strings";

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

describe("Gestión strings", () => {
  const flat = {
    es: new Map(leaves(gestionEs)),
    en: new Map(leaves(gestionEn)),
    de: new Map(leaves(gestionDe)),
  };

  it("es, en and de have exactly the same keys", () => {
    const keys = [...flat.es.keys()].sort();
    expect([...flat.en.keys()].sort()).toEqual(keys);
    expect([...flat.de.keys()].sort()).toEqual(keys);
    expect(Object.keys(GESTION).sort()).toEqual(["de", "en", "es"]);
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

  it("English and German are really translated", () => {
    const same = [...flat.es].filter(
      ([k, v]) =>
        // A string that is only {placeholders} and punctuation is the same everywhere.
        v.replace(/\{\w+\}/g, "").replace(/[\s,.:–-]/g, "").length > 3 &&
        v.length > 14 &&
        (flat.en.get(k) === v || flat.de.get(k) === v)
    );
    expect(same.map(([k]) => k)).toEqual([]);
  });

  it("«plato», never «platillo»; no hard-coded currency symbol (amounts are formatted from the company currency)", () => {
    for (const [, v] of flat.es)
      expect(v.toLowerCase()).not.toContain("platillo");
    for (const [lang, map] of Object.entries(flat)) {
      for (const [key, value] of map) {
        expect(value, `${lang}.${key}`).not.toMatch(/[$€£]/);
      }
    }
  });

  it("a missing price is «Sin precio» and a missing quantity «Falta», in every language", () => {
    expect(gestionEs.costs.noPrice).toBe("Sin precio");
    expect(gestionEs.costs.missing).toBe("Falta");
    expect(gestionEn.costs.noPrice).toBe("No price");
    expect(gestionDe.costs.noPrice).toBe("Kein Preis");
  });

  it("the profile sheet has the rows of the mockup in all three languages", () => {
    for (const g of Object.values(GESTION)) {
      for (const key of [
        "mode",
        "management",
        "kitchen",
        "restaurant",
        "notifications",
        "dailySummary",
        "inviteTeam",
        "signOut",
      ] as const) {
        expect(g.profile[key].length).toBeGreaterThan(2);
      }
    }
  });
});
