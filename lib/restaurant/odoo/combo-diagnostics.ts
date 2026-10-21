// lib/restaurant/odoo/combo-diagnostics.ts
//
// Read-only Odoo combo / attribute inspection for GET
// /api/restaurant/pos/odoo-combo-diagnostics. Uses the scoped RPC + the
// read-only method allowlist (fields_get, search_count, search_read, read).
// Missing combo fields (older Odoo) become notes, never a hard failure.

import { can, type Actor } from "@/lib/auth/capabilities";
import { getOdooVersion, type OdooCredentials } from "./client";
import { many2oneId, many2oneName, pickPresentFields } from "./dimensions";
import { assertOdooReadOnlyMethod } from "./read-only-methods";
import {
  assertRecordsInScope,
  OdooCompanyScopeError,
  scopedExecuteKw,
  type OdooScope,
} from "./scoped";
import type { XmlRpcValue } from "./xmlrpc";

export const COMBO_LINE_FLAG_FIELDS = [
  "combo_parent_id",
  "combo_line_ids",
  "combo_item_id",
  "attribute_value_ids",
] as const;

const LINE_PRICE_FIELDS = [
  "id",
  "full_product_name",
  "qty",
  "price_unit",
  "price_subtotal_incl",
  "company_id",
] as const;

const CUSTOM_ATTRIBUTE_NAME_RE = /attribute|modifier/i;

/** Owner, admin and Milton staff (capability odoo.diagnostics). */
export function canAccessOdooComboDiagnostics(actor: Actor): boolean {
  return can(actor, "odoo.diagnostics");
}

export interface ComboLineFieldFlags {
  combo_parent_id: boolean;
  combo_line_ids: boolean;
  combo_item_id: boolean;
  attribute_value_ids: boolean;
  custom_attribute_fields: {
    name: string;
    type: string | null;
    label: string | null;
  }[];
}

export interface ComboDiagnosticLine {
  id: number;
  full_product_name: string | null;
  qty: number | null;
  price_unit: number | null;
  price_subtotal_incl: number | null;
  company_id: { id: number; name: string | null } | null;
  combo_parent_id?: number | null;
  attribute_value_ids?: unknown;
  custom_attribute_values?: Record<string, unknown>;
}

export interface ComboChildLine extends ComboDiagnosticLine {
  parent: ComboDiagnosticLine | null;
}

export interface OdooServerVersionInfo {
  server_version: string | null;
  server_serie: string | null;
  protocol_version: number | null;
}

export interface OdooComboDiagnosticsReport {
  generated_at: string;
  selected_company_ids: number[];
  server_version: OdooServerVersionInfo | null;
  pos_order_line_fields: ComboLineFieldFlags;
  combo_products: {
    available: boolean;
    count: number | null;
    names: string[];
  };
  combo_child_lines: ComboChildLine[];
  attribute_or_modifier_lines: ComboDiagnosticLine[];
  notes: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function companyRef(
  value: unknown
): { id: number; name: string | null } | null {
  const id = many2oneId(value);
  if (id === null) return null;
  return { id, name: many2oneName(value) };
}

export function sanitizeOdooServerVersion(
  raw: unknown
): OdooServerVersionInfo | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const server_version = asString(rec.server_version);
  const server_serie = asString(rec.server_serie);
  const protocol_version = asNumber(rec.protocol_version);
  if (
    server_version === null &&
    server_serie === null &&
    protocol_version === null
  ) {
    return null;
  }
  return { server_version, server_serie, protocol_version };
}

export function inspectPosOrderLineFields(
  fieldsGet: unknown
): ComboLineFieldFlags {
  const raw = asRecord(fieldsGet) ?? {};
  const custom: ComboLineFieldFlags["custom_attribute_fields"] = [];
  for (const [name, meta] of Object.entries(raw)) {
    if ((COMBO_LINE_FLAG_FIELDS as readonly string[]).includes(name)) continue;
    if (!CUSTOM_ATTRIBUTE_NAME_RE.test(name)) continue;
    const info = asRecord(meta) ?? {};
    custom.push({
      name,
      type: asString(info.type),
      label: asString(info.string),
    });
  }
  custom.sort((a, b) => a.name.localeCompare(b.name));
  return {
    combo_parent_id: "combo_parent_id" in raw,
    combo_line_ids: "combo_line_ids" in raw,
    combo_item_id: "combo_item_id" in raw,
    attribute_value_ids: "attribute_value_ids" in raw,
    custom_attribute_fields: custom,
  };
}

export function sanitizeDiagnosticLine(
  raw: unknown,
  extraFields: readonly string[] = []
): ComboDiagnosticLine | null {
  const rec = asRecord(raw);
  const id = rec ? asNumber(rec.id) : null;
  if (!rec || id === null) return null;
  const line: ComboDiagnosticLine = {
    id,
    full_product_name: asString(rec.full_product_name),
    qty: asNumber(rec.qty),
    price_unit: asNumber(rec.price_unit),
    price_subtotal_incl: asNumber(rec.price_subtotal_incl),
    company_id: companyRef(rec.company_id),
  };
  if (extraFields.includes("combo_parent_id")) {
    line.combo_parent_id = many2oneId(rec.combo_parent_id);
  }
  if (extraFields.includes("attribute_value_ids")) {
    line.attribute_value_ids = rec.attribute_value_ids ?? null;
  }
  const customValues: Record<string, unknown> = {};
  for (const field of extraFields) {
    if (
      field === "combo_parent_id" ||
      field === "attribute_value_ids" ||
      (LINE_PRICE_FIELDS as readonly string[]).includes(field)
    ) {
      continue;
    }
    if (field in rec) customValues[field] = rec[field];
  }
  if (Object.keys(customValues).length > 0) {
    line.custom_attribute_values = customValues;
  }
  return line;
}

async function diagnosticCall(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs?: Record<string, XmlRpcValue>
): Promise<XmlRpcValue> {
  assertOdooReadOnlyMethod(method);
  const result = await scopedExecuteKw(
    creds,
    uid,
    scope,
    model,
    method,
    args,
    kwargs
  );
  if (method === "search_read" || method === "read") {
    assertRecordsInScope(model, result, scope);
  }
  return result;
}

async function tryDiagnosticCall(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  model: string,
  method: string,
  args: XmlRpcValue[],
  kwargs: Record<string, XmlRpcValue> | undefined,
  notes: string[],
  note: string
): Promise<XmlRpcValue | null> {
  try {
    return await diagnosticCall(creds, uid, scope, model, method, args, kwargs);
  } catch (err) {
    if (err instanceof OdooCompanyScopeError) {
      throw err;
    }
    notes.push(note);
    return null;
  }
}

function emptyFieldFlags(): ComboLineFieldFlags {
  return {
    combo_parent_id: false,
    combo_line_ids: false,
    combo_item_id: false,
    attribute_value_ids: false,
    custom_attribute_fields: [],
  };
}

export async function collectOdooComboDiagnostics(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  now: Date = new Date()
): Promise<OdooComboDiagnosticsReport> {
  const notes: string[] = [];

  let server_version: OdooServerVersionInfo | null = null;
  try {
    server_version = sanitizeOdooServerVersion(await getOdooVersion(creds));
  } catch {
    notes.push("Odoo server version is unavailable");
  }

  const fieldsRaw = await tryDiagnosticCall(
    creds,
    uid,
    scope,
    "pos.order.line",
    "fields_get",
    [],
    { attributes: ["string", "type"] },
    notes,
    "pos.order.line fields_get failed; combo and attribute fields were not inspected"
  );
  const lineFields = fieldsRaw
    ? inspectPosOrderLineFields(fieldsRaw)
    : emptyFieldFlags();
  const availableLineFields = fieldsRaw
    ? new Set(Object.keys(asRecord(fieldsRaw) ?? {}))
    : new Set<string>();

  const comboProducts = await loadComboProducts(creds, uid, scope, notes);
  const comboChildLines = await loadComboChildLines(
    creds,
    uid,
    scope,
    availableLineFields,
    lineFields,
    notes
  );
  const attributeLines = await loadAttributeOrModifierLines(
    creds,
    uid,
    scope,
    availableLineFields,
    lineFields,
    notes
  );

  return {
    generated_at: now.toISOString(),
    selected_company_ids: [...scope.companyIds],
    server_version,
    pos_order_line_fields: lineFields,
    combo_products: comboProducts,
    combo_child_lines: comboChildLines,
    attribute_or_modifier_lines: attributeLines,
    notes,
  };
}

async function loadComboProducts(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  notes: string[]
): Promise<OdooComboDiagnosticsReport["combo_products"]> {
  const countRaw = await tryDiagnosticCall(
    creds,
    uid,
    scope,
    "product.product",
    "search_count",
    [[["type", "=", "combo"]]],
    undefined,
    notes,
    "product.product type='combo' is not available on this Odoo version"
  );
  if (countRaw === null) {
    return { available: false, count: null, names: [] };
  }
  const count = asNumber(countRaw) ?? 0;
  const rowsRaw = await tryDiagnosticCall(
    creds,
    uid,
    scope,
    "product.product",
    "search_read",
    [[["type", "=", "combo"]]],
    { fields: ["id", "name"], limit: 30, order: "id desc" },
    notes,
    "Could not list product.product combo names"
  );
  const names: string[] = [];
  if (Array.isArray(rowsRaw)) {
    for (const row of rowsRaw) {
      const rec = asRecord(row);
      const name = rec ? asString(rec.name) : null;
      if (name) names.push(name);
      if (names.length >= 30) break;
    }
  }
  return { available: true, count, names };
}

async function loadComboChildLines(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  available: Set<string>,
  flags: ComboLineFieldFlags,
  notes: string[]
): Promise<ComboChildLine[]> {
  if (!flags.combo_parent_id) {
    notes.push(
      "pos.order.line.combo_parent_id is not present on this Odoo version"
    );
    return [];
  }
  const fields = pickPresentFields(available, [
    ...LINE_PRICE_FIELDS,
    "combo_parent_id",
  ]);
  const rowsRaw = await tryDiagnosticCall(
    creds,
    uid,
    scope,
    "pos.order.line",
    "search_read",
    [[["combo_parent_id", "!=", false]]],
    { fields, limit: 20, order: "id desc" },
    notes,
    "Could not read recent combo child lines"
  );
  if (!Array.isArray(rowsRaw)) return [];

  const children: ComboDiagnosticLine[] = [];
  const parentIds: number[] = [];
  for (const row of rowsRaw) {
    const line = sanitizeDiagnosticLine(row, ["combo_parent_id"]);
    if (!line) continue;
    children.push(line);
    if (typeof line.combo_parent_id === "number") {
      parentIds.push(line.combo_parent_id);
    }
  }

  const parentsById = new Map<number, ComboDiagnosticLine>();
  const uniqueParentIds = [...new Set(parentIds)];
  if (uniqueParentIds.length > 0) {
    const parentFields = pickPresentFields(available, [...LINE_PRICE_FIELDS]);
    const parentsRaw = await tryDiagnosticCall(
      creds,
      uid,
      scope,
      "pos.order.line",
      "read",
      [uniqueParentIds],
      { fields: parentFields },
      notes,
      "Could not read combo parent lines"
    );
    if (Array.isArray(parentsRaw)) {
      for (const row of parentsRaw) {
        const parent = sanitizeDiagnosticLine(row);
        if (parent) parentsById.set(parent.id, parent);
      }
    }
  }

  return children.map((child) => ({
    ...child,
    parent:
      typeof child.combo_parent_id === "number"
        ? (parentsById.get(child.combo_parent_id) ?? null)
        : null,
  }));
}

async function loadAttributeOrModifierLines(
  creds: OdooCredentials,
  uid: number,
  scope: OdooScope,
  available: Set<string>,
  flags: ComboLineFieldFlags,
  notes: string[]
): Promise<ComboDiagnosticLine[]> {
  const extra = [
    ...(flags.attribute_value_ids ? ["attribute_value_ids"] : []),
    ...flags.custom_attribute_fields.map((f) => f.name),
  ].filter((name) => available.has(name));
  if (extra.length === 0) {
    notes.push("No attribute or modifier fields are present on pos.order.line");
    return [];
  }

  const fields = pickPresentFields(available, [...LINE_PRICE_FIELDS, ...extra]);
  const rowsRaw = await tryDiagnosticCall(
    creds,
    uid,
    scope,
    "pos.order.line",
    "search_read",
    [buildAnySetDomain(extra)],
    { fields, limit: 20, order: "id desc" },
    notes,
    "Could not read recent attribute or modifier lines"
  );
  if (!Array.isArray(rowsRaw)) return [];

  const lines: ComboDiagnosticLine[] = [];
  for (const row of rowsRaw) {
    const line = sanitizeDiagnosticLine(row, extra);
    if (line) lines.push(line);
  }
  return lines;
}

/** Odoo prefix-OR: ["|", "|", a, b, c] means a OR b OR c. */
export function buildAnySetDomain(fields: string[]): XmlRpcValue[] {
  if (fields.length === 0) return [];
  if (fields.length === 1) return [[fields[0], "!=", false]];
  const terms: XmlRpcValue[] = [];
  for (let i = 0; i < fields.length - 1; i++) terms.push("|");
  for (const field of fields) terms.push([field, "!=", false]);
  return terms;
}
