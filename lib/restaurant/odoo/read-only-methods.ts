// lib/restaurant/odoo/read-only-methods.ts
//
// Single allowlist for every Odoo model RPC. The client and scoped
// helpers both consult this set so a write or action can never slip
// through one layer. Do not add create/write/unlink/action_*.

export const ODOO_READ_ONLY_METHODS: ReadonlySet<string> = Object.freeze(
  new Set(["fields_get", "search_count", "search_read", "read"])
);

const WRITE_OR_ACTION_METHODS = new Set([
  "create",
  "write",
  "unlink",
  "copy",
  "name_create",
  "action_archive",
  "action_confirm",
  "toggle_active",
  "button_validate",
  "execute",
  "call",
]);

export function isOdooReadOnlyMethod(method: string): boolean {
  return ODOO_READ_ONLY_METHODS.has(method);
}

/** Pure. Throws when `method` is not on the read-only allowlist. */
export function assertOdooReadOnlyMethod(method: string): void {
  if (ODOO_READ_ONLY_METHODS.has(method)) return;
  if (WRITE_OR_ACTION_METHODS.has(method) || method.startsWith("action_")) {
    throw new Error("write methods are not permitted");
  }
  throw new Error(`Odoo method not permitted: ${method}`);
}
