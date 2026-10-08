// lib/restaurant/odoo/scoped.ts
//
// THE central choke point for Odoo model RPCs.
//
// INVARIANT: no Odoo RPC Milton makes can return or change records outside
// the Odoo company IDs (res.company) selected for the calling Milton
// company. This module enforces that in two independent ways on every call:
//
//   1. a company_id domain filter prepended to the caller's domain, and
//   2. context.allowed_company_ids set to the selected IDs.
//
// If no Odoo company is selected, the call is refused BEFORE any network
// I/O (OdooCompanyScopeError). It never falls back to "all companies" or
// to "whatever the Odoo user's default company is". After each fetch,
// callers re-check every returned record with assertRecordsInScope().
//
// Only this module may import unsafeExecuteKw from ./client (a content
// test enforces it). Models must be registered in ODOO_MODEL_COMPANY_POLICY
// — adding one is a deliberate, reviewed edit. Only search_read and
// search_count are permitted; Milton makes no writes to Odoo.
//
// Design brief: "Odoo multi-company isolation" (r1-pilot).

import { unsafeExecuteKw, OdooRpcError, type OdooCredentials } from "./client";
import type { XmlRpcValue } from "./xmlrpc";

export interface OdooScope {
  /** Validated, non-empty positive integers (Odoo res.company IDs). */
  companyIds: number[];
}

export class OdooCompanyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooCompanyScopeError";
  }
}

export type OdooCompanyPolicy =
  | "strict" // required company_id: ["company_id","in",ids]
  | "shared_or_company" // optional company_id, false = shared across companies
  | "no_company_field" // model has no company_id: context only
  | "self"; // res.company: ["id","in",ids]

/**
 * Frozen model registry. A model not listed here is rejected. In Odoo
 * 17/18 pos.order.line.company_id is a stored related field of
 * order_id.company_id (confirm with fields_get — design brief §8.6).
 * "shared_or_company" and "no_company_field" are defined and tested but
 * intentionally have no registered models yet.
 */
export const ODOO_MODEL_COMPANY_POLICY: Readonly<
  Record<string, OdooCompanyPolicy>
> = Object.freeze({
  "pos.order": "strict",
  "pos.order.line": "strict",
  "pos.config": "strict",
  "res.company": "self",
});

const ALLOWED_METHODS = new Set(["search_read", "search_count"]);
const WRITE_METHODS = new Set([
  "create",
  "write",
  "unlink",
  "copy",
  "name_create",
  "action_archive",
  "toggle_active",
]);
const FORBIDDEN_CONTEXT_KEYS = [
  "allowed_company_ids",
  "company_id",
  "force_company",
];

/** Pure — throws OdooCompanyScopeError on null/undefined/[]/non-positive/non-integer. */
export function assertOdooScope(ids: unknown): OdooScope {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new OdooCompanyScopeError(
      "No Odoo company is selected for this Milton account"
    );
  }
  for (const id of ids) {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id <= 0 ||
      id >= 2 ** 31
    ) {
      throw new OdooCompanyScopeError(
        "Odoo company IDs must be positive integers"
      );
    }
  }
  return { companyIds: Array.from(new Set(ids as number[])) };
}

/**
 * Pure. Returns the scoped args + kwargs for an Odoo model call. Directly
 * unit-testable without fetch. Throws OdooCompanyScopeError on any policy
 * violation; performs no I/O.
 */
export function buildScopedCall(
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs: Record<string, XmlRpcValue> | undefined,
  scope: OdooScope | null | undefined,
  registry: Readonly<
    Record<string, OdooCompanyPolicy>
  > = ODOO_MODEL_COMPANY_POLICY
): { args: XmlRpcValue[]; kwargs: Record<string, XmlRpcValue> } {
  // 1. Fail closed before anything else.
  const { companyIds } = assertOdooScope(scope?.companyIds);

  // 2. Method allowlist.
  if (!ALLOWED_METHODS.has(method)) {
    if (WRITE_METHODS.has(method)) {
      throw new OdooCompanyScopeError("write methods are not permitted");
    }
    if (method === "read") {
      throw new OdooCompanyScopeError(
        'read() has no domain and is not permitted; use search_read with [["id","in",ids]]'
      );
    }
    throw new OdooCompanyScopeError(`Odoo method not permitted: ${method}`);
  }

  // 3. Model registry.
  const policy = Object.prototype.hasOwnProperty.call(registry, model)
    ? registry[model]
    : undefined;
  if (!policy) {
    throw new OdooCompanyScopeError(
      `Odoo model not registered for scoped access: ${model}`
    );
  }

  // 4. Caller context must not try to set company scoping itself.
  const callerKwargs = kwargs ?? {};
  const callerContext = callerKwargs.context;
  if (callerContext !== undefined) {
    if (
      callerContext === null ||
      typeof callerContext !== "object" ||
      Array.isArray(callerContext)
    ) {
      throw new OdooCompanyScopeError("context must be an object");
    }
    for (const key of FORBIDDEN_CONTEXT_KEYS) {
      if (key in callerContext) {
        throw new OdooCompanyScopeError(
          `caller-supplied context.${key} is not permitted`
        );
      }
    }
  }

  // 5. Domain injection (prepended: Odoo ANDs top-level terms, so this is
  // correct even when the caller's own domain starts with "|" or "!").
  const callerDomain = args.length > 0 ? args[0] : [];
  if (!Array.isArray(callerDomain)) {
    throw new OdooCompanyScopeError("args[0] must be a domain array");
  }
  const idsValue: XmlRpcValue = [...companyIds];
  let prefix: XmlRpcValue[];
  switch (policy) {
    case "strict":
      prefix = [["company_id", "in", idsValue]];
      break;
    case "shared_or_company":
      prefix = [
        "|",
        ["company_id", "=", false],
        ["company_id", "in", idsValue],
      ];
      break;
    case "self":
      prefix = [["id", "in", idsValue]];
      break;
    case "no_company_field":
      prefix = [];
      break;
  }
  const scopedArgs: XmlRpcValue[] = [
    [...prefix, ...callerDomain],
    ...args.slice(1),
  ];

  // 6. Context injection + always fetch company_id for post-fetch checks.
  const scopedKwargs: Record<string, XmlRpcValue> = {
    ...callerKwargs,
    context: {
      ...((callerContext as Record<string, XmlRpcValue> | undefined) ?? {}),
      allowed_company_ids: [...companyIds],
    },
  };
  if (
    method === "search_read" &&
    (policy === "strict" || policy === "shared_or_company") &&
    Array.isArray(callerKwargs.fields) &&
    !callerKwargs.fields.includes("company_id")
  ) {
    scopedKwargs.fields = [...callerKwargs.fields, "company_id"];
  }

  return { args: scopedArgs, kwargs: scopedKwargs };
}

/**
 * The ONLY function any route/lib may use to call an Odoo model.
 * Throws OdooCompanyScopeError (and never touches the network) when the
 * scope or the call itself violates policy.
 */
export async function scopedExecuteKw(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope | null | undefined,
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs?: Record<string, XmlRpcValue>
): Promise<XmlRpcValue> {
  const built = buildScopedCall(model, method, args, kwargs, scope);
  return unsafeExecuteKw(creds, uid, model, method, built.args, built.kwargs);
}

/**
 * Pure post-fetch guard (defense in depth, mirrors secretBelongsToCompany).
 * Throws on any foreign or missing company_id; the whole operation must
 * abort (no partial upsert). Logs only model, record id and the offending
 * company id — never credentials or record payloads.
 */
export function assertRecordsInScope(
  model: string,
  records: unknown,
  scope: OdooScope | null | undefined,
  registry: Readonly<
    Record<string, OdooCompanyPolicy>
  > = ODOO_MODEL_COMPANY_POLICY
): void {
  const { companyIds } = assertOdooScope(scope?.companyIds);
  const policy = Object.prototype.hasOwnProperty.call(registry, model)
    ? registry[model]
    : undefined;
  if (!policy) {
    throw new OdooCompanyScopeError(
      `Odoo model not registered for scoped access: ${model}`
    );
  }
  if (!Array.isArray(records)) {
    throw new OdooCompanyScopeError("Odoo returned a non-list result");
  }
  if (policy === "no_company_field") return;

  const allowed = new Set(companyIds);
  for (const rec of records as Record<string, unknown>[]) {
    const recId = rec && typeof rec === "object" ? rec.id : undefined;
    let offending: unknown;
    let ok = false;
    if (!rec || typeof rec !== "object") {
      ok = false;
    } else if (policy === "self") {
      offending = rec.id;
      ok = typeof rec.id === "number" && allowed.has(rec.id);
    } else {
      const cid = rec.company_id;
      offending = Array.isArray(cid) ? cid[0] : cid;
      if (Array.isArray(cid)) {
        ok = typeof cid[0] === "number" && allowed.has(cid[0]);
      } else if (cid === false) {
        ok = policy === "shared_or_company";
      }
    }
    if (!ok) {
      console.error(
        `[Odoo Scope] record outside selected companies: model=${model} id=${String(recId)} company=${String(offending)}`
      );
      throw new OdooCompanyScopeError(
        "Odoo returned records outside the selected companies"
      );
    }
  }
}

export interface OdooCompanyDiscovery {
  defaultCompanyId: number;
  companies: { id: number; name: string }[];
}

/**
 * Bootstrap discovery — the single documented pre-scope call path. No
 * selection exists yet when this runs, so it cannot use scopedExecuteKw.
 * It makes exactly two calls and nothing else may use unsafeExecuteKw
 * this way:
 *   1. res.users [["id","=",uid]] -> company_id, company_ids
 *   2. res.company [["id","in",user.company_ids]] -> id, name, with
 *      context.allowed_company_ids = user.company_ids
 * Returns only what the integration user can access, sorted by name.
 */
export async function discoverOdooCompanies(
  creds: OdooCredentials,
  uid: number
): Promise<OdooCompanyDiscovery> {
  const users = await unsafeExecuteKw(
    creds,
    uid,
    "res.users",
    "search_read",
    [[["id", "=", uid]]],
    { fields: ["company_id", "company_ids"] }
  );
  const user = Array.isArray(users)
    ? (users[0] as Record<string, unknown> | undefined)
    : undefined;
  const accessibleIds = user?.company_ids;
  if (
    !user ||
    !Array.isArray(accessibleIds) ||
    !accessibleIds.every((n) => typeof n === "number")
  ) {
    throw new OdooRpcError("Unexpected res.users response from Odoo", "shape");
  }
  const ids = accessibleIds as number[];
  const def = Array.isArray(user.company_id) ? user.company_id[0] : null;
  if (ids.length === 0) {
    return {
      defaultCompanyId: typeof def === "number" ? def : 0,
      companies: [],
    };
  }

  const rows = await unsafeExecuteKw(
    creds,
    uid,
    "res.company",
    "search_read",
    [[["id", "in", ids]]],
    { fields: ["id", "name"], context: { allowed_company_ids: ids } }
  );
  if (!Array.isArray(rows)) {
    throw new OdooRpcError(
      "Unexpected res.company response from Odoo",
      "shape"
    );
  }
  const companies = (rows as Record<string, unknown>[])
    // Defense in depth: never surface a company outside the user's list.
    .filter((r) => typeof r.id === "number" && ids.includes(r.id))
    .map((r) => ({ id: r.id as number, name: String(r.name ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return {
    defaultCompanyId: typeof def === "number" ? def : (companies[0]?.id ?? 0),
    companies,
  };
}
