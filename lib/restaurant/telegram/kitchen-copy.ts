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
  /** R9 — the answer was understood; {porciones} = «2 porciones» / «1 porción». */
  RECIPE_PORTIONS_SET: "Listo: {porciones}. Ya está en Cocina para revisar.",
  /** R10 — a draft is waiting for portions and the reply was not a number. */
  RECIPE_PORTIONS_UNCLEAR:
    "No entendí. ¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2.",
  // --- Invoice photos and price updates -----------------------------------
  // Draft copy, pending Sofia's review.
  /** Invoice read. {de_proveedor} = « de <Proveedor>» or empty; {lineas} = «3 líneas»; {sin_precio} = sentence or empty. */
  INVOICE_RECEIVED:
    "✅ Recibí la factura{de_proveedor}: leí {lineas}. El dueño o un admin la revisa en Costos › Compras antes de cambiar precios.{sin_precio} Si falta algo, manda otra foto.",
  /** Invoice could not be read (download, timeout, nothing usable). */
  INVOICE_UNREADABLE:
    "No pude leer la factura. Manda otra foto: que se vea completa, de frente y con buena luz.",
  /** Photo that is neither obviously an invoice nor a recipe. */
  PHOTO_ASK_KIND:
    "✅ Recibí la foto. ¿Es una factura o una receta? Responde «factura» o «receta».",
  /** Price update stored as a draft. {items} = «aguacate $1.50 la libra». */
  PRICE_UPDATE_RECEIVED:
    "✅ Anoté: {items}. El dueño o un admin lo revisa en Costos › Compras antes de cambiar el precio.",
  /** A price was mentioned but the item, price or unit is missing (parse failures only). */
  PRICE_UPDATE_UNCLEAR:
    "No entendí el precio. Escribe producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
  /** The price was understood but could not be saved. */
  PRICE_UPDATE_FAILED:
    "No pude guardar el precio. Vuelve a mandarlo en un momento.",
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
