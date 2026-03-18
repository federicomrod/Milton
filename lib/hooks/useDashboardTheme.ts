"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "milton-dashboard-theme";

export interface DashboardTheme {
  primaryColor: string; // hex e.g. "#3b82f6"
  accentColor: string; // hex e.g. "#8b5cf6"
}

export const THEME_DEFAULTS: DashboardTheme = {
  primaryColor: "#202f9d",
  accentColor: "#9e9e9e",
};

/** Preset palettes for quick selection */
export const THEME_PRESETS: Array<{ label: string } & DashboardTheme> = [
  { label: "Default", primaryColor: "#202f9d", accentColor: "#9e9e9e" },
  { label: "Emerald", primaryColor: "#10b981", accentColor: "#06b6d4" },
  { label: "Rose", primaryColor: "#f43f5e", accentColor: "#f97316" },
  { label: "Violet", primaryColor: "#7c3aed", accentColor: "#db2777" },
  { label: "Slate", primaryColor: "#475569", accentColor: "#0ea5e9" },
];

/** Check if hex is valid (3 or 6 chars) */
function isValidHex(hex: string): boolean {
  const clean = hex.replace("#", "");
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean);
}

/**
 * Convert a hex color to a valid CSS color string.
 * Returns hsl(H S% L%) so var(--primary) works in background-color, color-mix, etc.
 */
export function hexToHslString(hex: string): string {
  const clean = hex.replace("#", "");
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  const hVal = Math.round(h * 360);
  const sVal = Math.round(s * 100);
  const lVal = Math.round(l * 100);
  return `hsl(${hVal} ${sVal}% ${lVal}%)`;
}

/** Returns true if color is light (luminance > 0.5) - use dark text; else use light text */
function isLightColor(hex: string): boolean {
  const hsl = hexToHslString(hex);
  const match = hsl.match(/\d+%\s+(\d+)%\)/);
  const l = match ? parseInt(match[1], 10) / 100 : 0.5;
  return l > 0.5;
}

function applyThemeToDom(theme: DashboardTheme) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;

  const primaryHex = isValidHex(theme.primaryColor)
    ? theme.primaryColor
    : THEME_DEFAULTS.primaryColor;
  const accentHex = isValidHex(theme.accentColor)
    ? theme.accentColor
    : THEME_DEFAULTS.accentColor;

  const primaryHsl = hexToHslString(primaryHex);
  root.style.setProperty("--primary", primaryHsl);
  root.style.setProperty("--ring", primaryHsl);
  root.style.setProperty("--accent", hexToHslString(accentHex));

  // Ensure button text is visible: dark primary → white text; light primary → dark text
  const primaryFg = isLightColor(primaryHex) ? "hsl(0 0% 9%)" : "hsl(0 0% 98%)";
  root.style.setProperty("--primary-foreground", primaryFg);
}

function loadFromStorage(): DashboardTheme {
  if (typeof window === "undefined") return THEME_DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...THEME_DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return THEME_DEFAULTS;
}

export function useDashboardTheme() {
  // Lazy initializer: reads from localStorage on first render (no effect needed)
  const [theme, setThemeState] = useState<DashboardTheme>(() => {
    const stored = loadFromStorage();
    return stored;
  });

  // Apply DOM classes/variables whenever theme changes
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = useCallback((updates: Partial<DashboardTheme>) => {
    setThemeState((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      applyThemeToDom(next);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    setThemeState(THEME_DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    applyThemeToDom(THEME_DEFAULTS);
  }, []);

  return { theme, setTheme, resetTheme };
}
