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
    "✅ ¡Listo! Ya estás en Milton de {empresa} › {local}. Cuando algo se acabe, se tire o quieras mandar una receta, mándalo aquí: texto, nota de voz o foto.",
  /** R2 — revoked, rotated or unknown QR. */
  QR_INVALID:
    "Este QR ya no funciona. Pide al encargado el código actualizado.",
  /** R3 — same cook, same location. */
  ALREADY_JOINED: "Ya estás en {empresa} › {local}.",
  /** R4 — already at another restaurant, scans a new QR: now at both. */
  JOINED_ADDED:
    "✅ Ahora también estás en {empresa} › {local}. Cuando mandes algo te preguntaré para qué restaurante es.",
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
    "✅ Recibida la receta de {plato} en Cocina de {empresa} › {local}. El encargado la revisa antes de que cuente en los costos.",
  /** R8 — recipe received but portions missing. */
  RECIPE_ASK_PORTIONS:
    "¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2.",
  /** R9 — the answer was understood; {porciones} = «2 porciones» / «1 porción». */
  RECIPE_PORTIONS_SET:
    "Listo: {porciones}. Ya está en Cocina de {empresa} › {local} para revisar.",
  /** R10 — a draft is waiting for portions and the reply was not a number. */
  RECIPE_PORTIONS_UNCLEAR:
    "No entendí. ¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2.",
  // --- Invoice photos and price updates -----------------------------------
  // Draft copy, pending Sofia's review.
  /** Invoice read. {de_proveedor} = « de <Proveedor>» or empty; {lineas} = «3 líneas»; {sin_precio} = sentence or empty. */
  INVOICE_RECEIVED:
    "✅ Guardé la factura{de_proveedor} en {empresa} › {local}: leí {lineas}.{sin_precio} Queda como borrador en Costos › Compras hasta que el dueño o un admin la apruebe.",
  /** Invoice read but NOT saved (header, lines or supplier failed, or the saved row could not be confirmed). */
  INVOICE_SAVE_FAILED:
    "No pude guardar la factura. No se registró nada. Intenta de nuevo en unos minutos o súbela desde Costos › Compras.",
  /** The invoice's currency differs from the company's. */
  INVOICE_CURRENCY_MISMATCH:
    "La factura está en otra moneda que la de tu restaurante. Súbela desde Costos › Compras para revisarla.",
  /** Invoice could not be read (download, timeout, nothing usable, no date). */
  INVOICE_UNREADABLE:
    "No pude leer la factura. Manda otra foto: que se vea completa, de frente y con buena luz.",
  /** Photo that is neither obviously an invoice nor a recipe. */
  PHOTO_ASK_KIND:
    "✅ Recibí la foto. ¿Es una factura o una receta? Responde «factura» o «receta».",
  /** Price update stored as a draft. {items} = «aguacate $1.50 la libra». */
  PRICE_UPDATE_RECEIVED:
    "✅ Anoté en {empresa}: {items}. Lo ves en Costos › Compras.",
  /** A price was mentioned but the item, price or unit is missing (parse failures only). */
  PRICE_UPDATE_UNCLEAR:
    "No entendí el precio. Escribe producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
  /** The AI price stage threw or timed out (S1: never leave the cook without a reply). */
  PRICE_UPDATE_FAILED:
    "No pude leer los precios ahora. Escríbelos así: producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
  /** A price without a unit: asked once. {producto} = «queso». Nothing is saved yet. */
  PRICE_UNIT_ASK: "¿El precio de {producto} es por libra, onza o unidad?",
  /** Some items of a price message were not understood. {productos} = «sal, comino» (or «un precio»). Appended to the combined reply. */
  PRICE_NOT_UNDERSTOOD:
    "No entendí: {productos}. Escríbelos como «aguacate $1.50 la libra».",
  /** More prices than one message can hold. {n} = how many were processed, {productos} = the ones left out. */
  PRICE_OVER_LIMIT:
    "Procesé los primeros {n} precios. No procesé: {productos}. Mándalos en otro mensaje.",
  /** The voice note could not be transcribed (download, key, timeout or empty). */
  VOICE_UNREADABLE: "No pude escuchar el audio. Mándalo otra vez o escríbelo.",
  /** The price was understood but could not be saved to the database. */
  PRICE_SAVE_FAILED:
    "No pude guardar el precio. Vuelve a mandarlo en un momento.",
  /** The price amount is ambiguous (150 could be 1.50 or 150). {producto} = «aguacate», {moneda} = «$», {opciones} = «1.50 o 150». */
  PRICE_AMOUNT_ASK:
    "¿El {producto} está a {moneda}{opcion1} o a {moneda}{opcion2}? Responde {opcion1} o {opcion2}.",
  /** The currency mentioned doesn't match the company's currency. */
  PRICE_CURRENCY_MISMATCH:
    "Dijiste {moneda_dicha}, pero {empresa} trabaja en {moneda_empresa}. Mándame el precio en {moneda_empresa}.",
  /** A pending price question was left unanswered and is now closed. */
  PRICE_QUESTION_CLOSED:
    "Dejé sin guardar el precio de {producto}. Si quieres, mándalo otra vez con la unidad, por ejemplo «{producto} $1.50 la libra».",
  /** The ingredient mentioned was not found in the catalog. {parecidos} = optional «Parecidos: X, Y.» */
  PRICE_INGREDIENT_NOT_FOUND:
    "No encontré el ingrediente '{ingrediente}'. ¿Lo creo? {parecidos}Lo dejé en Compras para revisar.",
  /** Recipe photo/text could not be saved as a draft. */
  RECIPE_SAVE_FAILED: "No pude guardar la receta. Manda otra foto o escríbela.",
  /** Stock report saved (se agota, 86, merma). {tipo} = tipo de reporte, {producto} = optional product name */
  STOCK_REPORT_SAVED:
    "✅ Anotado en {empresa} › {local}. Lo ves en Cocina › {seccion}. El encargado lo revisa.",
  /** Photo is neither invoice nor recipe - explain what photos can do */
  PHOTO_NOT_RECOGNIZED:
    "Puedo leer facturas de proveedor y recetas en papel. Si es una factura, mandámela con buena luz y completa. Si es una receta, que se vean los ingredientes y las cantidades.",
  /** Answer to a question - brief reply */
  QUESTION_RESPONSE:
    "Las preguntas están llegando pronto. Por ahora puedo anotar precios, facturas, recetas, se agota y merma. Mándame lo que necesites guardar.",
  /** Greeting or smalltalk response */
  GREETING_RESPONSE:
    "👋 ¡Hola! Estoy aquí para anotar precios, facturas, recetas, se agota y merma de {empresa} › {local}.",
  /** Complaint or problem response */
  COMPLAINT_RESPONSE:
    "Entiendo que hay un problema. Por favor avísale al encargado de {empresa} › {local}. Puedo ayudarte anotando precios, facturas, recetas, se agota y merma.",
  /** Unclear message */
  UNCLEAR_MESSAGE:
    "No entendí bien el mensaje. Puedo anotar: precios (por ejemplo «aguacate $1.50 la libra»), facturas (manda foto), recetas (manda foto o ingredientes), se agota, 86, o merma.",
  /** Unsupported media type */
  UNSUPPORTED_MEDIA:
    "No puedo procesar ese tipo de archivo. Puedo leer: fotos (facturas y recetas), notas de voz, y mensajes de texto.",
  /** Hard failure fallback */
  PROCESSING_FAILED:
    "No pude procesarlo ahora. Inténtalo en un momento o avísale al encargado de {empresa} › {local}.",
  /** Unexpected error while processing a photo. */
  PHOTO_PROCESS_FAILED: "No pude procesar la foto. Intenta de nuevo.",
  /** The sender's chat receives the briefing (owner pairing) but is not a cook. */
  OWNER_CHAT_NOT_COOK:
    "Este chat recibe el briefing de {empresa}. Para mandar facturas, recetas o precios, escanea el QR de cocina en Milton (Cocina › Equipo de cocina) con este Telegram.",
  /** Briefing pairing: this chat already receives another restaurant's briefing. */
  BRIEFING_CHAT_ALREADY_CONNECTED:
    "Este chat de Telegram ya recibe el briefing de otro restaurante en Milton. Un chat solo puede recibir el briefing de un restaurante.",
  // --- Several restaurants: routing questions ------------------------------
  /** Question above the restaurant buttons. */
  ROUTING_ASK: "¿Para qué restaurante es?",
  BUTTON_CANCEL: "Cancelar",
  BUTTON_CHANGE: "Cambiar restaurante",
  BUTTON_MORE: "Ver más",
  /** Edit of the question once a restaurant was chosen. */
  ROUTING_CHOSEN_EDIT: "Para {empresa} › {local} ✓",
  ROUTING_CANCELLED: "Cancelado. No guardé nada.",
  ROUTING_EXPIRED:
    "Pasaron 15 minutos y no guardé lo que mandaste (foto/nota de voz/mensaje). Vuelve a enviarlo y elige el restaurante.",
  /** Edit of the question when the buttons expired. */
  ROUTING_EXPIRED_EDIT: "Expiró",
  CALLBACK_INVALID: "Esta opción ya no es válida.",
  DEFAULT_SET: "Listo: lo próximo va a {empresa} › {local} (por 30 minutos).",
  ONLY_ONE: "Solo estás en {empresa} › {local}.",
  /** Header of the list of the cook's restaurants (one «• …» line each). */
  LINKS_LIST: "Tus restaurantes:",
  CHANGE_HINT:
    "Si te equivocaste, el dueño o un admin puede rechazarlo en Milton y lo vuelves a mandar.",
  /** Above the buttons of /restaurante and «Cambiar restaurante». */
  DEFAULT_ASK: "Elige el restaurante para lo próximo que mandes.",
  /** After «Cambiar restaurante»: what was already saved stays where it is. */
  CHANGE_NOTE: "Lo que ya mandaste no se mueve.",
  /** The message could not be parked to ask the question; nothing was saved. */
  ROUTING_FAILED: "No pude guardar tu mensaje. Vuelve a enviarlo.",
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

/**
 * {empresa} / {local} for a cook's destination. Missing names fall back to a
 * neutral word so a reply never shows an empty «›».
 */
export function destinationVars(staff: {
  company_name?: string | null;
  location_name?: string | null;
}): { empresa: string; local: string } {
  return {
    empresa: staff.company_name?.trim() || "tu restaurante",
    local: staff.location_name?.trim() || "tu local",
  };
}

/** «Tus restaurantes:» followed by one «• {empresa} › {local}» line each. */
export function renderLinksList(
  links: Array<{ companyName: string; locationName: string }>
): string {
  return [
    KITCHEN_COPY.LINKS_LIST,
    ...links.map((l) => {
      const d = destinationVars({
        company_name: l.companyName,
        location_name: l.locationName,
      });
      return `• ${d.empresa} › ${d.local}`;
    }),
  ].join("\n");
}
