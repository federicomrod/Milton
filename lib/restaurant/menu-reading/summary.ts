// What the person reads after "Leer menú". Plain copy, no imports, so
// the client can use it. Every number is a count of PLATOS (several POS
// products of the same plato count once), taken from the result's own fields.

export interface MenuReadSummaryInput {
  dishes_read: number;
  drafted: number;
  skipped_has_recipe?: number;
  skipped_no_ingredients?: number;
  skipped_draft_exists?: number;
  not_on_menu?: number;
  failed?: number;
  new_components?: number;
  truncated?: boolean;
}

export type MenuReadLineKey =
  | "read"
  | "drafted"
  | "has_recipe"
  | "no_ingredients"
  | "draft_exists"
  | "not_on_menu"
  | "failed"
  | "new_components"
  | "truncated";

export interface MenuReadLine {
  key: MenuReadLineKey;
  text: string;
}

/** One short line per non-zero count; the first two are always shown. */
export function menuReadSummaryLines(
  result: MenuReadSummaryInput
): MenuReadLine[] {
  const one = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  const lines: MenuReadLine[] = [];
  const n = result.dishes_read;
  lines.push({
    key: "read",
    text: `Leí ${n} ${one(n, "plato", "platos")} en tu menú.`,
  });
  const d = result.drafted;
  lines.push({
    key: "drafted",
    text:
      `Preparé ${d} ${one(d, "borrador", "borradores")} de receta.` +
      (d > 0 ? " Las cantidades quedan pendientes: tú las escribes." : ""),
  });
  const has = result.skipped_has_recipe ?? 0;
  if (has > 0) {
    lines.push({
      key: "has_recipe",
      text:
        has === 1
          ? "1 plato ya tiene receta: no lo cambié."
          : `${has} platos ya tienen receta: no los cambié.`,
    });
  }
  const none = result.skipped_no_ingredients ?? 0;
  if (none > 0) {
    lines.push({
      key: "no_ingredients",
      text:
        none === 1
          ? "1 plato del menú no dice qué lleva: no pude armar el borrador. Usa «Estimar con Milton»."
          : `${none} platos del menú no dicen qué llevan: no pude armar el borrador. Usa «Estimar con Milton».`,
    });
  }
  const exists = result.skipped_draft_exists ?? 0;
  if (exists > 0) {
    lines.push({
      key: "draft_exists",
      text:
        exists === 1
          ? "1 plato ya tenía un borrador del menú."
          : `${exists} platos ya tenían un borrador del menú.`,
    });
  }
  const off = result.not_on_menu ?? 0;
  if (off > 0) {
    lines.push({
      key: "not_on_menu",
      text:
        off === 1
          ? "1 plato sin receta no aparece en el menú."
          : `${off} platos sin receta no aparecen en el menú.`,
    });
  }
  const failed = result.failed ?? 0;
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
