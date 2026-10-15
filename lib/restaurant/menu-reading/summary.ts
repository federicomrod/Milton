// What the person reads after "Leer menú". Plain copy, no imports, so
// the client can use it.

/** One sentence for the person after "Leer menú". */
export function menuReadSummary(result: {
  dishes_read: number;
  drafted: number;
  new_components: number;
  not_found: readonly string[];
  skipped: readonly unknown[];
  truncated?: boolean;
}): string {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const parts = [
    `Leí ${plural(result.dishes_read, "plato", "platos")} en tu menú`,
    `preparé ${plural(result.drafted, "borrador", "borradores")} en Plato por plato`,
  ];
  if (result.not_found.length > 0) {
    parts.push(
      `${plural(result.not_found.length, "plato del POS", "platos del POS")} no ${result.not_found.length === 1 ? "aparece" : "aparecen"} en el menú`
    );
  }
  if (result.skipped.length > 0) {
    parts.push(
      `${plural(result.skipped.length, "plato", "platos")} ya ${result.skipped.length === 1 ? "tenía" : "tenían"} receta o no ${result.skipped.length === 1 ? "dice" : "dicen"} qué ${result.skipped.length === 1 ? "lleva" : "llevan"}`
    );
  }
  let text = `${parts.join(", ")}.`;
  if (result.drafted > 0) {
    text += ` Las cantidades quedan pendientes: tú las escribes.`;
  }
  if (result.new_components > 0) {
    text += ` ${plural(result.new_components, "componente es nuevo", "componentes son nuevos")} (Nuevo, sugerido): créalos o elige uno de tu lista.`;
  }
  if (result.truncated) {
    text += " El menú era muy largo y leí solo la primera parte.";
  }
  return text;
}
