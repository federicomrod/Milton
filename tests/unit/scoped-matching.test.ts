import { describe, it, expect } from "vitest";
import {
  buildScopedNameIndex,
  resolveScopedName,
} from "@/lib/restaurant/scoped-matching";

const identity = (s: string) => s;

describe("buildScopedNameIndex / resolveScopedName", () => {
  it("resolves an exact match within the given scope", () => {
    const index = buildScopedNameIndex(
      [
        { id: "coke-a", name: "coke", scopeId: "brand-a" },
        { id: "coke-b", name: "coke", scopeId: "brand-b" },
      ],
      identity
    );
    expect(resolveScopedName(index, "brand-a", "coke")).toBe("coke-a");
    expect(resolveScopedName(index, "brand-b", "coke")).toBe("coke-b");
  });

  it("never falls back into a different scope's bucket", () => {
    const index = buildScopedNameIndex(
      [{ id: "fries-a", name: "fries", scopeId: "brand-a" }],
      identity
    );
    // brand-b has no "fries" of its own, and brand-a's is not visible to it.
    expect(resolveScopedName(index, "brand-b", "fries")).toBeNull();
  });

  it("falls back to the unscoped/company-wide bucket when the scope has no match", () => {
    const index = buildScopedNameIndex(
      [{ id: "water-legacy", name: "water", scopeId: null }],
      identity
    );
    expect(resolveScopedName(index, "brand-a", "water")).toBe("water-legacy");
    expect(resolveScopedName(index, null, "water")).toBe("water-legacy");
  });

  it("prefers the scoped match over an unscoped fallback with the same name", () => {
    const index = buildScopedNameIndex(
      [
        { id: "coke-legacy", name: "coke", scopeId: null },
        { id: "coke-brand-a", name: "coke", scopeId: "brand-a" },
      ],
      identity
    );
    expect(resolveScopedName(index, "brand-a", "coke")).toBe("coke-brand-a");
    // A different/unknown scope still gets the legacy fallback.
    expect(resolveScopedName(index, "brand-c", "coke")).toBe("coke-legacy");
  });

  it("returns null when nothing matches in scope or fallback", () => {
    const index = buildScopedNameIndex([], identity);
    expect(resolveScopedName(index, "brand-a", "anything")).toBeNull();
  });

  it("returns null when scopeId is null and there is no unscoped entry", () => {
    const index = buildScopedNameIndex(
      [{ id: "coke-brand-a", name: "coke", scopeId: "brand-a" }],
      identity
    );
    expect(resolveScopedName(index, null, "coke")).toBeNull();
  });

  it("skips rows with an empty/falsy name", () => {
    const index = buildScopedNameIndex(
      [{ id: "x", name: "", scopeId: "brand-a" }],
      identity
    );
    expect(resolveScopedName(index, "brand-a", "")).toBeNull();
  });

  it("applies the provided normalize function consistently to both build and lookup keys", () => {
    const index = buildScopedNameIndex(
      [{ id: "coke-a", name: "Coke", scopeId: "brand-a" }],
      (s) => s.toLowerCase()
    );
    expect(resolveScopedName(index, "brand-a", "coke")).toBe("coke-a");
  });
});
