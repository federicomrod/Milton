/** Client-only theme persistence. ThemeProvider reads this; settings writes it. */

export const THEME_STORAGE_KEY = "milton.theme";
export const THEME_EVENT = "milton:theme";

export type AppTheme = "light" | "dark" | "system";

export function normalizeTheme(value: unknown): AppTheme {
  return value === "dark" || value === "system" ? value : "light";
}

export function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "light";
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function persistTheme(theme: string): void {
  if (typeof window === "undefined") return;
  const next = normalizeTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // private mode / quota — applying the class still works this session
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
}

export function applyThemeClass(theme: AppTheme): void {
  if (typeof window === "undefined") return;
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.add(dark ? "dark" : "light");
    return;
  }
  root.classList.add(theme);
}
