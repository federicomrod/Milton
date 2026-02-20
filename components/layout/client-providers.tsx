"use client";

import { UserPreferencesProvider } from "@/lib/context/UserPreferencesContext";
import { BusinessProvider } from "@/lib/business-context";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { UserProvider } from "@/lib/context/UserContext";
import { ReactNode } from "react";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <UserPreferencesProvider>
        <ThemeProvider>
          <BusinessProvider>{children}</BusinessProvider>
        </ThemeProvider>
      </UserPreferencesProvider>
    </UserProvider>
  );
}
