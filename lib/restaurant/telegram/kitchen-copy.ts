// lib/restaurant/telegram/kitchen-copy.ts
//
// ALL cook-facing Telegram copy (Spanish, informal tú) in one file.
// Strings are Sofia's, verbatim: R1–R4 from her v1.1 draft, R5/R6 from her
// final copy (4 Oct). send.ts sends plain text, so her bold markers are
// dropped. Placeholders: {local}, {local nuevo}, {local anterior},
// {nombre_local}, {producto} — replaced via renderKitchenCopy().
//
// Send-only: these are the ONLY messages a cook ever receives (join
// replies and a minimal acknowledgement per report). R1 always sends the
// generic REPORT_ACK; REPORT_ACK_RUNNING_OUT / REPORT_ACK_WASTE exist for
// a later step that can reliably identify the type (and the product) —
// when it can't, fall back to the generic REPORT_ACK.

export const KITCHEN_COPY = {
  /** R1 — valid QR, new or rejoining cook. */
  JOINED:
    "✅ ¡Listo! Ya estás en Milton de {local}. Cuando algo se acabe, se tire o quieras mandar una receta, mándalo aquí: texto, nota de voz o foto.",
  /** R2 — revoked, rotated or unknown QR. */
  QR_INVALID:
    "Este QR ya no funciona. Pide al encargado el código actualizado.",
  /** R3 — same cook, same location. */
  ALREADY_JOINED:
    "Ya estás en Milton de {local}. No tienes que hacer nada más.",
  /** R4 — joined at A, scans B. */
  MOVED:
    "🔄 Ahora estás en {local nuevo}. Lo que mandes desde ya va a {local nuevo}, no a {local anterior}.",
  /** R5 — after each stored report. The only variant used in R1. */
  REPORT_ACK:
    "✅ Recibido, gracias. Se lo pasamos al encargado de {nombre_local}.",
  /** R5a — optional, NOT used in R1. */
  REPORT_ACK_RUNNING_OUT:
    "✅ Anotado: se acabó o queda poco de {producto}. Gracias por avisar.",
  /** R5b — optional, NOT used in R1. */
  REPORT_ACK_WASTE: "✅ Anotada la merma. Gracias por avisar.",
  /** R6 — more than 20 joins per QR per hour. */
  RATE_LIMITED:
    "Ahora mismo hay muchos ingresos con este código. Prueba de nuevo en unos minutos o pide ayuda al encargado.",
  /** R7 — recipe received with photo + portions. */
  RECIPE_RECEIVED:
    "✅ Recibida la receta de {plato}. El encargado la revisa antes de que cuente en los costos.",
  /** R8 — recipe received but portions missing. */
  RECIPE_ASK_PORTIONS:
    "¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2.",
} as const;

export type KitchenCopyKey = keyof typeof KITCHEN_COPY;

/** Replaces {placeholder} tokens; unknown placeholders are left as-is. */
export function renderKitchenCopy(
  template: string,
  vars: Record<string, string> = {}
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}
