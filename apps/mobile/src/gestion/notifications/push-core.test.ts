import { describe, expect, it } from "vitest";
import {
  deviceTimezone,
  hourLabel,
  permissionView,
  pushUnavailable,
  routeForNotification,
  stepHour,
} from "./push-core";

describe("where a tapped notification goes", () => {
  it("opens the screen it names", () => {
    expect(routeForNotification({ screen: "costos" })).toBe("/costos");
    expect(routeForNotification({ screen: "ventas" })).toBe("/ventas");
    expect(routeForNotification({ screen: "rentabilidad" })).toBe(
      "/rentabilidad"
    );
    expect(routeForNotification({ screen: "inicio" })).toBe("/");
  });
  it("anything else opens Inicio (no path, link or unknown screen is followed)", () => {
    for (const bad of [
      undefined,
      null,
      {},
      { screen: "perfil" },
      { screen: "/costos" },
      { screen: "https://evil.example" },
      { screen: "toString" },
      { screen: 5 },
      "costos",
    ])
      expect(routeForNotification(bad)).toBe("/");
  });
});

describe("permission", () => {
  it("asks only when it can; denied is a Settings matter", () => {
    expect(permissionView({ granted: true, canAskAgain: true })).toBe("on");
    expect(permissionView({ granted: false, canAskAgain: true })).toBe("ask");
    expect(permissionView({ granted: false, canAskAgain: false })).toBe(
      "denied"
    );
  });
});

describe("can this build receive push?", () => {
  it("no on a simulator, no without an Expo project, yes otherwise", () => {
    expect(pushUnavailable({ isDevice: false, projectId: "p" })).toBe(
      "simulator"
    );
    expect(pushUnavailable({ isDevice: true, projectId: null })).toBe(
      "no-project"
    );
    expect(pushUnavailable({ isDevice: true, projectId: "" })).toBe(
      "no-project"
    );
    expect(pushUnavailable({ isDevice: true, projectId: "p" })).toBeNull();
  });
});

describe("hours and timezone", () => {
  it("wraps around midnight", () => {
    expect(stepHour(23, 1)).toBe(0);
    expect(stepHour(0, -1)).toBe(23);
    expect(stepHour(8, 1)).toBe(9);
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(24)).toBe("00:00");
  });
  it("always gives the server a timezone", () => {
    expect(deviceTimezone(() => "Europe/Berlin")).toBe("Europe/Berlin");
    expect(deviceTimezone(() => undefined)).toBe("UTC");
    expect(
      deviceTimezone(() => {
        throw new Error("x");
      })
    ).toBe("UTC");
  });
});
