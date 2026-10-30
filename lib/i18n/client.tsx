"use client";
// lib/i18n/client.tsx — the language the server resolved, for client code.

import { createContext, useContext, useMemo } from "react";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  localeFor,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { fmt, getDictionary, type Dictionary } from "./index";

const I18nContext = createContext<PreferredLanguage>(
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
);

export function I18nProvider({
  lang,
  children,
}: {
  lang: PreferredLanguage;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

export interface UseT {
  lang: PreferredLanguage;
  /** Intl locale for dates and numbers (es-MX, en-US, de-DE). */
  locale: string;
  d: Dictionary;
  fmt: typeof fmt;
}

export function useT(): UseT {
  const lang = useContext(I18nContext);
  return useMemo(
    () => ({ lang, locale: localeFor(lang), d: getDictionary(lang), fmt }),
    [lang]
  );
}
