import { describe, expect, it } from "vitest";
import { isPushEnabled } from "./flags";

describe("isPushEnabled", () => {
  it("is off by default and for anything that is not an explicit yes", () => {
    for (const v of [undefined, "", "0", "false", "off", "no", "yes", " "]) {
      expect(isPushEnabled(v), String(v)).toBe(false);
    }
  });
  it("is on only for 1 or true", () => {
    for (const v of ["1", "true", "TRUE", " true "]) {
      expect(isPushEnabled(v), v).toBe(true);
    }
  });
});
