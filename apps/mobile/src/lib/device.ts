import { Platform } from "react-native";

/** How this phone is named in the manager's list of a cook's phones. */
export function deviceLabel(): string {
  return Platform.OS === "ios" ? "iPhone · Expo Go" : "Android · Expo Go";
}
