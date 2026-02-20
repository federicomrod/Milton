import { openai } from "@/lib/openai-client";
import { SupabaseClient } from "@supabase/supabase-js";

interface GenerateIdsOptions {
  tableName: string;
  primaryKeyField: string;
  rowCount: number;
  sampleData: Record<string, unknown>[];
  existingIds: string[];
}

interface GenerateIdsResult {
  ids: string[];
  method: "ai" | "pattern" | "fallback";
}

/**
 * Generate unique, meaningful IDs for rows that are missing a primary key.
 *
 * Strategy:
 * 1. If existing IDs are present, detect a pattern and extend it.
 * 2. Otherwise, ask the AI to propose a short prefix + sequential scheme
 *    based on the table name and sample data.
 * 3. Fallback to a deterministic prefix + zero-padded sequence.
 */
export async function generateUniqueIds(
  options: GenerateIdsOptions
): Promise<GenerateIdsResult> {
  const { tableName, primaryKeyField, rowCount, sampleData, existingIds } =
    options;

  // 1. Try pattern-based generation from existing IDs
  if (existingIds.length > 0) {
    const patternIds = generateFromPattern(existingIds, rowCount);
    if (patternIds) {
      return { ids: patternIds, method: "pattern" };
    }
  }

  // 2. Ask AI for a smart prefix + scheme
  try {
    const aiIds = await generateWithAI(
      tableName,
      primaryKeyField,
      rowCount,
      sampleData,
      existingIds
    );
    if (aiIds && aiIds.length === rowCount) {
      return { ids: aiIds, method: "ai" };
    }
  } catch (error) {
    console.warn("[generate-ids] AI generation failed, using fallback:", error);
  }

  // 3. Deterministic fallback
  const fallbackIds = generateFallback(tableName, rowCount, existingIds);
  return { ids: fallbackIds, method: "fallback" };
}

/**
 * Detect a prefix + number pattern (e.g. "BK-001", "MEM-042") in existing IDs,
 * then continue the sequence.
 */
function generateFromPattern(
  existingIds: string[],
  count: number
): string[] | null {
  // Match patterns like "PREFIX-NNN", "PREFIX_NNN", or "PREFIXNNN"
  const patternRegex = /^([A-Za-z]+[-_]?)(\d+)$/;
  const matches = existingIds.map((id) => patternRegex.exec(String(id)));

  const validMatches = matches.filter(Boolean) as RegExpExecArray[];
  if (validMatches.length < existingIds.length * 0.6) return null;

  // All must share the same prefix
  const prefixes = new Set(validMatches.map((m) => m[1]));
  if (prefixes.size !== 1) return null;

  const prefix = validMatches[0][1];
  const padLength = validMatches[0][2].length;

  // Find the highest existing number
  const maxNum = Math.max(...validMatches.map((m) => parseInt(m[2], 10)));

  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}${String(maxNum + i).padStart(padLength, "0")}`);
  }
  return ids;
}

async function generateWithAI(
  tableName: string,
  primaryKeyField: string,
  count: number,
  sampleData: Record<string, unknown>[],
  existingIds: string[]
): Promise<string[]> {
  const sampleSlice = sampleData.slice(0, 3);
  const sampleFields =
    sampleSlice.length > 0 ? Object.keys(sampleSlice[0]) : [];

  const systemPrompt = `You generate short, unique, human-readable IDs for database records.
Rules:
- Return ONLY a JSON array of strings, no explanation.
- IDs must be 3-10 characters: a short uppercase prefix (2-4 letters) derived from the table/entity name, a separator ("-"), and a zero-padded number.
- Example for a "bookings" table: ["BK-001","BK-002","BK-003"]
- Example for a "members" table: ["MEM-001","MEM-002","MEM-003"]
- IDs must not collide with existing IDs.
- Start numbering after the highest existing number, or at 001 if none exist.`;

  const userPrompt = `Table: "${tableName}"
Primary key field: "${primaryKeyField}"
Fields in data: ${JSON.stringify(sampleFields)}
Existing IDs (sample): ${JSON.stringify(existingIds.slice(0, 10))}
Number of new IDs needed: ${count}

Generate ${count} unique IDs.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: Math.max(256, count * 15),
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response");

  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed) || parsed.length !== count) {
    throw new Error(
      `AI returned ${Array.isArray(parsed) ? parsed.length : "non-array"} instead of ${count} IDs`
    );
  }

  // Deduplicate against existing IDs
  const existingSet = new Set(existingIds.map(String));
  const uniqueIds = parsed.map(String);
  for (const id of uniqueIds) {
    if (existingSet.has(id)) {
      throw new Error(`AI generated duplicate ID: ${id}`);
    }
    existingSet.add(id);
  }

  return uniqueIds;
}

function generateFallback(
  tableName: string,
  count: number,
  existingIds: string[]
): string[] {
  const prefix = derivePrefix(tableName);
  const padLen = Math.max(3, String(count + existingIds.length).length);

  // Detect highest existing number with this prefix
  const numRegex = new RegExp(`^${prefix}-?(\\d+)$`, "i");
  let maxNum = 0;
  for (const id of existingIds) {
    const m = numRegex.exec(String(id));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }

  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}-${String(maxNum + i).padStart(padLen, "0")}`);
  }
  return ids;
}

function derivePrefix(tableName: string): string {
  const clean = tableName.replace(/[^a-zA-Z\s_-]/g, "").trim();
  const words = clean.split(/[\s_-]+/).filter(Boolean);

  if (words.length === 1) {
    return words[0].substring(0, 3).toUpperCase();
  }

  return words
    .slice(0, 4)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Foreign-key resolution: match rows against an existing referenced table
// ---------------------------------------------------------------------------

export interface ResolveReferencesOptions {
  supabase: SupabaseClient;
  companyId: string;
  /** The FK field name on the row (e.g. "customer_id") */
  fieldName: string;
  /** The referenced table name (e.g. "Customers") */
  referencedTableName: string;
  /** The PK field name in the referenced table (e.g. "customer_id") */
  referencedField?: string;
  /** The rows being uploaded (mutated in-place) */
  rows: Record<string, any>[];
}

export interface ResolveReferencesResult {
  resolvedCount: number;
  method: "matched" | "distributed" | "generated" | "none";
  /** Set when the referenced table exists but has no data */
  missingDependency?: string;
}

/**
 * Resolve FK values for rows that are missing a reference field.
 *
 * Strategy:
 * 1. Load all records from the referenced table.
 * 2. Try to match rows by comparing text fields (fuzzy name matching).
 * 3. For unmatched rows, distribute existing IDs round-robin.
 * 4. If the referenced table is empty, generate placeholder IDs.
 */
export async function resolveReferences(
  options: ResolveReferencesOptions
): Promise<ResolveReferencesResult> {
  const {
    supabase,
    companyId,
    fieldName,
    referencedTableName,
    referencedField,
    rows,
  } = options;

  const rowsMissingFk = rows.filter(
    (r) =>
      r[fieldName] === undefined ||
      r[fieldName] === null ||
      String(r[fieldName]).trim() === ""
  );

  if (rowsMissingFk.length === 0) {
    return { resolvedCount: 0, method: "none" };
  }

  // Find the referenced table in data_tables.
  // Handle name format differences: "membership_plans" vs "Membership Plans"
  const nameVariants = [
    referencedTableName,
    referencedTableName.replace(/_/g, " "),
    referencedTableName.replace(/\s+/g, "_"),
  ];

  let refTableDef: { id: string; fields: any } | null = null;
  for (const variant of nameVariants) {
    const { data } = await supabase
      .from("data_tables")
      .select("id, fields")
      .ilike("name", variant)
      .maybeSingle();
    if (data) {
      refTableDef = data;
      break;
    }
  }

  if (!refTableDef) {
    console.warn(
      `[resolve-refs] Referenced table "${referencedTableName}" not found in data_tables`
    );
    return {
      resolvedCount: 0,
      method: "none",
      missingDependency: referencedTableName,
    };
  }

  // Determine the PK field of the referenced table
  const refFields: Array<{
    name: string;
    type: string;
    primaryKey?: boolean;
  }> = Array.isArray(refTableDef.fields) ? refTableDef.fields : [];

  const refPkField =
    referencedField || refFields.find((f) => f.primaryKey)?.name || fieldName;

  // Load existing records from the referenced table
  const { data: refRows } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", companyId)
    .eq("model_table_id", refTableDef.id)
    .limit(1000);

  const refRecords = (refRows ?? [])
    .map((r: { data: Record<string, unknown> }) => r.data)
    .filter(Boolean) as Record<string, unknown>[];

  if (refRecords.length === 0) {
    console.log(
      `[resolve-refs] Referenced table "${referencedTableName}" has no data – blocking`
    );
    return {
      resolvedCount: 0,
      method: "none",
      missingDependency: referencedTableName,
    };
  }

  // Build a lookup: PK value -> record, and collect all PKs
  const refPkValues: string[] = [];
  const refLookupByName = new Map<string, string>();

  // Identify text fields in the referenced table for matching
  const textFieldNames = refFields
    .filter(
      (f) =>
        !f.primaryKey && (f.type === "string" || f.type === "text" || !f.type)
    )
    .map((f) => f.name);

  for (const rec of refRecords) {
    const pkVal = rec[refPkField];
    if (pkVal == null) continue;
    const pkStr = String(pkVal);
    refPkValues.push(pkStr);

    // Index by every text field value for fuzzy matching
    for (const tf of textFieldNames) {
      const val = rec[tf];
      if (val != null && String(val).trim()) {
        refLookupByName.set(normalize(String(val)), pkStr);
      }
    }
  }

  if (refPkValues.length === 0) {
    return { resolvedCount: 0, method: "none" };
  }

  // Try to match each missing-FK row against the referenced table
  let matchedCount = 0;
  const unmatchedRows: Record<string, any>[] = [];

  for (const row of rowsMissingFk) {
    let matched = false;

    // Check every text value in the row for a match against the referenced table
    for (const val of Object.values(row)) {
      if (val == null || typeof val !== "string" || !val.trim()) continue;
      const key = normalize(val);
      const refId = refLookupByName.get(key);
      if (refId) {
        row[fieldName] = refId;
        matchedCount++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      unmatchedRows.push(row);
    }
  }

  // For unmatched rows, distribute existing IDs round-robin
  if (unmatchedRows.length > 0) {
    for (let i = 0; i < unmatchedRows.length; i++) {
      unmatchedRows[i][fieldName] = refPkValues[i % refPkValues.length];
    }
  }

  const totalResolved = rowsMissingFk.length;
  const method = matchedCount > 0 ? "matched" : "distributed";

  console.log(
    `[resolve-refs] "${fieldName}" → "${referencedTableName}": ${matchedCount} matched, ${unmatchedRows.length} distributed (${refPkValues.length} available IDs)`
  );

  return { resolvedCount: totalResolved, method };
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
