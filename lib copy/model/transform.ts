

/**
 * Shared model transform utilities for Milton Data Model Builder & Visualizer.
 *
 * This module is intentionally framework-agnostic:
 * - It does NOT import React or React Flow types.
 * - It exposes generic Node/Edge shapes that builder/visualizer components can adapt.
 *
 * Safe to use in both server and client contexts.
 */

///////////////////////
// Types
///////////////////////

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'currency'
  | 'text'
  | 'json'
  | 'uuid'
  | 'fk' // used for inferred FK fields
  | string;

export interface FieldDef {
  name: string;
  type?: FieldType;
  // optional metadata (nullable, pk, etc.)
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  // if this is a foreign key field, capture the target
  references?: { table: string; field?: string } | null;
}

export interface TableDef {
  name: string;
  fields: FieldDef[];
  // optional: file linkage metadata for ingestion
  fileMapping?: {
    fileName?: string;
    // map incoming column -> field name
    columnMap?: Record<string, string>;
  };
}

export interface RelationshipDef {
  from: string; // e.g., "Bookings.CoachID"
  to: string;   // e.g., "Coaches.ID"
  // optional constraint name or type
  type?: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many' | string;
}

export interface ModelProposal {
  businessType?: string;
  recommendedTables: TableDef[];
  relationships: RelationshipDef[];
  // optional opaque metadata from the AI route
  meta?: Record<string, unknown>;
}

///////////////////////
// Graph primitives
///////////////////////

export interface GraphNode {
  id: string;
  label: string;
  table: string; // table name
  fields: FieldDef[];
  position?: { x: number; y: number }; // UI responsibility to lay out
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  // edge metadata for UI/semantics
  fromField?: string;
  toField?: string;
  rel?: RelationshipDef;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

///////////////////////
// Helpers
///////////////////////

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

const nodeIdForTable = (tableName: string) => `table:${slug(tableName)}`;

const parseEnd = (endpoint: string): { table: string; field?: string } => {
  // Accept forms like "Bookings.CoachID" or "Bookings"
  const [table, field] = endpoint.split('.');
  return { table: table?.trim() ?? '', field: field?.trim() };
};

///////////////////////
// Transform
///////////////////////

/**
 * Convert a ModelProposal into a simple graph (nodes/edges). Positions are not computed here.
 * Components should arrange nodes (e.g., with React Flow or a layout algorithm).
 */
export function proposalToGraph(
  proposal: ModelProposal,
  opts?: { includeFkFieldHints?: boolean }
): Graph {
  const includeFkHints = opts?.includeFkFieldHints ?? true;

  if (!proposal || !proposal.recommendedTables) {
    console.warn('⚠️ proposal.recommendedTables missing:', proposal);
    return { nodes: [], edges: [] };
  }

  const nodes: GraphNode[] = proposal.recommendedTables.map((t, i) => ({
    id: nodeIdForTable(t.name),
    label: t.name,
    table: t.name,
    fields: Array.isArray(t.fields) ? t.fields : [],
    // naive spread: stagger nodes so they don't overlap on first paint
    position: { x: 100 + (i % 4) * 260, y: 100 + Math.floor(i / 4) * 220 },
  }));

  const edges: GraphEdge[] = (proposal.relationships || []).map((r, idx) => {
    const from = parseEnd(r.from);
    const to = parseEnd(r.to);
    return {
      id: `rel:${idx}:${slug(r.from)}:${slug(r.to)}`,
      source: nodeIdForTable(from.table),
      target: nodeIdForTable(to.table),
      fromField: from.field,
      toField: to.field,
      rel: r,
    };
  });

  // Optionally add FK field hints if missing
  if (includeFkHints) {
    for (const e of edges) {
      if (!e.fromField || !e.toField) continue;
      const fromNode = nodes.find((n) => n.id === e.source);
      if (!fromNode) continue;
      const hasField = fromNode.fields.some((f) => f.name === e.fromField);
      if (!hasField) {
        fromNode.fields = [
          ...fromNode.fields,
          {
            name: e.fromField,
            type: 'fk',
            references: { table: (e.rel && parseEnd(e.rel.to).table) || e.target },
          },
        ];
      }
    }
  }

  return { nodes, edges };
}

///////////////////////
// Immutable Edits
///////////////////////

export function renameField(
  model: ModelProposal,
  tableName: string,
  oldName: string,
  newName: string
): ModelProposal {
  if (!newName || oldName === newName) return model;
  const tables = model.recommendedTables.map((t) => {
    if (t.name !== tableName) return t;
    const fields = t.fields.map((f) =>
      f.name === oldName ? { ...f, name: newName } : f
    );
    return { ...t, fields };
  });

  // Update relationships that referenced oldName
  const relationships = (model.relationships || []).map((r) => {
    const from = parseEnd(r.from);
    const to = parseEnd(r.to);
    const fromStr =
      from.table === tableName && from.field === oldName
        ? `${from.table}.${newName}`
        : r.from;
    const toStr =
      to.table === tableName && to.field === oldName
        ? `${to.table}.${newName}`
        : r.to;
    return { ...r, from: fromStr, to: toStr };
  });

  return { ...model, recommendedTables: tables, relationships };
}

export function addField(
  model: ModelProposal,
  tableName: string,
  field: FieldDef
): ModelProposal {
  const tables = model.recommendedTables.map((t) =>
    t.name === tableName ? { ...t, fields: [...t.fields, field] } : t
  );
  return { ...model, recommendedTables: tables };
}

export function removeField(
  model: ModelProposal,
  tableName: string,
  fieldName: string
): ModelProposal {
  const tables = model.recommendedTables.map((t) =>
    t.name === tableName ? { ...t, fields: t.fields.filter((f) => f.name !== fieldName) } : t
  );
  // Clean relationships that targeted the removed field
  const relationships = (model.relationships || []).filter((r) => {
    const from = parseEnd(r.from);
    const to = parseEnd(r.to);
    const hitsRemoved =
      (from.table === tableName && from.field === fieldName) ||
      (to.table === tableName && to.field === fieldName);
    return !hitsRemoved;
  });
  return { ...model, recommendedTables: tables, relationships };
}

export function addRelationship(
  model: ModelProposal,
  rel: RelationshipDef
): ModelProposal {
  const relationships = [...(model.relationships || []), rel];
  return { ...model, relationships };
}

export function removeRelationship(
  model: ModelProposal,
  predicate:
    | ((r: RelationshipDef) => boolean)
    | { from?: string; to?: string }
): ModelProposal {
  const relationships = (model.relationships || []).filter((r) => {
    if (typeof predicate === 'function') return !predicate(r);
    if (predicate.from && r.from !== predicate.from) return true;
    if (predicate.to && r.to !== predicate.to) return true;
    // if both match, drop
    if (
      (!predicate.from || r.from === predicate.from) &&
      (!predicate.to || r.to === predicate.to)
    ) {
      return false;
    }
    return true;
  });
  return { ...model, relationships };
}

export function upsertFileMapping(
  model: ModelProposal,
  tableName: string,
  mapping: NonNullable<TableDef['fileMapping']>
): ModelProposal {
  const tables = model.recommendedTables.map((t) => {
    if (t.name !== tableName) return t;
    const merged = {
      ...(t.fileMapping || {}),
      ...mapping,
      columnMap: { ...(t.fileMapping?.columnMap || {}), ...(mapping.columnMap || {}) },
    };
    return { ...t, fileMapping: merged };
  });
  return { ...model, recommendedTables: tables };
}

///////////////////////
// Validation helpers
///////////////////////

export function validateProposal(model: ModelProposal): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  if (!model || !Array.isArray(model.recommendedTables)) {
    issues.push('Missing or invalid recommendedTables.');
  } else {
    for (const t of model.recommendedTables) {
      if (!t.name) issues.push('Table missing name.');
      if (!Array.isArray(t.fields)) issues.push(`Table "${t.name}" has invalid fields array.`);
    }
  }

  if (!Array.isArray(model.relationships)) {
    issues.push('Missing or invalid relationships array.');
  } else {
    for (const r of model.relationships) {
      if (!r.from || !r.to) issues.push('Relationship missing "from" or "to".');
    }
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true };
}

///////////////////////
// Yoga onboarding helpers
///////////////////////

type Relationship = { from: string; to: string }

export type LinkResult = {
  updatedModel: ModelProposal
  targetTable: string
  suggestedRelationships: Relationship[]
}

const DE_EN = {
  sessions: [/datum/i, /kursname|class|session/i, /trainer|coach/i, /dauer|duration/i, /kapazität|capacity/i],
  bookings: [/buchung|booking/i, /mitglied|kunde|customer/i, /status/i, /session[_\s]?id/i],
  payments: [/zahlung|payment/i, /betrag|amount|total/i, /mwst|vat|steuer|tax/i, /währung|currency/i, /zahlungsdatum|payment[_\s]?date/i],
  customers: [/kunde|mitglied|customer/i, /email/i, /beitritt|join/i],
  coaches: [/trainer|coach/i],
}

function detectTargetTable(columns: string[]): 'sessions' | 'bookings' | 'payments' | 'customers' | 'coaches' {
  const name = (cols: string[]) => cols.join(' ')
  const cols = columns.map(c => String(c))
  if (DE_EN.payments.some(r => r.test(name(cols)))) return 'payments'
  if (DE_EN.bookings.some(r => r.test(name(cols)))) return 'bookings'
  if (DE_EN.sessions.some(r => r.test(name(cols)))) return 'sessions'
  if (DE_EN.customers.some(r => r.test(name(cols)))) return 'customers'
  if (DE_EN.coaches.some(r => r.test(name(cols)))) return 'coaches'
  // default to bookings (most common middle table)
  return 'bookings'
}

function ensureTable(model: ModelProposal, tableName: string, incomingColumns: string[]): ModelProposal {
  const exists = model.recommendedTables?.some((t: any) => t.name === tableName)
  if (!exists) {
    model.recommendedTables = model.recommendedTables || []
    model.recommendedTables.push({ 
      name: tableName, 
      fields: Array.from(new Set(incomingColumns)).map(name => ({ name, type: 'string' })) 
    })
  } else {
    const t = model.recommendedTables.find((t: any) => t.name === tableName)
    if (t) {
      const existingFieldNames = new Set(t.fields.map(f => f.name))
      const newFields = incomingColumns
        .filter(col => !existingFieldNames.has(col))
        .map(name => ({ name, type: 'string' as FieldType }))
      t.fields = [...t.fields, ...newFields]
    }
  }
  return model
}

function hasTable(model: ModelProposal, tableName: string) {
  return model.recommendedTables?.some((t: any) => t.name === tableName)
}

function suggestRelationships(model: ModelProposal, targetTable: string): Relationship[] {
  const rel: Relationship[] = []
  const has = (t: string) => hasTable(model, t)

  if (targetTable === 'payments') {
    if (has('bookings')) rel.push({ from: 'payments.booking_id', to: 'bookings.booking_id' })
    if (has('customers')) rel.push({ from: 'payments.customer_id', to: 'customers.customer_id' })
  }
  if (targetTable === 'bookings') {
    if (has('sessions')) rel.push({ from: 'bookings.session_id', to: 'sessions.session_id' })
    if (has('customers')) rel.push({ from: 'bookings.customer_id', to: 'customers.customer_id' })
  }
  if (targetTable === 'sessions' && has('coaches')) {
    rel.push({ from: 'sessions.coach_id', to: 'coaches.coach_id' })
  }
  return rel
}

export function linkParsedSheetToModel(
  model: ModelProposal, 
  sheet: { columns: string[]; sheetName?: string }
): LinkResult {
  // ✅ Deep clone so nested arrays are new
  const workingModel: ModelProposal =
    typeof structuredClone === 'function'
      ? structuredClone(model)
      : JSON.parse(JSON.stringify(model));

  // Smarter linking logic to improve node-to-sheet mapping
  const normalizedSheet = sheet.sheetName?.toLowerCase().replace(/s$/, '') || ''
  const targetTable = workingModel.recommendedTables?.find(t =>
    t.name.toLowerCase() === normalizedSheet ||
    normalizedSheet.includes(t.name.toLowerCase()) ||
    t.name.toLowerCase().includes(normalizedSheet)
  )?.name || detectTargetTable(sheet.columns)
  
  const target = targetTable
  const normalizedCols = sheet.columns.map(c => String(c).trim())
  const updated = ensureTable(workingModel, target, normalizedCols)

  // ensure base nodes exist to make graph meaningful
  if (target === 'payments') {
    if (!hasTable(updated, 'bookings')) {
      updated.recommendedTables.push({ 
        name: 'bookings', 
        fields: [{ name: 'booking_id', type: 'string' }] 
      })
    }
  }
  if (target === 'bookings') {
    if (!hasTable(updated, 'sessions')) {
      updated.recommendedTables.push({ 
        name: 'sessions', 
        fields: [{ name: 'session_id', type: 'string' }] 
      })
    }
    if (!hasTable(updated, 'customers')) {
      updated.recommendedTables.push({ 
        name: 'customers', 
        fields: [{ name: 'customer_id', type: 'string' }] 
      })
    }
  }

  const rel = updated.relationships || []
  const suggestions = suggestRelationships(updated, target)
  // avoid dupes
  for (const s of suggestions) {
    if (!rel.some((r: RelationshipDef) => r.from === s.from && r.to === s.to)) {
      rel.push(s)
    }
  }
  updated.relationships = rel

  const notes = sheet.sheetName 
    ? `Linked sheet "${sheet.sheetName}" as ${target}` 
    : `Linked data as ${target}`
  
  updated.meta = {
    ...updated.meta,
    notes: Array.isArray(updated.meta?.notes) 
      ? [...updated.meta.notes, notes]
      : [notes]
  }

  return { updatedModel: updated, targetTable: target, suggestedRelationships: suggestions }
}

// Auto-links uploaded datasets to business-model tables using AI classification
export function autoLinkDatasetsToModel(model: ModelProposal, datasets: any[]) {
  if (!model?.recommendedTables || !datasets?.length) return model

  // Deep clone to ensure React detects a new reference
  const updated = JSON.parse(JSON.stringify(model))

  updated.recommendedTables = updated.recommendedTables.map((tbl: any) => {
    const tblName = tbl.name?.toLowerCase?.() || ''
    const match = datasets.find((ds) => {
      const aiDetected =
        ds.source_meta?.aiClassification?.detectedTable?.toLowerCase?.() || ''
      const detected = ds.source_meta?.detectedTable?.toLowerCase?.() || aiDetected
      const dsName = ds.dataset_name?.toLowerCase?.() || ''
      const sheetName = ds.source_meta?.sheetName?.toLowerCase?.() || ''

      const matchesDetected =
        detected &&
        (detected === tblName ||
          tblName.includes(detected) ||
          detected.includes(tblName))

      const matchesSheet =
        sheetName &&
        (sheetName === tblName ||
          tblName.includes(sheetName) ||
          sheetName.includes(tblName))

      const matchesName =
        dsName && (dsName.includes(tblName) || tblName.includes(dsName))

      return matchesDetected || matchesSheet || matchesName
    })

    if (match) {
      console.log(
        `[AutoLink] Table "${tbl.name}" linked with dataset "${match.dataset_name}" (detected=${match.source_meta?.aiClassification?.detectedTable})`
      )
    }

    return {
      ...tbl,
      isLinked: !!match,
      linkedDatasetId: match?.id || null,
      linkedMeta: match
        ? {
            datasetName: match.dataset_name,
            detectedTable:
              match.source_meta?.aiClassification?.detectedTable ||
              match.source_meta?.detectedTable,
            confidence:
              match.source_meta?.aiClassification?.confidence || 'n/a',
          }
        : undefined,
    }
  })

  console.log('[AutoLink] Result tables:', updated.recommendedTables.map((t:any)=>({name:t.name,isLinked:t.isLinked,linkedId:t.linkedDatasetId})))

  return updated
}
