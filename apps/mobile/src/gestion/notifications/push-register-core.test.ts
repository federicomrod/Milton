// Tests for push registration logic.

import { describe, it, expect } from "vitest";
import { shouldSaveToken, statusAfterRegister } from "./push-register-core";

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

describe("registration status logic", () => {
  it("when server returns registered:false, should not save token", () => {
    const response = { registered: false };
    expect(shouldSaveToken(response)).toBe(false);
    // App should show 'unavailable' status, not 'saved'
  });

  it("when server returns registered:true, should save token", () => {
    const response = { registered: true };
    expect(shouldSaveToken(response)).toBe(true);
    // App should show 'saved' status
  });
});

describe("statusAfterRegister", () => {
  it("should return 'saved' when registered is true", () => {
    expect(statusAfterRegister(true)).toBe("saved");
  });

  it("should return 'unavailable' when registered is false", () => {
    expect(statusAfterRegister(false)).toBe("unavailable");
  });
});
