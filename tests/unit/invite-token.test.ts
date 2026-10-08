import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  defaultInviteRole,
  generateInviteToken,
  getInviteStatus,
  hashInviteToken,
  inviteExpiry,
  normalizeInviteEmail,
} from "@/lib/auth/invite-token";

const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("generateInviteToken", () => {
  it("is 32 random bytes encoded as base64url", () => {
    const { token } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).toHaveLength(43);
  });
  it("is unique per call", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
  it("returns the hash of the token, never the token itself", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashInviteToken", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
    expect(hashInviteToken("abc")).not.toBe("abc");
  });
});

describe("getInviteStatus", () => {
  const live = new Date(NOW.getTime() + 3_600_000).toISOString();
  const past = new Date(NOW.getTime() - 3_600_000).toISOString();
  it("pending", () =>
    expect(getInviteStatus({ expires_at: live }, NOW)).toBe("pending"));
  it("expired", () =>
    expect(getInviteStatus({ expires_at: past }, NOW)).toBe("expired"));
  it("accepted wins over expired", () =>
    expect(getInviteStatus({ expires_at: past, accepted_at: past }, NOW)).toBe(
      "accepted"
    ));
  it("revoked wins over pending/expired", () => {
    expect(getInviteStatus({ expires_at: live, revoked_at: past }, NOW)).toBe(
      "revoked"
    );
    expect(getInviteStatus({ expires_at: past, revoked_at: past }, NOW)).toBe(
      "revoked"
    );
  });
});

describe("ttl, role default, email", () => {
  it("TTL default is 7 days", () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(inviteExpiry(NOW).toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });
  it("default role is owner when the company has no owner, else member", () => {
    expect(defaultInviteRole(false)).toBe("owner");
    expect(defaultInviteRole(true)).toBe("member");
  });
  it("normalizes email", () =>
    expect(normalizeInviteEmail("  Foo@Bar.COM ")).toBe("foo@bar.com"));
});
