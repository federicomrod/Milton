"use client";

import { useEffect } from "react";
import {
  THEME_EVENT,
  THEME_STORAGE_KEY,
  applyThemeClass,
  normalizeTheme,
  readStoredTheme,
} from "@/lib/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const sync = (value?: string | null) => {
      applyThemeClass(
        value == null || value === ""
          ? readStoredTheme()
          : normalizeTheme(value)
      );
    };
    sync();

    const onCustom = (event: Event) => {
      sync((event as CustomEvent<string>).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) sync(event.newValue);
    };
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => sync();

    window.addEventListener(THEME_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    mediaQuery.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
      mediaQuery.removeEventListener("change", onSystem);
    };
  }, []);

  return <>{children}</>;
}
