import { describe, expect, it } from "vitest";
import {
  REFRESH_MARGIN_S,
  accessOf,
  canInviteTeam,
  canManageKitchenTeam,
  canUseGestion,
  loadTokensPatiently,
  needsRefresh,
  pickCompany,
  refreshOutcomeOf,
  tokenLoadOf,
  type TokenLoad,
} from "./session-core";
import { ApiError } from "../api/client";
import type { ManagerCompany } from "./types";

const co = (
  id: string,
  role: string | null,
  caps: string[] = []
): ManagerCompany => ({
  id,
  name: id,
  role,
  capabilities: caps,
});

describe("token renewal", () => {
  it("renews a little before the access token ends", () => {
    const now = 1_000_000_000_000;
    const t = now / 1000;
    expect(needsRefresh(t + REFRESH_MARGIN_S + 30, now)).toBe(false);
    expect(needsRefresh(t + REFRESH_MARGIN_S - 1, now)).toBe(true);
    expect(needsRefresh(t - 5, now)).toBe(true);
    expect(needsRefresh(null, now)).toBe(false);
  });
});

describe("who can use Gestión", () => {
  it("owner, admin and manager; every other role gets «sin acceso»", () => {
    for (const role of ["owner", "admin", "manager"]) {
      expect(canUseGestion(co("a", role))).toBe(true);
    }
    for (const role of ["analyst", "viewer", "member", null]) {
      expect(canUseGestion(co("a", role))).toBe(false);
    }
    expect(accessOf([co("a", "member"), co("b", "analyst")])).toBe("none");
    expect(accessOf([co("a", "member"), co("b", "manager")])).toBe("ok");
  });

  it("opens the remembered company if it still works, else the first that does", () => {
    const list = [co("a", "member"), co("b", "manager"), co("c", "owner")];
    expect(pickCompany(list, "c")?.id).toBe("c");
    expect(pickCompany(list, "a")?.id).toBe("b");
    expect(pickCompany(list, null)?.id).toBe("b");
    expect(pickCompany([co("a", "member")], null)).toBeNull();
  });

  it("only the owner (kitchen.qr) can invite the team", () => {
    expect(canInviteTeam(co("a", "owner", ["kitchen.qr"]))).toBe(true);
    expect(canInviteTeam(co("a", "manager", ["prices.edit"]))).toBe(false);
    expect(canInviteTeam(null)).toBe(false);
  });
});

describe("Equipo de cocina rights", () => {
  it("owner, admin and manager; the capability or, until it is listed, the role", () => {
    expect(canManageKitchenTeam(null)).toBe(false);
    expect(canManageKitchenTeam(co("a", "owner"))).toBe(true);
    expect(canManageKitchenTeam(co("a", "admin"))).toBe(true);
    expect(canManageKitchenTeam(co("a", "manager"))).toBe(true);
    expect(canManageKitchenTeam(co("a", "viewer"))).toBe(false);
    expect(canManageKitchenTeam(co("a", null))).toBe(false);
    expect(canManageKitchenTeam(co("a", "viewer", ["kitchen.team"]))).toBe(
      true
    );
  });
});

describe("renewal outcome: only the server's «no» ends the session", () => {
  it("a rejected refresh token (401, 400, 403, unauthorized) is «rejected»", () => {
    expect(refreshOutcomeOf(new ApiError("unauthorized", 401))).toBe(
      "rejected"
    );
    expect(refreshOutcomeOf(new ApiError("client", 401))).toBe("rejected");
    expect(refreshOutcomeOf(new ApiError("client", 400))).toBe("rejected");
    expect(refreshOutcomeOf(new ApiError("client", 403))).toBe("rejected");
  });
  it("no connection, a timeout, a busy server or a login wall are «unavailable» (keep the login)", () => {
    for (const kind of [
      "network",
      "timeout",
      "unreachable",
      "server",
    ] as const) {
      expect(refreshOutcomeOf(new ApiError(kind))).toBe("unavailable");
    }
    expect(refreshOutcomeOf(new ApiError("server", 503))).toBe("unavailable");
    expect(refreshOutcomeOf(new ApiError("client", 429))).toBe("unavailable");
    expect(refreshOutcomeOf(new ApiError("credentials_unreadable"))).toBe(
      "unavailable"
    );
    expect(refreshOutcomeOf(new Error("anything else"))).toBe("unavailable");
    expect(refreshOutcomeOf(undefined)).toBe("unavailable");
  });
});

describe("what the secure store said at launch", () => {
  const meta = JSON.stringify({
    expiresAt: 1234,
    user: { id: "u", email: "a@example.test", name: "Ana" },
  });
  it("a complete login is «found»", () => {
    const r = tokenLoadOf({ access: "a", refresh: "r", meta });
    expect(r.kind).toBe("found");
    if (r.kind === "found") {
      expect(r.tokens).toMatchObject({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: 1234,
      });
    }
  });
  it("nothing stored (or a part missing) is «absent» = signed out", () => {
    expect(tokenLoadOf({ access: null, refresh: null, meta: null }).kind).toBe(
      "absent"
    );
    expect(tokenLoadOf({ access: "a", refresh: null, meta }).kind).toBe(
      "absent"
    );
    expect(tokenLoadOf({ access: "a", refresh: "r", meta: null }).kind).toBe(
      "absent"
    );
    expect(
      tokenLoadOf({ access: "a", refresh: "r", meta: "{broken" }).kind
    ).toBe("absent");
  });
  it("retries an unreadable store, then returns the answer; a bounded number of times", async () => {
    const found = { kind: "found", tokens: {} } as unknown as TokenLoad;
    const answers: TokenLoad[] = [
      { kind: "unreadable" },
      { kind: "unreadable" },
      found,
    ];
    const waits: number[] = [];
    const got = await loadTokensPatiently(
      async () => answers.shift() as TokenLoad,
      async (ms) => void waits.push(ms)
    );
    expect(got).toBe(found);
    expect(waits).toHaveLength(2);
    let calls = 0;
    const never = await loadTokensPatiently(
      async () => (calls++, { kind: "unreadable" } as TokenLoad),
      async () => {}
    );
    expect(never.kind).toBe("unreadable");
    expect(calls).toBe(3);
  });
  it("does not retry «absent»", async () => {
    let calls = 0;
    await loadTokensPatiently(
      async () => (calls++, { kind: "absent" } as TokenLoad),
      async () => {}
    );
    expect(calls).toBe(1);
  });
});
