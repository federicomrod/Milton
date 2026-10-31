import { describe, expect, it } from "vitest";
import {
  REFRESH_MARGIN_S,
  accessOf,
  canInviteTeam,
  canUseGestion,
  needsRefresh,
  pickCompany,
} from "./session-core";
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
