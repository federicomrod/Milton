// lib/restaurant/odoo/sync-error.ts
//
// Plain-language errors for the Sync now panel. Never forward raw Odoo
// fault text, XML-RPC dumps, or `details` from the API.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";

const KNOWN_ERROR_CODES: Record<string, string> = {
  odoo_location_mapping_required:
    "Map every selected Odoo company to a Milton location before syncing.",
  odoo_company_selection_required:
    "Choose which Odoo companies this workspace should sync, then try again.",
  odoo_company_selection_invalid:
    "The selected Odoo companies are no longer available. Re-select them in the company list.",
};

const ODOO_FAULT_RE =
  /access denied|traceback|xmlrpc|faultcode|fault string|uid \d+|odoo\.exceptions|warning --/i;

export function looksLikeOdooFault(text: string): boolean {
  return ODOO_FAULT_RE.test(text);
}

function readString(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function safePlain(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || looksLikeOdooFault(trimmed)) return null;
  return trimmed;
}

export function safeSyncErrorMessage(status: number, body: unknown): string {
  const error = readString(body, "error");
  const message = readString(body, "message");

  if (error && KNOWN_ERROR_CODES[error]) return KNOWN_ERROR_CODES[error];

  if (status === 401) {
    return "Could not sign in to Odoo. Check the connection and API key.";
  }
  if (status === 403) {
    return "You need admin access to sync Odoo sales.";
  }
  if (status === 404) {
    if (/credential/i.test(error) || /credential/i.test(message)) {
      return "This workspace is missing an Odoo API key. Save the connection first.";
    }
    if (/connection/i.test(error) || /connection/i.test(message)) {
      return "No Odoo connection is set up for this workspace.";
    }
    return "Odoo is not fully set up for this workspace.";
  }
  if (status === 400) {
    return (
      safePlain(message) ??
      safePlain(error) ??
      "Check the date range. Use YYYY-MM-DD and stay within 92 days."
    );
  }
  if (status === 409) {
    return (
      safePlain(message) ??
      "Odoo sync is not ready. Finish company selection and location mapping."
    );
  }
  if (status === 502) {
    return "Could not reach Odoo. Try again in a few minutes.";
  }
  if (status === 0) {
    return "Network error. Check your connection and try again.";
  }
  return "Sync failed. Try again. If it keeps happening, check the Odoo connection.";
}

const EN_TO_ES: Array<[RegExp | string, string]> = [
  [
    "Check the date range. Use YYYY-MM-DD and stay within 92 days.",
    "Revisa el rango de fechas. Usa AAAA-MM-DD y no pases de 92 días.",
  ],
  [
    /capped at 92|spans \d+ days|92 days/i,
    "Ese rango supera los 92 días. Elige un periodo más corto.",
  ],
  [
    /start_date and end_date are required/i,
    "Escribe una fecha de inicio y una de fin.",
  ],
  [
    /start_date must be on or before/i,
    "La fecha de inicio debe ser anterior o igual a la fecha de fin.",
  ],
  [
    "Could not sign in to Odoo. Check the connection and API key.",
    "No se pudo entrar a Odoo. Revisa la conexión y la clave.",
  ],
  [
    "You need admin access to sync Odoo sales.",
    "Necesitas ser administrador para sincronizar las ventas.",
  ],
  [
    "This workspace is missing an Odoo API key. Save the connection first.",
    "Falta la clave de Odoo. Guarda la conexión primero.",
  ],
  [
    "No Odoo connection is set up for this workspace.",
    "Este espacio aún no tiene una conexión a Odoo.",
  ],
  [
    "Odoo is not fully set up for this workspace.",
    "Odoo aún no está listo en este espacio.",
  ],
  [
    "Odoo sync is not ready. Finish company selection and location mapping.",
    "La sincronización de Odoo no está lista. Termina de elegir empresas y mapear ubicaciones.",
  ],
  [
    "Could not reach Odoo. Try again in a few minutes.",
    "No se pudo conectar con Odoo. Inténtalo en unos minutos.",
  ],
  [
    "Network error. Check your connection and try again.",
    "Error de red. Revisa tu conexión e inténtalo de nuevo.",
  ],
  [
    "Sync failed. Try again. If it keeps happening, check the Odoo connection.",
    "No se pudo sincronizar. Inténtalo de nuevo. Si sigue pasando, revisa la conexión a Odoo.",
  ],
  [
    "Map every selected Odoo company to a Milton location before syncing.",
    "Mapea cada empresa de Odoo a una ubicación de Milton antes de sincronizar.",
  ],
  [
    "Choose which Odoo companies this workspace should sync, then try again.",
    "Elige qué empresas de Odoo debe sincronizar este espacio e inténtalo de nuevo.",
  ],
  [
    "The selected Odoo companies are no longer available. Re-select them in the company list.",
    "Las empresas de Odoo que elegiste ya no están disponibles. Vuelve a seleccionarlas.",
  ],
];

const EN_TO_DE: Array<[RegExp | string, string]> = [
  [
    "Check the date range. Use YYYY-MM-DD and stay within 92 days.",
    "Prüfen Sie den Zeitraum. Verwenden Sie JJJJ-MM-TT und höchstens 92 Tage.",
  ],
  [
    /capped at 92|spans \d+ days|92 days/i,
    "Dieser Zeitraum umfasst mehr als 92 Tage. Wählen Sie einen kürzeren Zeitraum.",
  ],
  [
    /start_date and end_date are required/i,
    "Geben Sie ein Start- und ein Enddatum ein.",
  ],
  [
    /start_date must be on or before/i,
    "Das Startdatum muss vor dem Enddatum liegen oder mit ihm übereinstimmen.",
  ],
  [
    "Could not sign in to Odoo. Check the connection and API key.",
    "Die Anmeldung bei Odoo ist fehlgeschlagen. Prüfen Sie die Verbindung und den API-Schlüssel.",
  ],
  [
    "You need admin access to sync Odoo sales.",
    "Zum Synchronisieren der Umsätze benötigen Sie Administratorrechte.",
  ],
  [
    "This workspace is missing an Odoo API key. Save the connection first.",
    "Der Odoo-API-Schlüssel fehlt. Speichern Sie zuerst die Verbindung.",
  ],
  [
    "No Odoo connection is set up for this workspace.",
    "Für diesen Arbeitsbereich ist noch keine Odoo-Verbindung eingerichtet.",
  ],
  [
    "Odoo is not fully set up for this workspace.",
    "Odoo ist für diesen Arbeitsbereich noch nicht vollständig eingerichtet.",
  ],
  [
    "Odoo sync is not ready. Finish company selection and location mapping.",
    "Die Odoo-Synchronisierung ist noch nicht bereit. Schließen Sie die Auswahl der Unternehmen und die Zuordnung der Standorte ab.",
  ],
  [
    "Could not reach Odoo. Try again in a few minutes.",
    "Odoo ist nicht erreichbar. Versuchen Sie es in einigen Minuten erneut.",
  ],
  [
    "Network error. Check your connection and try again.",
    "Netzwerkfehler. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  ],
  [
    "Sync failed. Try again. If it keeps happening, check the Odoo connection.",
    "Die Synchronisierung ist fehlgeschlagen. Versuchen Sie es erneut. Besteht das Problem weiterhin, prüfen Sie die Odoo-Verbindung.",
  ],
  [
    "Map every selected Odoo company to a Milton location before syncing.",
    "Ordnen Sie vor der Synchronisierung jedes ausgewählte Odoo-Unternehmen einem Milton-Standort zu.",
  ],
  [
    "Choose which Odoo companies this workspace should sync, then try again.",
    "Wählen Sie, welche Odoo-Unternehmen dieser Arbeitsbereich synchronisieren soll, und versuchen Sie es erneut.",
  ],
  [
    "The selected Odoo companies are no longer available. Re-select them in the company list.",
    "Die ausgewählten Odoo-Unternehmen sind nicht mehr verfügbar. Wählen Sie sie in der Unternehmensliste erneut aus.",
  ],
];

export function localizeSyncError(
  lang: PreferredLanguage,
  english: string
): string {
  if (lang === "en") return english;
  const table = lang === "de" ? EN_TO_DE : EN_TO_ES;
  for (const [match, es] of table) {
    if (typeof match === "string") {
      if (english === match || english.includes(match)) return es;
    } else if (match.test(english)) {
      return es;
    }
  }
  return english;
}

export function safeSyncErrorMessageForLang(
  lang: PreferredLanguage,
  status: number,
  body: unknown
): string {
  return localizeSyncError(lang, safeSyncErrorMessage(status, body));
}

export function localizedRangeParseError(
  lang: PreferredLanguage,
  error: string
): string {
  return localizeSyncError(
    lang,
    error.includes("capped") || error.includes("92")
      ? "Check the date range. Use YYYY-MM-DD and stay within 92 days."
      : error
  );
}

export function rangeRequiredCopy(lang: PreferredLanguage): string {
  return t(
    lang,
    "Enter a start and end date.",
    "Escribe una fecha de inicio y una de fin.",
    "Geben Sie ein Start- und ein Enddatum ein."
  );
}
