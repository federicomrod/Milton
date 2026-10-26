// lib/restaurant/recipe-upload/extract.ts
//
// Server: reads recipes out of RecipeChunk[] with ONE model call per chunk
// (three at a time). The model is injectable (UploadAi) so tests never touch
// the network. A chunk that fails is skipped and counted; the rest still read.
//
// SECURITY: never logs the extracted text, the model answer, file names or
// keys. Only counts and timings.

import {
  createOpenAIClient,
  openAiModel,
} from "@/lib/restaurant/openai-client";
import type { RecipeChunk } from "./chunks";
import {
  validateUploadResponse,
  type ExtractedUploadRecipe,
  type IgnoredSection,
} from "./validate";

export type { ExtractedUploadRecipe, IgnoredSection } from "./validate";

/** The model: gets one chunk, returns its raw JSON answer. May throw. */
export type UploadAi = (chunk: RecipeChunk) => Promise<unknown>;

export const UPLOAD_AI_TIMEOUT_MS = 45_000;
export const UPLOAD_CONCURRENCY = 3;

export const UPLOAD_EXTRACTION_PROMPT = `Eres un asistente de cocina experto en leer recetas de restaurantes escritas en español. Te paso el contenido de UNA hoja, página, parte de documento o foto. Extrae TODAS las recetas que contenga. Responde SIEMPRE en JSON con esta estructura exacta:

{
  "recipes": [
    {
      "dish_name": "nombre de la receta",
      "kind": "plato" o "preparacion",
      "portions": número entero o null,
      "yield_text": "texto original del rendimiento" o null,
      "ingredients": [
        {"name": "ingrediente", "estimated_quantity": número o null, "unit": "unidad escrita" o null, "confidence": "high/medium/low"}
      ],
      "overall_confidence": "high/medium/low"
    }
  ],
  "ignored": [
    {"name": "nombre o encabezado de la sección", "reason": "motivo corto en español"}
  ]
}

Reglas:
1. Devuelve CADA receta que haya en el texto. Una hoja o página puede tener cero, una o varias recetas (bloques apilados, separados por filas en blanco, cada uno con su título y un encabezado «Ingrediente / Cantidad / Unidad»). No mezcles ingredientes de bloques distintos.
2. Si un bloque no tiene fila de título, usa el nombre de la hoja («Hoja: …») como nombre de la receta.
3. Ignora todo lo que no sea una receta (listas de proveedores, teléfonos, listas de precios, notas sueltas) y anótalo en "ignored" con un motivo corto en español, por ejemplo «no parece una receta: lista de proveedores».
4. NO son ingredientes: «Tiempo: …», «Porciones/Rinde/Rendimiento: …», «Tipo: …», los pasos de preparación, las notas al pie que empiezan con «*» y los totales («Costo total»). No los pongas en "ingredients".
5. portions: un número entero SOLO cuando está escrito como porciones, platos, personas o servicios («Porciones: 6», «Rendimiento: 4 platos (1 pescado por plato)» → 4, «Rinde: 12 panes» → 12, «Rinde: 10 unidades» → 10). Un paréntesis aclaratorio no cambia el número. Si el rendimiento es un peso o volumen («Rinde: 1 litro», «2 tazas», «3 kg») o no se puede dividir en un número entero, pon portions null. SIEMPRE copia el texto original del rendimiento en yield_text. Si no hay porciones escritas, portions es null. Nunca las calcules ni las adivines.
6. kind: es "plato" cuando el rendimiento está escrito en platos, porciones, personas o servicios (o en unidades contables como panes); un plato NO es una preparación aunque use una salsa o una preparación como ingrediente («chimol», «ver Salsas: chimol»). Es "preparacion" SOLO cuando el rendimiento es un volumen o peso (litro, taza, kg, g, ml, galón, libra, onza), o cuando la hoja se llama «Salsas», «Preparaciones» o «Bases» (salvo que el rendimiento diga platos o porciones). Si no hay nada de eso, es "plato".
7. Cantidades: copia solo lo que está escrito. Las fracciones pasan a decimales (1/2 → 0.5, 1 1/2 → 1.5). «al gusto», «una pizca», «c/n» o vacío → estimated_quantity null y confidence "low". Nunca estimes ni inventes una cantidad.
8. Unidades: copia la palabra de unidad tal como está escrita (lb, kg, g, ml, litro, taza, cucharada, cucharadita, diente, manojo, unidad…). Si solo hay un conteo («2 zanahorias», «1/2 repollo»), la unidad es «unidad».
9. Conserva «(opcional)» o una referencia («ver Salsas: chimol») dentro del nombre del ingrediente, tal como está escrito.
10. No copies precios ni costos como cantidades. Extrae SOLO lo visible o escrito; nunca inventes.`;

function userIntro(chunk: RecipeChunk): string {
  return chunk.kind === "text"
    ? "Extrae las recetas de este contenido:"
    : "Extrae las recetas de este documento:";
}

/** The real reader, backed by OpenAI chat completions (JSON mode, temp 0). */
export function createOpenAiUploadReader(): UploadAi {
  return async (chunk) => {
    const made = await createOpenAIClient(UPLOAD_AI_TIMEOUT_MS);
    if (!made.ok) throw new Error(made.error);

    let content: unknown;
    if (chunk.kind === "image" && chunk.dataUrl) {
      content = [
        { type: "text", text: userIntro(chunk) },
        {
          type: "image_url",
          image_url: { url: chunk.dataUrl, detail: "high" },
        },
      ];
    } else if (chunk.kind === "pdf_file" && chunk.base64) {
      content = [
        { type: "text", text: userIntro(chunk) },
        {
          type: "file",
          file: {
            filename: "recetas.pdf",
            file_data: `data:application/pdf;base64,${chunk.base64}`,
          },
        },
      ];
    } else {
      content = `${userIntro(chunk)}\n\n${chunk.text ?? ""}`;
    }

    const completion = await made.client.chat.completions.create({
      model: openAiModel(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: UPLOAD_EXTRACTION_PROMPT },
        { role: "user", content },
      ] as never,
    });
    const rawText = completion.choices?.[0]?.message?.content ?? "";
    if (!rawText) throw new Error("No content");
    return JSON.parse(rawText);
  };
}

export interface ExtractionResult {
  recipes: ExtractedUploadRecipe[];
  ignored: IgnoredSection[];
  /** Chunks whose model call failed or came back unreadable. */
  failed_chunks: number;
}

export async function extractRecipesFromChunks(
  chunks: RecipeChunk[],
  ai: UploadAi,
  concurrency = UPLOAD_CONCURRENCY
): Promise<ExtractionResult> {
  const results: Array<{
    recipes: ExtractedUploadRecipe[];
    ignored: IgnoredSection[];
    failed: boolean;
  }> = new Array(chunks.length);

  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= chunks.length) return;
      const chunk = chunks[i];
      try {
        const raw = await ai(chunk);
        const validated = validateUploadResponse(
          raw,
          chunk.kind === "text" ? (chunk.text ?? "") : null,
          chunk.label
        );
        results[i] = { ...validated, failed: false };
      } catch {
        console.error("[recipe-upload] chunk read failed");
        results[i] = { recipes: [], ignored: [], failed: true };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, worker)
  );

  const recipes: ExtractedUploadRecipe[] = [];
  const ignored: IgnoredSection[] = [];
  let failed = 0;
  for (const r of results) {
    if (!r) continue;
    recipes.push(...r.recipes);
    ignored.push(...r.ignored);
    if (r.failed) failed += 1;
  }
  return { recipes, ignored, failed_chunks: failed };
}
