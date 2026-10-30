import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  defaultLanguageForCountry,
  normalizePreferredLanguage,
  resolvePreferredLanguage,
  resolveRestaurantCockpitLanguage,
} from "@/lib/restaurant/language";

const sql = readFileSync(
  "supabase/migrations/069_existing_companies_spanish.sql",
  "utf8"
);

describe("migration 069 keeps existing accounts Spanish", () => {
  it("lists exactly the Spanish-default country codes of language.ts", () => {
    const list = /IN \(\s*([^)]*)\)/.exec(sql)?.[1] ?? "";
    const codes = [...list.matchAll(/'([a-z]{2})'/g)].map((m) =>
      m[1].toUpperCase()
    );
    expect(codes.sort()).toEqual(
      ["MX", "SV", "GT", "AR", "CL", "CO", "ES", "PE"].sort()
    );
    for (const code of codes)
      expect(defaultLanguageForCountry(code)).toBe("es");
    for (const code of ["US", "DE", "CH", "GB", "BR", "CA"]) {
      expect(defaultLanguageForCountry(code)).toBe("en");
    }
  });

  it("is a data update only", () => {
    const code = sql.replace(/--.*$/gm, "");
    expect(code).toMatch(/UPDATE public\.companies/);
    expect(code).not.toMatch(
      /\b(ALTER|CREATE|DROP|POLICY|DEFAULT|INSERT|DELETE)\b/
    );
    expect(code).toContain("preferred_language = 'en'");
    expect(code).toContain("created_at <");
  });
});

describe("the cockpit language after the update", () => {
  it("an unset or invalid value resolves to Spanish", () => {
    for (const v of [null, undefined, "", "fr", "EN", 1, {}]) {
      expect(resolveRestaurantCockpitLanguage(v)).toBe("es");
    }
  });

  it("a stored en, es or de is honoured", () => {
    expect(resolveRestaurantCockpitLanguage("en")).toBe("en");
    expect(resolveRestaurantCockpitLanguage("de")).toBe("de");
    expect(resolveRestaurantCockpitLanguage("es")).toBe("es");
  });

  it("emails and Telegram keep their own default (English when unset)", () => {
    expect(resolvePreferredLanguage(null)).toBe("en");
    expect(resolvePreferredLanguage("de")).toBe("de");
  });

  it("onboarding still takes the picked language, German included", () => {
    expect(normalizePreferredLanguage("de")).toBe("de");
    expect(normalizePreferredLanguage("es")).toBe("es");
    expect(normalizePreferredLanguage("fr")).toBeNull();
  });
});
