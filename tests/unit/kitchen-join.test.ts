import { describe, it, expect } from "vitest";
import {
  RATE_LIMIT_PER_HOUR,
  buildDisplayName,
  canManageKitchenQr,
  decideJoin,
  generateKitchenToken,
  hashKitchenToken,
  isKitchenPayload,
  secretFromPayload,
} from "@/lib/restaurant/telegram/kitchen-join";

describe("kitchen token", () => {
  it("payload is kq1_ + 32 base64url chars (36 total)", () => {
    const { secret, payload } = generateKitchenToken();
    expect(secret).toHaveLength(32);
    expect(payload).toHaveLength(36);
    expect(payload).toMatch(/^kq1_[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(24);
    expect(isKitchenPayload(payload)).toBe(true);
    expect(secretFromPayload(payload)).toBe(secret);
  });

  it("is random per call", () => {
    expect(generateKitchenToken().payload).not.toBe(
      generateKitchenToken().payload
    );
  });

  it("isKitchenPayload rejects pairing codes and malformed payloads", () => {
    expect(isKitchenPayload("AbCdEfGhIjKl")).toBe(false); // 12-char pairing code
    expect(isKitchenPayload("kq1_short")).toBe(false);
    expect(isKitchenPayload(`kq1_${"a".repeat(33)}`)).toBe(false);
    expect(isKitchenPayload(`kq2_${"a".repeat(32)}`)).toBe(false);
    expect(isKitchenPayload(`kq1_${"a".repeat(31)}!`)).toBe(false);
    expect(isKitchenPayload(` kq1_${"a".repeat(32)}`)).toBe(false);
  });

  it("hash is deterministic, hex, and differs from the token", () => {
    const { secret, payload } = generateKitchenToken();
    expect(hashKitchenToken(secret)).toBe(hashKitchenToken(secret));
    expect(hashKitchenToken(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKitchenToken(secret)).not.toBe(secret);
    expect(hashKitchenToken(secret)).not.toBe(payload);
  });
});

describe("decideJoin", () => {
  const live = { revoked_at: null };
  const base = {
    token: live,
    existingStaff: null,
    targetLocationId: "A",
    recentJoinsCount: 0,
  };

  it("invalid for unknown or revoked tokens", () => {
    expect(decideJoin({ ...base, token: null })).toEqual({ kind: "invalid" });
    expect(
      decideJoin({ ...base, token: { revoked_at: "2026-10-01T00:00:00Z" } })
    ).toEqual({ kind: "invalid" });
  });

  it("joined for a new cook", () => {
    expect(decideJoin(base)).toEqual({ kind: "joined" });
  });

  it("already_joined for the same active cook at the same location", () => {
    expect(
      decideJoin({
        ...base,
        existingStaff: { location_id: "A", is_active: true },
      })
    ).toEqual({ kind: "already_joined" });
  });

  it("rescans are not rate limited", () => {
    expect(
      decideJoin({
        ...base,
        recentJoinsCount: 50,
        existingStaff: { location_id: "A", is_active: true },
      })
    ).toEqual({ kind: "already_joined" });
  });

  it("rate_limited at 20 joins per hour", () => {
    expect(RATE_LIMIT_PER_HOUR).toBe(20);
    expect(decideJoin({ ...base, recentJoinsCount: 19 })).toEqual({
      kind: "joined",
    });
    expect(decideJoin({ ...base, recentJoinsCount: 20 })).toEqual({
      kind: "rate_limited",
    });
    expect(
      decideJoin({
        ...base,
        recentJoinsCount: 21,
        existingStaff: { location_id: "B", is_active: true },
      })
    ).toEqual({ kind: "rate_limited" });
  });

  it("moved when an active cook scans another location's QR", () => {
    expect(
      decideJoin({
        ...base,
        existingStaff: { location_id: "B", is_active: true },
      })
    ).toEqual({ kind: "moved", previousLocationId: "B" });
  });

  it("a removed cook rejoins (at the same or another location)", () => {
    expect(
      decideJoin({
        ...base,
        existingStaff: { location_id: "A", is_active: false },
      })
    ).toEqual({ kind: "joined" });
    expect(
      decideJoin({
        ...base,
        existingStaff: { location_id: "B", is_active: false },
      })
    ).toEqual({ kind: "joined" });
  });
});

describe("canManageKitchenQr", () => {
  it("admin and owner can; member and others cannot", () => {
    expect(
      canManageKitchenQr({ isMiltonAdmin: true, membershipRole: null })
    ).toBe(true);
    expect(
      canManageKitchenQr({ isMiltonAdmin: false, membershipRole: "owner" })
    ).toBe(true);
    expect(
      canManageKitchenQr({ isMiltonAdmin: false, membershipRole: "member" })
    ).toBe(false);
    expect(
      canManageKitchenQr({ isMiltonAdmin: false, membershipRole: null })
    ).toBe(false);
  });
});

describe("buildDisplayName", () => {
  it("joins first and last name, never needs phone or username", () => {
    expect(buildDisplayName({ first_name: "Ana", last_name: "Pérez" })).toBe(
      "Ana Pérez"
    );
    expect(buildDisplayName({ first_name: "Ana" })).toBe("Ana");
    expect(buildDisplayName({})).toBe("Cocina");
  });
  it("caps at 128 characters", () => {
    expect(buildDisplayName({ first_name: "x".repeat(300) })).toHaveLength(128);
  });
});
