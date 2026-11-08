import { describe, expect, it } from "vitest";
import { SIGNED_OUT_HOME, nextLanded, signedOutLanding } from "./landing";

describe("signedOutLanding", () => {
  it("opens on the entry screen from «/»", () => {
    expect(signedOutLanding("/", false)).toBe(SIGNED_OUT_HOME);
    expect(SIGNED_OUT_HOME).toBe("/entrada");
  });

  it("does not open on the invite screen when the router falls back to it", () => {
    expect(signedOutLanding("/join", false)).toBe("/entrada");
  });

  it("opens on the entry screen after a session ends on a protected screen", () => {
    for (const p of ["/perfil", "/ventas", "/costos", "/historial", "/cuenta"])
      expect(signedOutLanding(p, false)).toBe("/entrada");
  });

  it("leaves the entry and login screens alone", () => {
    expect(signedOutLanding("/entrada", false)).toBeNull();
    expect(signedOutLanding("/login", false)).toBeNull();
  });

  it("keeps the invite deep links going to join", () => {
    expect(signedOutLanding("/k/abc123", false)).toBeNull();
    expect(signedOutLanding("/join", true)).toBeNull();
  });
});

describe("the landing redirect fires once, not on every render", () => {
  /** Mirrors SignedOutLanding: is <Redirect> still rendered after each path? */
  function redirectsAfter(open: string, path: string[]) {
    const target = signedOutLanding(open, false);
    let landed = target === null;
    const rendered: boolean[] = [];
    for (const p of [open, ...path]) {
      landed = nextLanded(landed, target, p);
      rendered.push(!landed && target !== null);
    }
    return rendered;
  }

  it("opened on «/»: redirects until it lands on /entrada, then never again", () => {
    // «/» → /entrada (landed) → /login (the person tapped «Iniciar sesión»)
    expect(redirectsAfter("/", ["/entrada", "/login"])).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("the old behaviour (redirect whenever target is set) would bounce /login", () => {
    const target = signedOutLanding("/", false);
    const oldRendered = ["/", "/entrada", "/login"].map(() => target !== null);
    expect(oldRendered).toEqual([true, true, true]); // /login re-redirected: the bug
  });

  it("opened directly on /login or an invite link: it never redirects at all", () => {
    expect(redirectsAfter("/login", ["/entrada", "/login"])).toEqual([
      false,
      false,
      false,
    ]);
    expect(redirectsAfter("/k/abc", ["/join"])).toEqual([false, false]);
  });

  it("stays landed once landed, whatever the next path", () => {
    expect(nextLanded(true, "/entrada", "/join")).toBe(true);
    expect(nextLanded(false, "/entrada", "/login")).toBe(false);
    expect(nextLanded(false, "/entrada", "/entrada")).toBe(true);
    expect(nextLanded(false, null, "/")).toBe(true);
  });
});
