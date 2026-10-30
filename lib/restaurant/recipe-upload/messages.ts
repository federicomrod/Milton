// lib/restaurant/recipe-upload/messages.ts
//
// The texts «Sube tus recetas» shows when a file cannot be read, in the
// person's language. The exported *_MESSAGE constants elsewhere stay Spanish
// (the default) and are built from this same dictionary.

import { fmt, getDictionary, type Dictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export type UploadMsgKey = keyof Dictionary["menu"]["groups"]["upload"];

export function uploadMsg(
  lang: PreferredLanguage,
  key: UploadMsgKey,
  vars: Record<string, string | number> = {}
): string {
  return fmt(getDictionary(lang).menu.groups.upload[key], vars);
}
