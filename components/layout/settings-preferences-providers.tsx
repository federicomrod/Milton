"use client";

import { UserPreferencesProvider } from "@/lib/context/UserPreferencesContext";
import { UserProvider } from "@/lib/context/UserContext";
import { ReactNode } from "react";

/** Ajustes is the only live reader of user prefs. Keep the fetch off every other page. */
export function SettingsPreferencesProviders({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <UserProvider>
      <UserPreferencesProvider>{children}</UserPreferencesProvider>
    </UserProvider>
  );
}
