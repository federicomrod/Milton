// lib/restaurant/telegram/connections.ts
//
// Pure guard for restaurant_telegram_connections rows — no I/O, directly
// unit-testable. Mirrors lib/restaurant/odoo/secrets.ts's
// secretBelongsToCompany(): defense in depth on top of the query-level
// `.eq("company_id", companyId)` filter already used by every caller, so
// a fetched connection row is only ever trusted when it is genuinely this
// company's own, active connection.

export interface TelegramConnectionRow {
  company_id: string;
  chat_id: number;
  is_active: boolean;
}

export function isUsableConnection(
  connection: TelegramConnectionRow | null | undefined,
  companyId: string
): connection is TelegramConnectionRow {
  return (
    !!connection && connection.company_id === companyId && connection.is_active
  );
}
