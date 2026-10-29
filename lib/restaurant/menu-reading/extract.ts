// Read menu text into dishes with the AI. The AI only lists what the menu
// says: dish names, prices, sizes, and what the description puts on the
// plate. Never quantities, never costs. Its answer is checked here.

import { runChat, unwrapAi } from "@/lib/ai/call";

export const MENU_AI_MODEL = "gpt-4o-mini";
/** Characters of menu text per AI call. */
export const MENU_CHUNK_CHARS = 12_000;
const MAX_PARALLEL_CALLS = 3;

export interface MenuDishVariant {
  /** As written: "2 personas", "12 oz". */
  label: string;
  price: number | null;
}

export interface MenuDish {
  name: string;
  section: string | null;
  price: number | null;
  description: string | null;
  variants: MenuDishVariant[];
  /** What the description puts on the plate, as written. */
  components: string[];
  /** The dish photo from the menu page (https), or null. Old readings: absent. */
  image_url?: string | null;
}

/** One AI call: menu text in, raw JSON out. Injected in tests. */
export type MenuAi = (chunk: string) => Promise<unknown>;

const SYSTEM_PROMPT = [
  "Lees el menú de un restaurante y devuelves sus platos en JSON.",
  'Responde solo JSON: {"dishes":[{"name","section","price","description","variants":[{"label","price"}],"components":[],"image_url"}]}.',
  "name: el nombre del plato tal como aparece.",
  "section: la sección del menú (Entradas, Platos fuertes…) o null.",
  "price: el precio como número, o null si hay varios tamaños o no aparece.",
  "description: la descripción del plato copiada tal cual, o null. Puede venir antes o después del precio y de los tamaños; es el texto que dice qué lleva el plato.",
  "variants: tamaños o porciones con su precio (2 personas, 3 personas, 6 oz, 12 oz). [] si no hay.",
  "components: lo que lleva el plato según su descripción, una cosa por elemento, en minúsculas y como lo dice el menú (por ejemplo: queso frito, frijoles, tortillas).",
  "Un plato con tamaños (variants) lleva sus components igual que cualquier otro.",
  "Si la descripción nombra el corte o el producto principal, ese es un component (por ejemplo: 'Corte Ribeye prime' -> ribeye; 'corte de lomito de aguja, tocino y salsa de hongos' -> lomito de aguja, tocino, salsa de hongos).",
  "No inventes componentes que la descripción no menciona. Si no hay descripción, components es [].",
  "Nunca pongas cantidades, pesos ni costos dentro de components.",
  "image_url: en el texto puede haber líneas [imagen: URL | alt]; pon la URL de la imagen que pertenece al plato si aparece junto a él; si no, null. Nunca inventes una URL.",
  "Ignora bebidas sin descripción, horarios, direcciones y textos que no son platos.",
].join(" ");

/** Split menu text on line breaks into pieces of about MENU_CHUNK_CHARS. */
export function chunkMenuText(text: string, size = MENU_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > size) {
      chunks.push(current);
      current = "";
    }
    current = current
      ? `${current}\n${line.slice(0, size)}`
      : line.slice(0, size);
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function price(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^0-9.]/g, ""))
        : NaN;
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
}

/** Only an https link of at most 500 characters is kept. */
export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 500 || /\s/.test(text)) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

/** Keep only well-formed dishes from the AI answer. */
export function parseMenuDishes(raw: unknown): MenuDish[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { dishes?: unknown }).dishes
      : value;
  if (!Array.isArray(list)) return [];
  const dishes: MenuDish[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = str(r.name, 160);
    if (!name) continue;
    const variants = Array.isArray(r.variants)
      ? r.variants
          .map((v) => {
            const vr = (v ?? {}) as Record<string, unknown>;
            const label = str(vr.label, 60);
            return label ? { label, price: price(vr.price) } : null;
          })
          .filter((v): v is MenuDishVariant => v !== null)
      : [];
    const seen = new Set<string>();
    const components = Array.isArray(r.components)
      ? r.components
          .map((c) => str(c, 80))
          .filter((c): c is string => {
            if (!c) return false;
            const key = c.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 30)
      : [];
    dishes.push({
      name,
      section: str(r.section, 80),
      price: price(r.price),
      description: str(r.description, 600),
      variants,
      components,
      image_url: imageUrl(r.image_url),
    });
  }
  return dishes;
}

/** Same dish twice (a chunk border, a repeated section): keep the first. */
function dedupe(dishes: MenuDish[]): MenuDish[] {
  const seen = new Set<string>();
  return dishes.filter((dish) => {
    const key = [
      dish.name.toLowerCase(),
      dish.price ?? "",
      dish.variants.map((v) => `${v.label}:${v.price}`).join("|"),
    ].join("#");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createOpenAiMenuReader(companyId?: string | null): MenuAi {
  return async (chunk) => {
    const completion = unwrapAi(
      await runChat({
        feature: "menu-read",
        companyId,
        timeoutMs: 90_000,
        params: {
          model: MENU_AI_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Menú:\n${chunk}` },
          ],
        },
      })
    );
    return completion.choices?.[0]?.message?.content ?? "";
  };
}

/** Read the whole menu, a few chunks at a time. */
export async function extractMenuDishes(
  text: string,
  ai: MenuAi
): Promise<MenuDish[]> {
  const chunks = chunkMenuText(text);
  const results: MenuDish[][] = new Array(chunks.length);
  for (let start = 0; start < chunks.length; start += MAX_PARALLEL_CALLS) {
    const batch = chunks.slice(start, start + MAX_PARALLEL_CALLS);
    const read = await Promise.all(batch.map((chunk) => ai(chunk)));
    read.forEach((raw, i) => {
      results[start + i] = parseMenuDishes(raw);
    });
  }
  return dedupe(results.flat());
}
