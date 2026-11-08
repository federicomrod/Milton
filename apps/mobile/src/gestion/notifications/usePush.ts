// The notification settings of this phone: permission (asked ONLY when the
// person taps «Activar»), the Expo push token, and the choices saved on the
// server. Needs a real iPhone and a build with an Expo project id; otherwise it
// says why instead of failing.

import React from "react";
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useManager } from "../ManagerProvider";
import {
  DEFAULT_CHOICES,
  deviceTimezone,
  permissionView,
  pushUnavailable,
  type Choices,
  type PermissionView,
  type PushUnavailable,
} from "./push-core";

const TOKEN_KEY = "milton_push_token";

export async function storedPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export function usePush() {
  const { api } = useManager();
  const [permission, setPermission] = React.useState<PermissionView>("ask");
  const [unavailable] = React.useState<PushUnavailable | null>(() =>
    pushUnavailable({ isDevice: Device.isDevice, projectId: projectId() })
  );
  const [choices, setChoices] = React.useState<Choices>(DEFAULT_CHOICES);
  const [token, setToken] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"idle" | "saved" | "failed">(
    "idle"
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let off = false;
    (async () => {
      const current = await Notifications.getPermissionsAsync();
      if (off) return;
      setPermission(permissionView(current));
      const saved = await storedPushToken();
      if (off || !saved) return;
      setToken(saved);
      try {
        const prefs = await api.pushPrefs(saved);
        if (!off && prefs.registered) setChoices(prefs);
      } catch {
        // Keep the defaults; the next save sends the screen's values.
      }
    })();
    return () => {
      off = true;
    };
  }, [api]);

  const register = React.useCallback(
    async (next: Choices) => {
      const id = projectId();
      const pushToken = (
        await Notifications.getExpoPushTokenAsync(
          id ? { projectId: id } : undefined
        )
      ).data;
      await api.registerPush({
        token: pushToken,
        platform: Platform.OS === "android" ? "android" : "ios",
        timezone: deviceTimezone(),
        ...next,
      });
      await SecureStore.setItemAsync(TOKEN_KEY, pushToken);
      setToken(pushToken);
    },
    [api]
  );

  /** The one place the system asks for permission, from the person's tap. */
  async function enable() {
    if (unavailable || busy) return;
    setBusy(true);
    setStatus("idle");
    try {
      const asked = await Notifications.requestPermissionsAsync();
      setPermission(permissionView(asked));
      if (asked.granted) await register(choices);
      setStatus(asked.granted ? "saved" : "idle");
    } catch {
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  async function change(patch: Partial<Choices>) {
    const next = { ...choices, ...patch };
    setChoices(next);
    if (!token) return;
    setStatus("idle");
    try {
      await api.savePushPrefs(token, patch);
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  return {
    permission,
    unavailable,
    choices,
    status,
    busy,
    registered: token !== null,
    enable,
    change,
    openSettings: () => void Linking.openSettings(),
  };
}

/** Sign-out: stop notifications on this phone (best effort, never blocks). */
export async function unregisterThisPhone(
  api: ReturnType<typeof useManager>["api"]
) {
  const token = await storedPushToken();
  if (!token) return;
  try {
    await api.unregisterPush(token);
  } catch {
    // The server also drops dead tokens by itself.
  }
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}
