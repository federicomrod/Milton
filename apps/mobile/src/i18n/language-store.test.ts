import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentLanguage,
  setCurrentLanguage,
  subscribeLanguage,
} from "./language-store";

afterEach(() => setCurrentLanguage(null));

describe("the app language follows the company, not the phone", () => {
  it("starts in Spanish and takes the company language when it is known", () => {
    expect(currentLanguage()).toBe("es");
    expect(setCurrentLanguage("de")).toBe("de");
    expect(currentLanguage()).toBe("de");
    expect(setCurrentLanguage("en")).toBe("en");
  });

  it("anything unknown (or signing out) is Spanish", () => {
    setCurrentLanguage("en");
    for (const v of [null, undefined, "fr", "", 7]) {
      setCurrentLanguage("en");
      expect(setCurrentLanguage(v)).toBe("es");
    }
  });

  it("tells subscribers only when it really changes", () => {
    const fn = vi.fn();
    const off = subscribeLanguage(fn);
    setCurrentLanguage("de");
    setCurrentLanguage("de");
    setCurrentLanguage("en");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    setCurrentLanguage("es");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not read the phone's locale any more", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(`${__dirname}/index.tsx`, "utf8");
    expect(src).not.toContain("getLocales");
  });
});
