// What the person reads after "Leer menú". Plain copy, no imports, so
// the client can use it. Every number is a count of PLATOS taken from the
// result's own fields: the first line counts the dishes the MENU lists.

export interface MenuReadSummaryInput {
  dishes_read: number;
  drafted: number;
  skipped_has_recipe?: number;
  skipped_no_ingredients?: number;
  skipped_draft_exists?: number;
  /** Menu dishes no POS product matched. */
  no_pos_match?: number;
  /** Platos with sales this month, sin receta, that the menu does not list. */
  not_on_menu?: number;
  failed?: number;
  new_components?: number;
  truncated?: boolean;
}

export type MenuReadLineKey =
  | "read"
  | "drafted"
  | "no_ingredients"
  | "not_on_menu"
  | "failed"
  | "new_components"
  | "truncated";

export interface MenuReadLine {
  key: MenuReadLineKey;
  text: string;
}

/**
 * One short line per non-zero count; the first two are always shown. The
 * first line splits the dishes the MENU lists, so its parts add up to N.
 */
export function menuReadSummaryLines(
  result: MenuReadSummaryInput
): MenuReadLine[] {
  const one = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  const lines: MenuReadLine[] = [];
  const n = result.dishes_read;
  const has = result.skipped_has_recipe ?? 0;
  const none = result.skipped_no_ingredients ?? 0;
  const exists = result.skipped_draft_exists ?? 0;
  const noPos = result.no_pos_match ?? 0;
  const failed = result.failed ?? 0;
  const d = result.drafted;
  const parts = [
    d > 0 && `${d} con borrador nuevo`,
    has > 0 && `${has} ${one(has, "ya tenía", "ya tenían")} receta`,
    exists > 0 && `${exists} ${one(exists, "ya tenía", "ya tenían")} borrador`,
    none > 0 &&
      `${none} ${one(none, "no dice", "no dicen")} qué ${one(none, "lleva", "llevan")}`,
    noPos > 0 && `${noPos} sin producto en tu POS`,
    failed > 0 && `${failed} con error`,
  ].filter((part): part is string => typeof part === "string");
  lines.push({
    key: "read",
    text: `Leí ${n} ${one(n, "plato", "platos")} en tu menú${parts.length > 0 ? `: ${parts.join(", ")}` : ""}.`,
  });
  lines.push({
    key: "drafted",
    text:
      `Preparé ${d} ${one(d, "borrador", "borradores")} de receta.` +
      (d > 0 ? " Las cantidades quedan pendientes: tú las escribes." : ""),
  });
  if (none > 0) {
    lines.push({
      key: "no_ingredients",
      text:
        none === 1
          ? "1 plato del menú no dice qué lleva: no pude armar el borrador. Usa «Estimar con Milton»."
          : `${none} platos del menú no dicen qué llevan: no pude armar el borrador. Usa «Estimar con Milton».`,
    });
  }
  const off = result.not_on_menu ?? 0;
  if (off > 0) {
    lines.push({
      key: "not_on_menu",
      text:
        off === 1
          ? "1 plato con ventas este mes no tiene receta y no aparece en el menú."
          : `${off} platos con ventas este mes no tienen receta y no aparecen en el menú.`,
    });
  }
  if (failed > 0) {
    lines.push({
      key: "failed",
      text:
        failed === 1
          ? "No pude preparar 1 plato. Intenta de nuevo."
          : `No pude preparar ${failed} platos. Intenta de nuevo.`,
    });
  }
  const fresh = result.new_components ?? 0;
  if (fresh > 0) {
    lines.push({
      key: "new_components",
      text: `${fresh} ${one(fresh, "componente es nuevo", "componentes son nuevos")} (Nuevo, sugerido): créalos o elige uno de tu lista.`,
    });
  }
  if (result.truncated) {
    lines.push({
      key: "truncated",
      text: "El menú era muy largo y leí solo la primera parte.",
    });
  }
  return lines;
}

/** The same lines as one paragraph (for places that show plain text). */
export function menuReadSummary(result: MenuReadSummaryInput): string {
  return menuReadSummaryLines(result)
    .map((line) => line.text)
    .join(" ");
}
