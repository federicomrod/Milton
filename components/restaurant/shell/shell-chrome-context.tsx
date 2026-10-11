"use client";

import { createContext, useContext } from "react";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { RESTAURANT_COCKPIT_DEFAULT_LANGUAGE } from "@/lib/restaurant/language";

export interface RestaurantShellChromeValue {
  lang: PreferredLanguage;
  isAdmin: boolean;
  lastSyncedAt: string | null;
}

const RestaurantShellChromeContext = createContext<RestaurantShellChromeValue>({
  lang: RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  isAdmin: false,
  lastSyncedAt: null,
});

export function RestaurantShellChromeProvider({
  value,
  children,
}: {
  value: RestaurantShellChromeValue;
  children: React.ReactNode;
}) {
  return (
    <RestaurantShellChromeContext.Provider value={value}>
      {children}
    </RestaurantShellChromeContext.Provider>
  );
}

export function useRestaurantShellChrome(): RestaurantShellChromeValue {
  return useContext(RestaurantShellChromeContext);
}
