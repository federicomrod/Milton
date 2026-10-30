// The company language picks the dictionary (language-store.ts). Spanish until
// it is known, and whenever it is anything else.

import React, { createContext, useContext, useSyncExternalStore } from "react";
import { currentLanguage, subscribeLanguage } from "./language-store";
import { DICTIONARIES, type Language, type Strings } from "./strings";

interface I18n {
  language: Language;
  s: Strings;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(
    subscribeLanguage,
    currentLanguage,
    currentLanguage
  );
  // Memoising on the string keeps the object stable between renders.
  const value = React.useMemo<I18n>(
    () => ({ language, s: DICTIONARIES[language] }),
    [language]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStrings(): Strings {
  return useContext(Ctx)?.s ?? DICTIONARIES.es;
}

export function useLanguage(): Language {
  return useContext(Ctx)?.language ?? "es";
}
