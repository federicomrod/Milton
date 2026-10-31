import { describe, expect, it } from "vitest";
import { SIGNED_OUT_HOME, signedOutLanding } from "./landing";

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
