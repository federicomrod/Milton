// The app speaks the company's language (the same setting as the web), not the
// phone's. Until the company language is known it is Spanish. A tiny store so
// the provider, the API client and the screens read the same value.

import { languageOf, type Language } from "./strings";

let current: Language = "es";
const listeners = new Set<() => void>();

export function currentLanguage(): Language {
  return current;
}

/** Takes whatever the server sent; anything unknown is Spanish. */
export function setCurrentLanguage(value: unknown): Language {
  const next = languageOf(typeof value === "string" ? value : null);
  if (next !== current) {
    current = next;
    listeners.forEach((fn) => fn());
  }
  return current;
}

export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
