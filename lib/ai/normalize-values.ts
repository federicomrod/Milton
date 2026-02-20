import { openai } from "@/lib/openai-client";

export interface NormalizeFieldRequest {
  fieldName: string;
  tableName: string;
  allowedValues: string[];
  uniqueValues: string[];
}

export interface NormalizeValuesResult {
  /** fieldName → { originalValue → canonicalValue } */
  mappings: Record<string, Record<string, string>>;
}

/**
 * Use AI to map arbitrary field values (possibly in another language)
 * to canonical allowedValues.
 *
 * Values that already match (case-insensitive) are resolved locally;
 * only truly unknown values are sent to the AI.
 */
export async function normalizeFieldValues(
  fields: NormalizeFieldRequest[]
): Promise<NormalizeValuesResult> {
  const result: Record<string, Record<string, string>> = {};

  const fieldsNeedingAI: NormalizeFieldRequest[] = [];

  for (const field of fields) {
    const mapping: Record<string, string> = {};
    const allowedLower = new Map(
      field.allowedValues.map((v) => [v.toLowerCase(), v])
    );
    const unknowns: string[] = [];

    for (const val of field.uniqueValues) {
      const match = allowedLower.get(val.toLowerCase());
      if (match) {
        mapping[val] = match;
      } else {
        unknowns.push(val);
      }
    }

    result[field.fieldName] = mapping;

    if (unknowns.length > 0) {
      fieldsNeedingAI.push({ ...field, uniqueValues: unknowns });
    }
  }

  if (fieldsNeedingAI.length === 0) {
    return { mappings: result };
  }

  try {
    const aiMappings = await callAINormalization(fieldsNeedingAI);

    for (const [fieldName, fieldMapping] of Object.entries(aiMappings)) {
      result[fieldName] = { ...result[fieldName], ...fieldMapping };
    }
  } catch (error) {
    console.error("[normalize-values] AI normalization failed:", error);
    // For values the AI couldn't map, leave them as identity mappings
    for (const field of fieldsNeedingAI) {
      for (const val of field.uniqueValues) {
        if (!result[field.fieldName][val]) {
          result[field.fieldName][val] = val;
        }
      }
    }
  }

  return { mappings: result };
}

async function callAINormalization(
  fields: NormalizeFieldRequest[]
): Promise<Record<string, Record<string, string>>> {
  const fieldDescriptions = fields
    .map(
      (f) =>
        `Field "${f.fieldName}" (table "${f.tableName}"):\n` +
        `  Allowed values: ${JSON.stringify(f.allowedValues)}\n` +
        `  Values to map: ${JSON.stringify(f.uniqueValues)}`
    )
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a data normalization assistant. Given field values from a user's uploaded file and a list of allowed canonical values, map each value to the correct canonical equivalent.

The file values may be in ANY language (German, Spanish, Portuguese, French, etc.), use different formats, abbreviations, or synonyms. You must determine the correct canonical value for each.

Rules:
- Every input value MUST be mapped to exactly one of the allowed values.
- If a value clearly corresponds to a canonical value (e.g. "Anwesend" → "attended"), map it.
- If a value is ambiguous, pick the closest reasonable match.
- Never invent values outside the allowed list.

Respond with JSON: { "fieldName1": { "inputValue1": "canonicalValue", ... }, ... }`,
      },
      {
        role: "user",
        content: fieldDescriptions,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return {};

  const parsed = JSON.parse(content);
  return parsed as Record<string, Record<string, string>>;
}
