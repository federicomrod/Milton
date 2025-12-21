"use client";

import { UserPreferencesProvider } from "@/lib/context/UserPreferencesContext";
import { BusinessProvider } from "@/lib/business-context";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ReactNode } from "react";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <UserPreferencesProvider>
      <ThemeProvider>
        <BusinessProvider>{children}</BusinessProvider>
      </ThemeProvider>
    </UserPreferencesProvider>
  );
}
