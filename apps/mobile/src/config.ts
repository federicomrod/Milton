import Constants from "expo-constants";

/** Plain config, no secret: set in app.config.ts → extra.apiBaseUrl. */
export function apiBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.apiBaseUrl;
  return typeof url === "string" && url ? url : "";
}
