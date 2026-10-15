// lib/ai/column-mapper.ts
//
// Core of app/api/ai/column-mapper/route.ts, extracted so restaurant
// imports can call the same mapper without an HTTP hop. The route stays
// a thin wrapper.

import { openai } from "@/lib/openai-client";

export interface TargetField {
  name: string;
  type?: string;
  required?: boolean;
}

export interface SuggestedMapping {
  originalColumn: string;
  standardField: string;
  confidence: number;
  dataType: "string" | "number" | "date" | "currency";
  transformation:
    | "none"
    | "date_conversion"
    | "currency_conversion"
    | "text_cleanup";
}

export interface ColumnMapperResult {
  mappings: SuggestedMapping[];
  notes?: string;
}

function emptyMappings(
  targetFields: TargetField[],
  notes: string
): ColumnMapperResult {
  return {
    mappings: targetFields.map((f) => ({
      originalColumn: "",
      standardField: f.name,
      confidence: 0,
      dataType: "string" as const,
      transformation: "none" as const,
    })),
    notes,
  };
}

function fallbackMappings(field: TargetField): SuggestedMapping {
  return {
    originalColumn: "",
    standardField: field.name,
    confidence: 0,
    dataType: "string",
    transformation: "none",
  };
}

/**
 * Map file columns onto target fields. Same contract as POST /api/ai/column-mapper.
 */
export async function suggestColumnMappings(input: {
  headers: string[];
  sampleRows?: Record<string, unknown>[];
  targetFields: TargetField[];
  tableName?: string;
}): Promise<ColumnMapperResult> {
  const headers = input.headers;
  const sampleRows = input.sampleRows ?? [];
  const targetFields = input.targetFields;
  const tableName = input.tableName ?? "Table";

  if (headers.length === 0 || targetFields.length === 0) {
    throw new Error("headers and targetFields are required");
  }

  if (!process.env.OPENAI_API_KEY) {
    return emptyMappings(
      targetFields,
      "OpenAI key missing; no AI mapping applied."
    );
  }

  const systemPrompt = `You are a data mapping assistant. Given:
1) File column names (from an uploaded CSV/Excel)
2) A few sample rows (first 3)
3) Target system fields (the schema we want to map into)

Your task: for each target field, choose the BEST matching file column by name and sample values. Use "unmapped" as standardField if no file column fits.

Rules:
- Match by semantic meaning, not literal text. File columns and sample values may be in any language (e.g. German, French, Spanish, Portuguese). Map by meaning: e.g. "Datum"/"Date"/"Fecha" -> date, "Betrag"/"Amount"/"Montant" -> amount, "Kunde"/"Customer"/"Cliente" -> customer.
- Prefer strong semantic matches across languages; then same-language name similarity; then use sample value shape (numbers, dates, IDs).
- Each file column may be used at most once.
- Return valid JSON only, with a single key "mappings" whose value is an array of objects.
- Each object must have: originalColumn (string, one of the file columns or ""), standardField (string, one of the target field names or "unmapped"), confidence (0-1), dataType ("string"|"number"|"date"|"currency"), transformation ("none"|"date_conversion"|"currency_conversion"|"text_cleanup").
- For unmapped target fields use originalColumn: "" and standardField: "<fieldName>".
- Include exactly one entry per target field (so standardField cycles through all target field names).`;

  const targetFieldsDesc = targetFields
    .map(
      (f) =>
        `${f.name}${f.type ? ` (${f.type})` : ""}${f.required ? " [required]" : ""}`
    )
    .join(", ");

  const userPrompt = `Table/schema name: ${tableName}
Target fields (map file columns to these): ${targetFieldsDesc}

File columns: ${headers.join(", ")}

Sample rows (first 3):
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

Return JSON: { "mappings": [ { "originalColumn": "...", "standardField": "...", "confidence": 0.9, "dataType": "string", "transformation": "none" }, ... ] }`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawContent = completion?.choices?.[0]?.message?.content ?? "{}";
  const cleanedContent = rawContent
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  let parsed: { mappings?: SuggestedMapping[] };
  try {
    parsed = JSON.parse(cleanedContent);
  } catch (parseErr) {
    console.error("[column-mapper] Parse error:", rawContent, parseErr);
    return emptyMappings(
      targetFields,
      "AI response was invalid JSON; no mapping applied."
    );
  }

  const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
  const validHeaders = new Set(headers);

  const normalized: SuggestedMapping[] = targetFields.map((field) => {
    const suggested = mappings.find(
      (m: SuggestedMapping) => m.standardField === field.name
    );
    if (!suggested) return fallbackMappings(field);
    const col =
      suggested.originalColumn && validHeaders.has(suggested.originalColumn)
        ? suggested.originalColumn
        : "";
    const dataType =
      suggested.dataType &&
      ["string", "number", "date", "currency"].includes(suggested.dataType)
        ? suggested.dataType
        : "string";
    const transformation =
      suggested.transformation &&
      [
        "none",
        "date_conversion",
        "currency_conversion",
        "text_cleanup",
      ].includes(suggested.transformation)
        ? suggested.transformation
        : "none";
    return {
      originalColumn: col,
      standardField: field.name,
      confidence: Number(suggested.confidence) || 0,
      dataType: dataType as SuggestedMapping["dataType"],
      transformation: transformation as SuggestedMapping["transformation"],
    };
  });

  return { mappings: normalized };
}
