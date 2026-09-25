import { describe, it, expect } from "vitest";
import {
  LANGUAGE_OPTIONS,
  DEFAULT_LANGUAGE,
  defaultLanguageForCountry,
  normalizePreferredLanguage,
  resolvePreferredLanguage,
  nextLanguageOnCountryChange,
  t,
} from "@/lib/restaurant/language";

// Milton Language Foundation v1 — the centralized language helper.

describe("LANGUAGE_OPTIONS / DEFAULT_LANGUAGE", () => {
  it("offers exactly English and Spanish, English first", () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
    ]);
  });

  it("defaults to English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
  });
});

describe("defaultLanguageForCountry (Phase 6, scenarios 5 & 6)", () => {
  it("defaults to Spanish for every required Spanish-default country", () => {
    for (const code of ["MX", "SV", "GT", "AR", "CL", "CO", "ES", "PE"]) {
      expect(defaultLanguageForCountry(code)).toBe("es");
    }
  });

  it("defaults to English for other currently-supported countries", () => {
    for (const code of ["US", "CA", "BR", "GB", "PT", "CH", "DE", "IT"]) {
      expect(defaultLanguageForCountry(code)).toBe("en");
    }
  });

  it("defaults to English for an unknown/unsupported country code", () => {
    expect(defaultLanguageForCountry("ZZ")).toBe("en");
  });

  it("defaults to English when no country is given", () => {
    expect(defaultLanguageForCountry(null)).toBe("en");
    expect(defaultLanguageForCountry(undefined)).toBe("en");
  });
});

describe("nextLanguageOnCountryChange (Phase 6, scenario 7 — user override)", () => {
  it("follows the country's default while untouched", () => {
    expect(nextLanguageOnCountryChange("MX", false, null)).toBe("es");
    expect(nextLanguageOnCountryChange("US", false, "es")).toBe("en");
  });

  it("a user's explicit choice survives a later country change (always overridable)", () => {
    // User picks Mexico (defaults to Spanish), then explicitly overrides to
    // English, then changes the country again to Guatemala (also a
    // Spanish-default country) — their English choice must NOT be reset.
    const afterOverride = "en" as const;
    expect(
      nextLanguageOnCountryChange(
        "GT",
        /* languageTouched */ true,
        afterOverride
      )
    ).toBe("en");
  });

  it("an override to Spanish for a non-Spanish-default country also survives", () => {
    expect(nextLanguageOnCountryChange("CA", true, "es")).toBe("es");
  });

  it("touched but with no current language yet falls back to the country default", () => {
    expect(nextLanguageOnCountryChange("MX", true, null)).toBe("es");
  });
});

describe("normalizePreferredLanguage", () => {
  it("passes through valid values", () => {
    expect(normalizePreferredLanguage("en")).toBe("en");
    expect(normalizePreferredLanguage("es")).toBe("es");
  });

  it("rejects anything else", () => {
    expect(normalizePreferredLanguage("fr")).toBeNull();
    expect(normalizePreferredLanguage(null)).toBeNull();
    expect(normalizePreferredLanguage(undefined)).toBeNull();
    expect(normalizePreferredLanguage(1)).toBeNull();
    expect(normalizePreferredLanguage(["en"])).toBeNull();
  });
});

describe("resolvePreferredLanguage (Phase 6, scenario 8 — existing companies default to English)", () => {
  it("resolves a valid stored value", () => {
    expect(resolvePreferredLanguage("es")).toBe("es");
    expect(resolvePreferredLanguage("en")).toBe("en");
  });

  it("a company with no stored value (predates this feature) resolves to English, never throws", () => {
    expect(resolvePreferredLanguage(null)).toBe("en");
    expect(resolvePreferredLanguage(undefined)).toBe("en");
    expect(resolvePreferredLanguage("garbage")).toBe("en");
  });
});

describe("t (language picker)", () => {
  it("picks English for 'en' and Spanish for 'es'", () => {
    expect(t("en", "Hello", "Hola")).toBe("Hello");
    expect(t("es", "Hello", "Hola")).toBe("Hola");
  });
});
