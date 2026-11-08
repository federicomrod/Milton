import { describe, expect, it } from "vitest";
import {
  cocinaEntryRoute,
  endsKitchenWithManager,
  forgotPasswordUrl,
  switchTargets,
} from "./entry";

describe("Cocina entrance", () => {
  it("a remembered cook goes to the PIN, never back to the invitation", () => {
    expect(cocinaEntryRoute({ staffId: "s1", name: "Carlos" })).toBe("/pin");
    expect(cocinaEntryRoute({ name: "Carlos" })).toBe("/pin");
    expect(cocinaEntryRoute({ staffId: "s1" })).toBe("/pin");
  });
  it("a first-time phone goes to the invitation", () => {
    expect(cocinaEntryRoute(null)).toBe("/join");
    expect(cocinaEntryRoute(undefined)).toBe("/join");
    expect(cocinaEntryRoute({})).toBe("/join");
    expect(cocinaEntryRoute({ staffId: null, name: "" })).toBe("/join");
  });
});

describe("password recovery", () => {
  it("opens the web's own forgot-password page on the same server", () => {
    expect(forgotPasswordUrl("https://app.example.test")).toBe(
      "https://app.example.test/auth/forgot-password"
    );
    expect(forgotPasswordUrl("https://app.example.test///")).toBe(
      "https://app.example.test/auth/forgot-password"
    );
  });
  it("never puts an email or anything personal in the URL", () => {
    expect(forgotPasswordUrl("https://x.test")).not.toMatch(/[?@=]/);
  });
});

describe("switching modes without signing out", () => {
  it("a manager can always go back to Gestión; a cook never gets it", () => {
    expect(
      switchTargets({ managerIn: true, kitchenIn: true, canSelfKitchen: false })
        .gestion
    ).toBe(true);
    expect(
      switchTargets({
        managerIn: false,
        kitchenIn: true,
        canSelfKitchen: false,
      }).gestion
    ).toBe(false);
  });
  it("Cocina is offered to a signed-in cook, or to a manager the server lets open it", () => {
    expect(
      switchTargets({
        managerIn: false,
        kitchenIn: true,
        canSelfKitchen: false,
      }).cocina
    ).toBe(true);
    expect(
      switchTargets({ managerIn: true, kitchenIn: false, canSelfKitchen: true })
        .cocina
    ).toBe(true);
    expect(
      switchTargets({
        managerIn: true,
        kitchenIn: false,
        canSelfKitchen: false,
      }).cocina
    ).toBe(false);
  });
  it("nobody signed in: nothing to switch to", () => {
    expect(
      switchTargets({
        managerIn: false,
        kitchenIn: false,
        canSelfKitchen: true,
      })
    ).toEqual({ gestion: false, cocina: false });
  });
});

describe("manager sign-out and the manager's own kitchen session", () => {
  it("ends the manager's own kitchen session (selfDevice) with the account", () => {
    expect(endsKitchenWithManager({ selfDevice: true })).toBe(true);
  });
  it("never signs out a cook who joined with an invitation or PIN", () => {
    expect(endsKitchenWithManager({ selfDevice: false })).toBe(false);
    expect(endsKitchenWithManager({})).toBe(false);
    expect(endsKitchenWithManager(null)).toBe(false);
    expect(endsKitchenWithManager(undefined)).toBe(false);
  });
});
