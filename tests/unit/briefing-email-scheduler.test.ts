import { describe, it, expect } from "vitest";
import {
  getLocalMoment,
  evaluateDue,
  isAuthorizedCronRequest,
  SEND_HOUR_LOCAL,
  type CompanyScheduleInput,
} from "@/lib/restaurant/email/scheduler";

// Automatic Email Briefing Scheduler v1 — pure due-decision logic. The
// cron route itself does I/O (Supabase + Resend) and isn't executed
// directly in this suite (no Supabase/Resend mocking infrastructure
// exists in this codebase — see tests/unit/email-send-test-isolation.test.ts
// for the same convention applied via content regression instead); these
// are the extracted pure rules the route relies on, tested directly here.

const MEXICO_CITY = "America/Mexico_City"; // UTC-6, no DST since 2022
const ZURICH = "Europe/Zurich"; // UTC+1 (CET) / UTC+2 (CEST, DST)

function baseCompany(
  overrides: Partial<CompanyScheduleInput> = {}
): CompanyScheduleInput {
  return {
    cadence: "daily",
    recipient: "owner@restaurant.com",
    timezone: MEXICO_CITY,
    weekday: 1,
    lastSentAt: null,
    ...overrides,
  };
}

describe("getLocalMoment — IANA-aware local time", () => {
  it("resolves the local hour/date/weekday for a real zone", () => {
    // 2026-01-15T13:00:00Z in America/Mexico_City (UTC-6) is 07:00 local,
    // a Thursday.
    const local = getLocalMoment(new Date("2026-01-15T13:00:00Z"), MEXICO_CITY);
    expect(local.hour).toBe(7);
    expect(local.dateKey).toBe("2026-01-15");
    expect(local.weekday).toBe(4); // Thursday
  });

  it("handles different IANA timezones independently for the same instant", () => {
    // Same UTC instant, two different zones: Mexico City is at its 07:00
    // send hour; Zurich (UTC+1 in January) is not.
    const instant = new Date("2026-01-15T13:00:00Z");
    expect(getLocalMoment(instant, MEXICO_CITY).hour).toBe(7);
    expect(getLocalMoment(instant, ZURICH).hour).not.toBe(7);
  });

  it("DST: the same LOCAL 07:00 in Zurich corresponds to different UTC instants in winter vs. summer", () => {
    // Winter (CET, UTC+1): 07:00 local = 06:00 UTC.
    const winter = getLocalMoment(new Date("2026-01-15T06:00:00Z"), ZURICH);
    // Summer (CEST, UTC+2, DST in effect): 07:00 local = 05:00 UTC.
    const summer = getLocalMoment(new Date("2026-07-15T05:00:00Z"), ZURICH);
    expect(winter.hour).toBe(7);
    expect(summer.hour).toBe(7);
    // Confirms DST is applied purely via the IANA zone name — no manual
    // offset table was used to pick these instants' hour-of-day result.
  });
});

describe("evaluateDue — Off", () => {
  it("Off is never due, regardless of hour/recipient/timezone", () => {
    const result = evaluateDue(
      baseCompany({
        cadence: "off",
        timezone: MEXICO_CITY,
      }),
      new Date("2026-01-15T13:00:00Z") // Mexico City's exact 07:00 hour
    );
    expect(result).toEqual({ due: false, reason: "off" });
  });
});

describe("evaluateDue — Daily, hour gating", () => {
  it("Daily at 06:xx local -> not due", () => {
    // 06:30 local in Mexico City = 12:30 UTC.
    const result = evaluateDue(
      baseCompany({ cadence: "daily" }),
      new Date("2026-01-15T12:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "wrong_hour" });
  });

  it("Daily at 07:xx local -> due", () => {
    const result = evaluateDue(
      baseCompany({ cadence: "daily" }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: true });
    expect(SEND_HOUR_LOCAL).toBe(7);
  });

  it("Daily at 08:xx local -> not due", () => {
    const result = evaluateDue(
      baseCompany({ cadence: "daily" }),
      new Date("2026-01-15T14:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "wrong_hour" });
  });
});

describe("evaluateDue — Daily, duplicate protection", () => {
  it("already sent today (local) -> not due", () => {
    const result = evaluateDue(
      baseCompany({
        cadence: "daily",
        lastSentAt: "2026-01-15T13:05:00Z", // earlier the same local day
      }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "already_sent" });
  });

  it("last sent yesterday (local) -> due", () => {
    const result = evaluateDue(
      baseCompany({
        cadence: "daily",
        lastSentAt: "2026-01-14T13:05:00Z", // previous local day
      }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: true });
  });
});

describe("evaluateDue — Weekly", () => {
  it("wrong weekday -> not due", () => {
    // 2026-01-15 is a Thursday (weekday 4); configure Monday (1).
    const result = evaluateDue(
      baseCompany({ cadence: "weekly", weekday: 1 }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "wrong_weekday" });
  });

  it("correct weekday -> due", () => {
    const result = evaluateDue(
      baseCompany({ cadence: "weekly", weekday: 4 }), // Thursday
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: true });
  });

  it("already sent on the current scheduled day -> not due", () => {
    const result = evaluateDue(
      baseCompany({
        cadence: "weekly",
        weekday: 4,
        lastSentAt: "2026-01-15T13:05:00Z",
      }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "already_sent" });
  });

  it("sent on last week's scheduled day (different local date) -> due", () => {
    const result = evaluateDue(
      baseCompany({
        cadence: "weekly",
        weekday: 4,
        lastSentAt: "2026-01-08T13:05:00Z", // previous Thursday
      }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: true });
  });
});

describe("evaluateDue — fails closed on invalid/missing timezone", () => {
  it("null timezone -> not due", () => {
    const result = evaluateDue(
      baseCompany({ timezone: null }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "invalid_timezone" });
  });

  it("unrecognized timezone name -> not due", () => {
    const result = evaluateDue(
      baseCompany({ timezone: "Not/A_Zone" }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "invalid_timezone" });
  });

  it("never silently falls back to UTC or server time", () => {
    // If it silently used UTC, 13:30 UTC would NOT be the 07:00 hour, so
    // this would incorrectly read as "wrong_hour" rather than the
    // correct, explicit "invalid_timezone" failure reason.
    const result = evaluateDue(
      baseCompany({ timezone: "" }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "invalid_timezone" });
  });
});

describe("evaluateDue — fails closed on missing recipient", () => {
  it("null recipient -> not due, even at the right hour", () => {
    const result = evaluateDue(
      baseCompany({ recipient: null }),
      new Date("2026-01-15T13:30:00Z")
    );
    expect(result).toEqual({ due: false, reason: "missing_recipient" });
  });
});

describe("isAuthorizedCronRequest — missing/invalid CRON_SECRET rejected", () => {
  const SECRET = "super-secret-cron-value";

  it("accepts the exact expected Bearer header", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorizedCronRequest("Bearer wrong-value", SECRET)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it("rejects when CRON_SECRET itself is unconfigured (fails closed)", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false);
  });

  it("rejects when both are missing", () => {
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false);
  });
});
