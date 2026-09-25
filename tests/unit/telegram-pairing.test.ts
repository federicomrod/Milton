import { describe, it, expect } from "vitest";
import {
  isPairingCodeUsable,
  evaluateConnectionConflict,
} from "@/lib/restaurant/telegram/pairing";

// Telegram Daily Briefing v1 — pure decision logic behind the pairing
// flow. consumePairingCode() itself does Supabase I/O and isn't mocked
// (no Supabase mocking infrastructure exists in this codebase — see
// lib/restaurant/odoo/secrets.ts's test file for the same convention);
// these are the extracted pure rules it relies on, directly tested here.

describe("isPairingCodeUsable — expiry (scenario: pairing code expiry)", () => {
  it("is usable before its expiry", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const pending = {
      expires_at: "2026-01-01T12:05:00Z",
      consumed_at: null,
    };
    expect(isPairingCodeUsable(pending, now)).toBe(true);
  });

  it("is not usable exactly at or after its expiry", () => {
    const now = new Date("2026-01-01T12:05:00Z");
    const pending = {
      expires_at: "2026-01-01T12:05:00Z",
      consumed_at: null,
    };
    expect(isPairingCodeUsable(pending, now)).toBe(false);

    const later = new Date("2026-01-01T12:06:00Z");
    expect(isPairingCodeUsable(pending, later)).toBe(false);
  });
});

describe("isPairingCodeUsable — single use (scenario: pairing code single-use)", () => {
  it("is not usable once consumed, even if not yet expired", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const pending = {
      expires_at: "2026-01-01T12:05:00Z",
      consumed_at: "2026-01-01T11:59:00Z",
    };
    expect(isPairingCodeUsable(pending, now)).toBe(false);
  });
});

describe("isPairingCodeUsable — missing code", () => {
  it("is not usable when no matching code row exists", () => {
    expect(isPairingCodeUsable(null)).toBe(false);
  });
});

describe("evaluateConnectionConflict — Adjustment 2, no silent re-pairing", () => {
  it("returns null when neither the company nor the chat is connected", () => {
    expect(evaluateConnectionConflict(null, null)).toBeNull();
  });

  it("flags company_already_connected when the company already has a chat (scenario: company already connected)", () => {
    expect(evaluateConnectionConflict({ id: "company-conn-1" }, null)).toBe(
      "company_already_connected"
    );
  });

  it("flags chat_already_connected when the chat already belongs to a company (scenario: chat already connected)", () => {
    expect(evaluateConnectionConflict(null, { id: "chat-conn-1" })).toBe(
      "chat_already_connected"
    );
  });

  it("prioritizes company_already_connected when both are already taken (matches query order)", () => {
    expect(
      evaluateConnectionConflict(
        { id: "company-conn-1" },
        { id: "chat-conn-1" }
      )
    ).toBe("company_already_connected");
  });
});

describe("evaluateConnectionConflict — cross-company isolation", () => {
  it("a conflict found for one company's row never depends on or leaks another company's data", () => {
    // The pure function only ever sees THIS company's connection row and
    // THIS chat's connection row (each fetched via .eq("company_id", ...)
    // / .eq("chat_id", ...) in pairing.ts) — it has no way to reason about
    // any other company, by construction. Two independent evaluations
    // with different companies' rows never influence each other.
    const companyAResult = evaluateConnectionConflict(
      { id: "company-a-conn" },
      null
    );
    const companyBResult = evaluateConnectionConflict(null, null);
    expect(companyAResult).toBe("company_already_connected");
    expect(companyBResult).toBeNull();
  });
});
