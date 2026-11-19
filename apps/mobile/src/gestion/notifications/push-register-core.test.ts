// Tests for push registration logic.

import { describe, it, expect } from "vitest";
import { shouldSaveToken } from "./push-register-core";

describe("shouldSaveToken", () => {
  it("should return true when registered === true", () => {
    expect(shouldSaveToken({ registered: true })).toBe(true);
  });

  it("should return false when registered === false", () => {
    expect(shouldSaveToken({ registered: false })).toBe(false);
  });

  it("should return false when registered is not explicitly true", () => {
    // @ts-expect-error - testing runtime behavior
    expect(shouldSaveToken({ registered: undefined })).toBe(false);
    // @ts-expect-error - testing runtime behavior
    expect(shouldSaveToken({ registered: null })).toBe(false);
    // @ts-expect-error - testing runtime behavior
    expect(shouldSaveToken({ registered: "true" })).toBe(false);
    // @ts-expect-error - testing runtime behavior
    expect(shouldSaveToken({ registered: 1 })).toBe(false);
    // @ts-expect-error - testing runtime behavior
    expect(shouldSaveToken({})).toBe(false);
  });
});
