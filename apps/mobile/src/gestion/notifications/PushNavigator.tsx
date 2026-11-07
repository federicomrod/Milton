// Shows notifications while the app is open and opens the right screen when one
// is tapped (also when the tap launched the app). Mounted only for a signed-in
// manager, so a tap while signed out goes nowhere.

import React from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { routeForNotification } from "./push-core";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function PushNavigator() {
  const router = useRouter();
  const last = Notifications.useLastNotificationResponse();
  const handled = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    router.push(
      routeForNotification(last.notification.request.content.data) as never
    );
  }, [last, router]);

  return null;
}
