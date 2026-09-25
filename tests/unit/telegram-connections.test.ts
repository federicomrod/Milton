import { describe, it, expect } from "vitest";
import { isUsableConnection } from "@/lib/restaurant/telegram/connections";

// Telegram Daily Briefing v1 — pure guard behind the manual send route's
// connection check (scenarios: missing connection, cross-company
// isolation).

describe("isUsableConnection — missing connection", () => {
  it("returns false when there is no connection row at all", () => {
    expect(isUsableConnection(null, "company-a")).toBe(false);
    expect(isUsableConnection(undefined, "company-a")).toBe(false);
  });
});

describe("isUsableConnection — cross-company isolation", () => {
  it("returns true for a matching, active connection", () => {
    expect(
      isUsableConnection(
        { company_id: "company-a", chat_id: 111, is_active: true },
        "company-a"
      )
    ).toBe(true);
  });

  it("returns false when the row belongs to a different company — company A can never use company B's connection", () => {
    expect(
      isUsableConnection(
        { company_id: "company-b", chat_id: 111, is_active: true },
        "company-a"
      )
    ).toBe(false);
  });
});

describe("isUsableConnection — inactive connection", () => {
  it("returns false for a deactivated connection even if company_id matches", () => {
    expect(
      isUsableConnection(
        { company_id: "company-a", chat_id: 111, is_active: false },
        "company-a"
      )
    ).toBe(false);
  });
});
