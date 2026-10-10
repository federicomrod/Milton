// lib/restaurant/odoo/sync-error.ts
//
// Plain-language errors for the Sync now panel. Never forward raw Odoo
// fault text, XML-RPC dumps, or `details` from the API.

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
