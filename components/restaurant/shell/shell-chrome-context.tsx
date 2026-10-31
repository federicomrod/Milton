"use client";

import { createContext, useContext } from "react";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { RESTAURANT_COCKPIT_DEFAULT_LANGUAGE } from "@/lib/restaurant/language";
import type { Capability } from "@/lib/auth/capabilities";

export interface RestaurantShellChromeValue {
  lang: PreferredLanguage;
  isAdmin: boolean;
  lastSyncedAt: string | null;
  userName?: string | null;
  /** Every company the person belongs to (the switcher shows 2+). */
  companies?: Array<{ id: string; name: string; isSupport: boolean }>;
  activeCompanyId?: string | null;
  /** Set while the active company is a Milton support membership. */
  supportCompanyName?: string | null;
  /**
   * What this person may do, as answered by the SERVER (capabilityFlags).
   * Absent outside the shell layout (onboarding): the controls then show and
   * the server still has the last word.
   */
  capabilities?: Partial<Record<Capability, boolean>>;
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

/** The server's answer for one capability (no role comparison on the client). */
export function useCan(capability: Capability): boolean {
  return (
    useContext(RestaurantShellChromeContext).capabilities?.[capability] ?? true
  );
}
