// R1-15g (F4): the AI step of Milton's suggestions. Only item NAMES and
// CATEGORIES are sent (nothing else about the business), only for items the
// name/category heuristics left over, and the answer is validated against the
// refs we sent: an invented ref, a repeated item or a one-item group is dropped.

import type { Cluster, ClusterItem } from "./cluster-suggest";

export const MAX_AI_ITEMS = 250;
const MAX_CLUSTERS = 12;

/** Keep only what is safe to store as a suggestion. */
export function validateAiClusters(
  raw: unknown,
  sent: readonly ClusterItem[],
  takenNames: ReadonlySet<string> = new Set()
): Cluster[] {
  const known = new Set(sent.map((i) => i.ref));
  const used = new Set<string>();
  const taken = new Set([...takenNames].map((n) => n.trim().toLowerCase()));
  const list = Array.isArray((raw as { groups?: unknown })?.groups)
    ? ((raw as { groups: unknown[] }).groups as unknown[])
    : [];
  const out: Cluster[] = [];
  for (const entry of list) {
    if (out.length >= MAX_CLUSTERS) break;
    const e = entry as { name?: unknown; refs?: unknown };
    const name =
      typeof e.name === "string" ? e.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 80 || taken.has(name.toLowerCase())) continue;
    const refs = (Array.isArray(e.refs) ? e.refs : [])
      .filter((r): r is string => typeof r === "string")
      .filter((r) => known.has(r) && !used.has(r));
    const unique = [...new Set(refs)];
    if (unique.length < 2) continue;
    for (const r of unique) used.add(r);
    out.push({
      key: `ia:${name.toLowerCase()}`,
      name,
      refs: unique,
      reason: "ia",
    });
    taken.add(name.toLowerCase());
  }
  return out;
}

export function aiPrompt(
  scope: "product" | "preparation" | "ingredient",
  items: readonly ClusterItem[]
): { system: string; user: string } {
  const what =
    scope === "product"
      ? "productos de un menú de restaurante"
      : scope === "preparation"
        ? "preparaciones de cocina"
        : "ingredientes de cocina";
  return {
    system:
      "Eres Milton. Agrupas nombres de " +
      what +
      " en familias que un dueño de restaurante reconocería (p. ej. Refrescos, Cervezas, Papas). " +
      'Responde SOLO JSON: {"groups":[{"name":"Nombre en español","refs":["id",...]}]}. ' +
      "Usa solo los ids recibidos, cada id en un solo grupo, grupos de 2 o más, máximo 12 grupos. " +
      "No inventes ids. Si algo no encaja con claridad, déjalo fuera.",
    user: JSON.stringify(
      items.map((i) => ({
        id: i.ref,
        name: i.name,
        category: i.category ?? null,
      }))
    ),
  };
}
