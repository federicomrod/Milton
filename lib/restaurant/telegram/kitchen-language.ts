// lib/restaurant/telegram/kitchen-language.ts
//
// The language of the cook-facing Telegram replies (es / en / de).
//
// Replies are built in many modules (webhook, kitchen-media, kitchen-ai-handler,
// price-flow…). Rather than threading a `lang` argument through all of them,
// the webhook sets the language ONCE per update, as soon as the company of the
// cook is known, and KITCHEN_COPY (kitchen-copy.ts) reads it here. Node's
// AsyncLocalStorage keeps concurrent updates apart; Next's `after()` keeps the
// store for its callbacks. Outside any context the language is Spanish (the
// cockpit default), so tests and scripts behave as before.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

interface Store {
  lang: PreferredLanguage;
}

const storage = new AsyncLocalStorage<Store>();

/** The language replies are written in right now (Spanish when none is set). */
export function currentKitchenLanguage(): PreferredLanguage {
  return storage.getStore()?.lang ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
}

/** Sets the language for the rest of the current async flow (this update). */
export function setKitchenLanguage(lang: PreferredLanguage): void {
  storage.enterWith({ lang });
}

/** Runs `fn` with replies in `lang`. */
export function withKitchenLanguage<T>(
  lang: PreferredLanguage,
  fn: () => T
): T {
  return storage.run({ lang }, fn);
}

/**
 * Telegram's own `language_code` ("de", "en-GB", "es"…) for the moments when
 * no company is known yet (an invalid QR). Unknown codes -> Spanish.
 */
export function languageFromTelegramCode(
  code: string | null | undefined
): PreferredLanguage {
  const base = (code ?? "").toLowerCase().split("-")[0];
  if (base === "de") return "de";
  if (base === "en") return "en";
  return RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
}
