import { describe, it, expect } from "vitest";
import {
  normalizeCadence,
  normalizeEmail,
  normalizeWeekday,
  normalizeTimezone,
  resolveCadence,
  resolveWeekday,
  resolveTimezone,
  resolveTimezoneForCadence,
  DEFAULT_CADENCE,
  DEFAULT_WEEKDAY,
  DEFAULT_TIMEZONE,
} from "@/lib/restaurant/email/preferences";

// Email Briefing Extension v1 — pure validation for the companies.briefing_email_*
// columns (migration 018). These are the ONLY guard against a malformed
// payload, since the columns carry no CHECK constraint.

describe("normalizeCadence — cadence validation", () => {
  it("accepts off/daily/weekly", () => {
    expect(normalizeCadence("off")).toBe("off");
    expect(normalizeCadence("daily")).toBe("daily");
    expect(normalizeCadence("weekly")).toBe("weekly");
  });

  it("rejects anything else", () => {
    expect(normalizeCadence("monthly")).toBeNull();
    expect(normalizeCadence("")).toBeNull();
    expect(normalizeCadence(null)).toBeNull();
    expect(normalizeCadence(undefined)).toBeNull();
    expect(normalizeCadence(1)).toBeNull();
  });

  it("resolveCadence falls back to the default for invalid input", () => {
    expect(resolveCadence("nonsense")).toBe(DEFAULT_CADENCE);
    expect(resolveCadence(null)).toBe("off");
  });
});

describe("normalizeEmail — email validation", () => {
  it("accepts a well-formed address, trimmed", () => {
    expect(normalizeEmail("  owner@restaurant.com  ")).toBe(
      "owner@restaurant.com"
    );
  });

  it("rejects missing @ or domain", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("missing-domain@")).toBeNull();
    expect(normalizeEmail("@nodomain.com")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(12345)).toBeNull();
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("rejects an address longer than 254 characters", () => {
    const tooLong = `${"a".repeat(250)}@x.com`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(normalizeEmail(tooLong)).toBeNull();
  });
});

describe("normalizeWeekday", () => {
  it("accepts 0 through 6", () => {
    for (let i = 0; i <= 6; i++) {
      expect(normalizeWeekday(i)).toBe(i);
    }
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(normalizeWeekday(7)).toBeNull();
    expect(normalizeWeekday(-1)).toBeNull();
    expect(normalizeWeekday(1.5)).toBeNull();
    expect(normalizeWeekday("1")).toBeNull();
    expect(normalizeWeekday(null)).toBeNull();
  });

  it("resolveWeekday falls back to Monday (1) for invalid input", () => {
    expect(resolveWeekday(null)).toBe(DEFAULT_WEEKDAY);
    expect(resolveWeekday(99)).toBe(1);
  });
});

describe("normalizeTimezone", () => {
  it("accepts a real IANA timezone name", () => {
    expect(normalizeTimezone("America/Mexico_City")).toBe(
      "America/Mexico_City"
    );
    expect(normalizeTimezone("UTC")).toBe("UTC");
  });

  it("rejects an unrecognized timezone name", () => {
    expect(normalizeTimezone("Not/A_Zone")).toBeNull();
  });

  it("rejects non-string or empty input", () => {
    expect(normalizeTimezone(null)).toBeNull();
    expect(normalizeTimezone("")).toBeNull();
    expect(normalizeTimezone("   ")).toBeNull();
  });

  it("resolveTimezone falls back to UTC for invalid input", () => {
    expect(resolveTimezone("nonsense")).toBe(DEFAULT_TIMEZONE);
  });
});

describe("resolveTimezoneForCadence — never an accidentally implicit UTC", () => {
  it("cadence 'off': timezone doesn't matter — always resolves ok, falling back to UTC", () => {
    expect(resolveTimezoneForCadence("off", null)).toEqual({
      ok: true,
      timezone: "UTC",
    });
    expect(resolveTimezoneForCadence("off", "nonsense")).toEqual({
      ok: true,
      timezone: "UTC",
    });
    expect(resolveTimezoneForCadence("off", "America/Mexico_City")).toEqual({
      ok: true,
      timezone: "America/Mexico_City",
    });
  });

  it("cadence 'daily': requires an explicit valid IANA timezone", () => {
    expect(resolveTimezoneForCadence("daily", "America/Mexico_City")).toEqual({
      ok: true,
      timezone: "America/Mexico_City",
    });
  });

  it("cadence 'daily': fails closed (never silently UTC) when timezone is missing", () => {
    expect(resolveTimezoneForCadence("daily", null)).toEqual({ ok: false });
    expect(resolveTimezoneForCadence("daily", undefined)).toEqual({
      ok: false,
    });
    expect(resolveTimezoneForCadence("daily", "")).toEqual({ ok: false });
  });

  it("cadence 'daily': fails closed when timezone is invalid", () => {
    expect(resolveTimezoneForCadence("daily", "Not/A_Zone")).toEqual({
      ok: false,
    });
  });

  it("cadence 'weekly': same explicit-required rule as daily", () => {
    expect(resolveTimezoneForCadence("weekly", null)).toEqual({ ok: false });
    expect(resolveTimezoneForCadence("weekly", "UTC")).toEqual({
      ok: true,
      timezone: "UTC",
    });
  });

  it("cadence 'daily' with an explicit 'UTC' is accepted — the rule is about explicitness, not about banning UTC itself", () => {
    expect(resolveTimezoneForCadence("daily", "UTC")).toEqual({
      ok: true,
      timezone: "UTC",
    });
  });
});
