// Track app opens (last-seen ping) for adoption metrics. Throttled to at most
// once every 15 minutes. Fails silently when the endpoint or table is missing.

import React from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useManager } from "./ManagerProvider";
import { shouldPing, throttleKey } from "./activity-tracking-core";

async function getLastPing(key: string): Promise<number> {
  try {
    const stored = await SecureStore.getItemAsync(key);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

async function setLastPing(key: string, timestamp: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, String(timestamp));
  } catch {
    // Ignore: throttling is best-effort.
  }
}

/**
 * Call the activity endpoint when the app comes to foreground, throttled to
 * at most once every 15 minutes. This is a "last seen" ping for adoption
 * metrics. Fails silently (no user-facing error, no crash) when the endpoint
 * or migration 082 is not applied yet.
 */
export function useActivityTracking(surface: "gestion" | "cocina") {
  const { api, user } = useManager();
  const appState = React.useRef<AppStateStatus>((AppState.currentState as AppStateStatus) || "active");

  React.useEffect(() => {
    let off = false;
    if (!user?.id) return;

    const key = throttleKey(user.id, surface);

    async function recordIfNeeded() {
      if (off) return;
      const now = Date.now();
      const last = await getLastPing(key);
      if (!shouldPing(now, last)) return; // Throttled
      const platform = Platform.OS === "android" ? "android" : "ios";
      try {
        await api.recordActivity(surface, platform);
        await setLastPing(key, now);
      } catch {
        // Fail silently: this is a background ping, never block the app or
        // show an error when the endpoint or table is missing.
      }
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        void recordIfNeeded();
      }
      appState.current = nextState;
    });

    // Record once on mount (app opened).
    void recordIfNeeded();

    return () => {
      off = true;
      subscription.remove();
    };
  }, [api, user, surface]);
}
