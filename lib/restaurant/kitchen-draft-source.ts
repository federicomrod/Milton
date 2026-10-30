// lib/restaurant/kitchen-draft-source.ts
//
// Source line for a recipe draft, from data already on the row. There is no
// filename column — file uploads use the «Archivo subido» sentinel.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { UPLOAD_AUTHOR_NAME } from "@/lib/restaurant/recipe-upload/constants";

export function draftSourceLabel(
  staffName: string | null | undefined,
  lang: PreferredLanguage = "es"
): string {
  const name = (staffName ?? "").trim();
  if (!name || name === UPLOAD_AUTHOR_NAME) {
    return lang === "es"
      ? UPLOAD_AUTHOR_NAME
      : t(lang, "Uploaded file", UPLOAD_AUTHOR_NAME, "Hochgeladene Datei");
  }
  return t(
    lang,
    `Voice note from ${name}`,
    `Nota de voz de ${name}`,
    `Sprachnachricht von ${name}`
  );
}

export function cookInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
