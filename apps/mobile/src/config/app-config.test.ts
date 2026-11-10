import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../app.config";

type PluginEntry = string | [string, Record<string, unknown>];
const plugin = (name: string) =>
  (config.plugins as PluginEntry[]).find((p) =>
    Array.isArray(p) ? p[0] === name : p === name
  );
const options = (name: string) => {
  const p = plugin(name);
  return Array.isArray(p) ? p[1] : {};
};

describe("native microphone configuration (iOS usage string)", () => {
  it("expo-audio carries a non-empty microphone description", () => {
    const text = options("expo-audio").microphonePermission;
    expect(typeof text).toBe("string");
    expect((text as string).length).toBeGreaterThan(10);
  });

  it("no other plugin removes it: image-picker must not set microphonePermission to false", () => {
    // `false` makes the plugin DELETE NSMicrophoneUsageDescription, and its mod
    // runs after expo-audio's, so the string vanished from the built app and
    // iOS answered «denied» without ever asking.
    expect(options("expo-image-picker").microphonePermission).not.toBe(false);
    expect(options("expo-image-picker").microphonePermission).toBe(
      options("expo-audio").microphonePermission
    );
  });

  it("the camera, photos and Face ID strings are still there", () => {
    expect(options("expo-image-picker").cameraPermission).toBeTruthy();
    expect(options("expo-image-picker").photosPermission).toBeTruthy();
    expect(options("expo-local-authentication").faceIDPermission).toBeTruthy();
  });

  it("declares standard-HTTPS-only encryption for App Store export compliance", () => {
    const ios = config.ios as { infoPlist?: Record<string, unknown> };
    expect(ios.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("production builds call the production API; the other profiles are untouched", () => {
    const eas = JSON.parse(
      readFileSync(join(__dirname, "../../eas.json"), "utf8")
    ) as { build: Record<string, { env?: Record<string, string> }> };
    expect(eas.build.production.env?.EXPO_PUBLIC_API_BASE_URL).toBe(
      "https://app.miltonlabs.ai"
    );
    expect(eas.build.development.env).toBeUndefined();
    expect(eas.build["development-simulator"].env).toBeUndefined();
    expect(eas.build.preview.env).toBeUndefined();
  });
});
