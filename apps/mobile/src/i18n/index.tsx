// The device language picks the dictionary. Spanish when it is anything else.

import React, { createContext, useContext, useMemo } from "react";
import { getLocales } from "expo-localization";
import {
  DICTIONARIES,
  languageOf,
  type Language,
  type Strings,
} from "./strings";

export function deviceLanguage(): Language {
  try {
    return languageOf(getLocales()[0]?.languageCode);
  } catch {
    return "es";
  }
}

interface I18n {
  language: Language;
  s: Strings;
}

const Ctx = createContext<I18n>({ language: "es", s: DICTIONARIES.es });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<I18n>(() => {
    const language = deviceLanguage();
    return { language, s: DICTIONARIES[language] };
  }, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStrings(): Strings {
  return useContext(Ctx).s;
}

export function useLanguage(): Language {
  return useContext(Ctx).language;
}
