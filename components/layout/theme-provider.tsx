"use client";

import { useEffect } from "react";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { prefs } = useUserPreferences();

  useEffect(() => {
    const root = window.document.documentElement;

    // Remove existing theme classes
    root.classList.remove("light", "dark");

    if (prefs.theme === "system") {
      // Use system preference
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);

      // Listen for system theme changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) => {
        root.classList.remove("light", "dark");
        root.classList.add(e.matches ? "dark" : "light");
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      // Use user preference
      root.classList.add(prefs.theme);
    }
  }, [prefs.theme]);

  return <>{children}</>;
}
