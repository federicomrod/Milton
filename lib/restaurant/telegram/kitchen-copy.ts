// lib/restaurant/telegram/kitchen-copy.ts
//
// ALL cook-facing Telegram copy (Spanish, informal tú) in one file.
// Strings are Sofia's, verbatim: R1–R4 from her v1.1 draft, R5/R6 from her
// final copy (4 Oct). send.ts sends plain text, so her bold markers are
// dropped. Placeholders: {local}, {local nuevo}, {local anterior},
// {nombre_local}, {producto} — replaced via renderKitchenCopy().
//
// Spanish is the source; English and German follow the same keys below
// (Sie in German). The language of a reply comes from kitchen-language.ts.
//
// Send-only: these are the ONLY messages a cook ever receives (join
// replies and a minimal acknowledgement per report). R1 always sends the
// generic REPORT_ACK; REPORT_ACK_RUNNING_OUT / REPORT_ACK_WASTE exist for
// a later step that can reliably identify the type (and the product) —
// when it can't, fall back to the generic REPORT_ACK.

import { type PreferredLanguage } from "@/lib/restaurant/language";
import { currentKitchenLanguage } from "./kitchen-language";

export const KITCHEN_COPY_ES = {
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
    "✅ Anoté en {empresa}: {items}. El dueño o un admin lo revisa en Costos › Compras antes de cambiar el precio.",
  /** A price was mentioned but the item, price or unit is missing (parse failures only). */
  PRICE_UPDATE_UNCLEAR:
    "No entendí el precio. Escribe producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
  /** The AI price stage threw or timed out (S1: never leave the cook without a reply). */
  PRICE_UPDATE_FAILED:
    "No pude leer los precios ahora. Escríbelos así: producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
  /** A price without a unit: asked once. {producto} = «queso». Nothing is saved yet. */
  PRICE_UNIT_ASK: "¿El precio de {producto} es por libra, onza o unidad?",
  /** Some items of a price message were not understood. {productos} = «sal, comino» (or «un precio»). Appended to the combined reply. */
  PRICE_LOST_AI_DOWN:
    "El precio no lo anoté; mándalo solo, por ejemplo «aguacate $3.50 la libra».",
  PRICE_NOT_UNDERSTOOD:
    "No entendí: {productos}. Escríbelos como «aguacate $1.50 la libra».",
  /** More prices than one message can hold. {n} = how many were processed, {productos} = the ones left out. */
  PRICE_OVER_LIMIT:
    "Procesé los primeros {n} precios. No procesé: {productos}. Mándalos en otro mensaje.",
  /** The voice note could not be transcribed (download, key, timeout or empty). */
  VOICE_UNREADABLE: "No pude escuchar el audio. Mándalo otra vez o escríbelo.",
  VOICE_AI_UNAVAILABLE:
    "Milton no puede escuchar audios ahora mismo. Escríbelo o inténtalo más tarde.",
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
    "No encontré ‘{ingrediente}’ en tus ingredientes. {parecidos}Lo dejé en Compras sin ingrediente asignado para que lo revisen.",
  /** Recipe photo/text could not be saved as a draft. */
  RECIPE_SAVE_FAILED: "No pude guardar la receta. Manda otra foto o escríbela.",
  /** Stock report saved (se agota, 86, merma). {detalle} = «se agotó: tomate», {seccion} = «Se agota» / «Merma» */
  STOCK_REPORT_SAVED:
    "✅ Anoté en {donde}: {detalle}. Lo ves en Cocina › {seccion}. El encargado lo revisa.",
  /** Photo is neither invoice nor recipe - explain what photos can do */
  PHOTO_NOT_RECOGNIZED:
    "Puedo leer facturas de proveedor y recetas en papel. Para una factura, que se vea completa y con buena luz; para una receta, que se vean los ingredientes y las cantidades. Si es factura o receta, responde «factura» o «receta».",
  /** Answer to a question - brief reply */
  QUESTION_RESPONSE:
    "Todavía no puedo responder preguntas; puedo anotar precios, facturas, recetas, se agota y merma.",
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
  // --- Fragments the replies are assembled from ---------------------------
  FRAG_YOUR_RESTAURANT: "tu restaurante",
  FRAG_YOUR_LOCAL: "tu local",
  FRAG_YOUR_PRODUCT: "tu producto",
  FRAG_YOUR_REPORT: "tu aviso",
  /** « de <Proveedor>» after «la factura». */
  FRAG_OF_SUPPLIER: " de {proveedor}",
  FRAG_LINE_ONE: "1 línea",
  FRAG_LINES: "{n} líneas",
  FRAG_SKIPPED_ONE: "1 línea quedó {what}.",
  FRAG_SKIPPED_MANY: "{n} líneas quedaron {what}.",
  FRAG_NO_PRICE: "sin precio",
  FRAG_NO_QUANTITY: "sin cantidad",
  FRAG_NO_UNIT: "sin unidad legible",
  FRAG_SIMILAR: "Parecidos: {lista}. ",
  FRAG_A_PRICE: "un precio",
  FRAG_SOME_PRICES: "unos precios",
  FRAG_PORTION_ONE: "1 porción",
  FRAG_PORTIONS: "{n} porciones",
  /** Joins «a, b y c». */
  FRAG_AND: "y",
  /** Next to a product whose amount is ambiguous: «(¿$1.50 o $150?)». */
  FRAG_AMOUNT_HINT: "(¿${a} o ${b}?)",
  /** «{producto} $1.50 la libra» when the unit has no phrase of its own. */
  FRAG_PER_UNIT: "por {unidad}",
  SECTION_RUNNING_OUT: "Se agota",
  SECTION_WASTE: "Merma",
  STOCK_WASTE: "merma de {lista}",
  STOCK_LOW: "queda poco {lista}",
  STOCK_OUT: "se agotó {lista}",
  CURRENCY_USD: "dólares (USD)",
  CURRENCY_MXN: "pesos mexicanos (MXN)",
  CURRENCY_CRC: "colones (CRC)",
  CURRENCY_GTQ: "quetzales (GTQ)",
  CURRENCY_HNL: "lempiras (HNL)",
  CURRENCY_PEN: "soles (PEN)",
  CURRENCY_EUR: "euros (EUR)",
  CURRENCY_NIO: "córdobas (NIO)",
} as const;

export type KitchenCopyKey = keyof typeof KITCHEN_COPY_ES;
type CopyTable = Record<KitchenCopyKey, string>;

const KITCHEN_COPY_EN: CopyTable = {
  JOINED:
    "✅ Done! You are now in Milton for {empresa} › {local}. When something runs out, gets thrown away or you want to send a recipe, send it here: text, voice note or photo.",
  QR_INVALID:
    "This QR code no longer works. Ask your manager for the updated code.",
  ALREADY_JOINED: "You are already in {empresa} › {local}.",
  JOINED_ADDED:
    "✅ You are now also in {empresa} › {local}. When you send something, I will ask which restaurant it is for.",
  REPORT_ACK:
    "✅ Received, thank you. We will pass it on to the manager of {nombre_local}.",
  REPORT_ACK_RUNNING_OUT:
    "✅ Noted: {producto} ran out or is running low. Thanks for letting us know.",
  REPORT_ACK_WASTE: "✅ Waste noted. Thanks for letting us know.",
  RATE_LIMITED:
    "Many people are joining with this code right now. Try again in a few minutes or ask your manager for help.",
  RECIPE_RECEIVED:
    "✅ Received the recipe for {plato} in Kitchen of {empresa} › {local}. The manager reviews it before it counts in costs.",
  RECIPE_ASK_PORTIONS:
    "How many portions did it make? Reply with a number, for example: 2.",
  RECIPE_PORTIONS_SET:
    "Done: {porciones}. It is now in Kitchen of {empresa} › {local} for review.",
  RECIPE_PORTIONS_UNCLEAR:
    "I did not understand. How many portions did it make? Reply with a number, for example: 2.",
  INVOICE_RECEIVED:
    "✅ I saved the invoice{de_proveedor} in {empresa} › {local}: I read {lineas}.{sin_precio} It stays as a draft in Costs › Purchases until the owner or an admin approves it.",
  INVOICE_SAVE_FAILED:
    "I could not save the invoice. Nothing was recorded. Try again in a few minutes or upload it from Costs › Purchases.",
  INVOICE_CURRENCY_MISMATCH:
    "The invoice is in a different currency than your restaurant's. Upload it from Costs › Purchases to review it.",
  INVOICE_UNREADABLE:
    "I could not read the invoice. Send another photo: fully visible, straight on and in good light.",
  PHOTO_ASK_KIND:
    '✅ Got the photo. Is it an invoice or a recipe? Reply "invoice" or "recipe".',
  PRICE_UPDATE_RECEIVED:
    "✅ Noted in {empresa}: {items}. The owner or an admin reviews it in Costs › Purchases before the price changes.",
  PRICE_UPDATE_UNCLEAR:
    'I did not understand the price. Write product, price and unit, for example: "avocado $1.50 per pound".',
  PRICE_UPDATE_FAILED:
    'I could not read the prices right now. Write them like this: product, price and unit, for example: "avocado $1.50 per pound".',
  PRICE_UNIT_ASK: "Is the price of {producto} per pound, ounce or unit?",
  PRICE_LOST_AI_DOWN:
    'I did not note the price; send it on its own, for example "avocado $3.50 per pound".',
  PRICE_NOT_UNDERSTOOD:
    'I did not understand: {productos}. Write them like "avocado $1.50 per pound".',
  PRICE_OVER_LIMIT:
    "I processed the first {n} prices. I did not process: {productos}. Send them in another message.",
  VOICE_UNREADABLE: "I could not hear the audio. Send it again or type it.",
  VOICE_AI_UNAVAILABLE:
    "Milton cannot listen to audio right now. Type it or try again later.",
  PRICE_SAVE_FAILED: "I could not save the price. Send it again in a moment.",
  PRICE_AMOUNT_ASK:
    "Is the {producto} at {moneda}{opcion1} or at {moneda}{opcion2}? Reply {opcion1} or {opcion2}.",
  PRICE_CURRENCY_MISMATCH:
    "You said {moneda_dicha}, but {empresa} works in {moneda_empresa}. Send me the price in {moneda_empresa}.",
  PRICE_QUESTION_CLOSED:
    'I left the price of {producto} unsaved. If you like, send it again with the unit, for example "{producto} $1.50 per pound".',
  PRICE_INGREDIENT_NOT_FOUND:
    "I did not find ‘{ingrediente}’ in your ingredients. {parecidos}I left it in Purchases without an assigned ingredient for review.",
  RECIPE_SAVE_FAILED:
    "I could not save the recipe. Send another photo or type it.",
  STOCK_REPORT_SAVED:
    "✅ Noted in {donde}: {detalle}. You can see it in Kitchen › {seccion}. The manager reviews it.",
  PHOTO_NOT_RECOGNIZED:
    'I can read supplier invoices and paper recipes. For an invoice, make sure it is fully visible and well lit; for a recipe, make sure the ingredients and quantities are visible. If it is an invoice or a recipe, reply "invoice" or "recipe".',
  QUESTION_RESPONSE:
    "I cannot answer questions yet; I can note prices, invoices, recipes, items running out and waste.",
  GREETING_RESPONSE:
    "👋 Hi! I am here to note prices, invoices, recipes, items running out and waste for {empresa} › {local}.",
  COMPLAINT_RESPONSE:
    "I understand there is a problem. Please let the manager of {empresa} › {local} know. I can help by noting prices, invoices, recipes, items running out and waste.",
  UNCLEAR_MESSAGE:
    'I did not quite understand the message. I can note: prices (for example "avocado $1.50 per pound"), invoices (send a photo), recipes (send a photo or the ingredients), items running out, 86, or waste.',
  UNSUPPORTED_MEDIA:
    "I cannot process that type of file. I can read: photos (invoices and recipes), voice notes and text messages.",
  PROCESSING_FAILED:
    "I could not process it right now. Try again in a moment or let the manager of {empresa} › {local} know.",
  PHOTO_PROCESS_FAILED: "I could not process the photo. Try again.",
  OWNER_CHAT_NOT_COOK:
    "This chat receives the briefing of {empresa}. To send invoices, recipes or prices, scan the kitchen QR in Milton (Kitchen › Kitchen team) with this Telegram.",
  BRIEFING_CHAT_ALREADY_CONNECTED:
    "This Telegram chat already receives another restaurant's briefing in Milton. A chat can only receive the briefing of one restaurant.",
  ROUTING_ASK: "Which restaurant is this for?",
  BUTTON_CANCEL: "Cancel",
  BUTTON_CHANGE: "Change restaurant",
  BUTTON_MORE: "Show more",
  ROUTING_CHOSEN_EDIT: "For {empresa} › {local} ✓",
  ROUTING_CANCELLED: "Cancelled. I did not save anything.",
  ROUTING_EXPIRED:
    "15 minutes passed and I did not save what you sent (photo/voice note/message). Send it again and choose the restaurant.",
  ROUTING_EXPIRED_EDIT: "Expired",
  CALLBACK_INVALID: "This option is no longer valid.",
  DEFAULT_SET:
    "Done: what you send next goes to {empresa} › {local} (for 30 minutes).",
  ONLY_ONE: "You are only in {empresa} › {local}.",
  LINKS_LIST: "Your restaurants:",
  CHANGE_HINT:
    "If you made a mistake, the owner or an admin can reject it in Milton and you can send it again.",
  DEFAULT_ASK: "Choose the restaurant for what you send next.",
  CHANGE_NOTE: "What you already sent does not move.",
  ROUTING_FAILED: "I could not save your message. Send it again.",
  FRAG_YOUR_RESTAURANT: "your restaurant",
  FRAG_YOUR_LOCAL: "your location",
  FRAG_YOUR_PRODUCT: "your product",
  FRAG_YOUR_REPORT: "your report",
  FRAG_OF_SUPPLIER: " from {proveedor}",
  FRAG_LINE_ONE: "1 line",
  FRAG_LINES: "{n} lines",
  FRAG_SKIPPED_ONE: "1 line was left {what}.",
  FRAG_SKIPPED_MANY: "{n} lines were left {what}.",
  FRAG_NO_PRICE: "without a price",
  FRAG_NO_QUANTITY: "without a quantity",
  FRAG_NO_UNIT: "without a readable unit",
  FRAG_SIMILAR: "Similar: {lista}. ",
  FRAG_A_PRICE: "a price",
  FRAG_SOME_PRICES: "some prices",
  FRAG_PORTION_ONE: "1 portion",
  FRAG_PORTIONS: "{n} portions",
  FRAG_AND: "and",
  FRAG_AMOUNT_HINT: "(${a} or ${b}?)",
  FRAG_PER_UNIT: "per {unidad}",
  SECTION_RUNNING_OUT: "Running out",
  SECTION_WASTE: "Waste",
  STOCK_WASTE: "waste of {lista}",
  STOCK_LOW: "{lista} is running low",
  STOCK_OUT: "{lista} ran out",
  CURRENCY_USD: "US dollars (USD)",
  CURRENCY_MXN: "Mexican pesos (MXN)",
  CURRENCY_CRC: "colones (CRC)",
  CURRENCY_GTQ: "quetzales (GTQ)",
  CURRENCY_HNL: "lempiras (HNL)",
  CURRENCY_PEN: "soles (PEN)",
  CURRENCY_EUR: "euros (EUR)",
  CURRENCY_NIO: "córdobas (NIO)",
};

const KITCHEN_COPY_DE: CopyTable = {
  JOINED:
    "✅ Fertig! Sie sind jetzt in Milton von {empresa} › {local}. Wenn etwas ausgeht, weggeworfen wird oder Sie ein Rezept senden möchten, schicken Sie es hier: Text, Sprachnachricht oder Foto.",
  QR_INVALID:
    "Dieser QR-Code funktioniert nicht mehr. Fragen Sie die Leitung nach dem aktuellen Code.",
  ALREADY_JOINED: "Sie sind bereits in {empresa} › {local}.",
  JOINED_ADDED:
    "✅ Sie sind jetzt auch in {empresa} › {local}. Wenn Sie etwas senden, frage ich nach, für welches Restaurant es ist.",
  REPORT_ACK:
    "✅ Erhalten, danke. Wir leiten es an die Leitung von {nombre_local} weiter.",
  REPORT_ACK_RUNNING_OUT:
    "✅ Notiert: {producto} ist aus oder wird knapp. Danke für den Hinweis.",
  REPORT_ACK_WASTE: "✅ Ausschuss notiert. Danke für den Hinweis.",
  RATE_LIMITED:
    "Mit diesem Code treten gerade sehr viele Personen bei. Versuchen Sie es in einigen Minuten erneut oder bitten Sie die Leitung um Hilfe.",
  RECIPE_RECEIVED:
    "✅ Rezept für {plato} in der Küche von {empresa} › {local} erhalten. Die Leitung prüft es, bevor es in die Kosten einfließt.",
  RECIPE_ASK_PORTIONS:
    "Für wie viele Portionen war es? Antworten Sie mit einer Zahl, zum Beispiel: 2.",
  RECIPE_PORTIONS_SET:
    "Erledigt: {porciones}. Es ist jetzt in der Küche von {empresa} › {local} zur Prüfung.",
  RECIPE_PORTIONS_UNCLEAR:
    "Das habe ich nicht verstanden. Für wie viele Portionen war es? Antworten Sie mit einer Zahl, zum Beispiel: 2.",
  INVOICE_RECEIVED:
    "✅ Ich habe die Rechnung{de_proveedor} in {empresa} › {local} gespeichert: {lineas} gelesen.{sin_precio} Sie bleibt als Entwurf unter Kosten › Einkäufe, bis der Inhaber oder ein Admin sie freigibt.",
  INVOICE_SAVE_FAILED:
    "Ich konnte die Rechnung nicht speichern. Es wurde nichts erfasst. Versuchen Sie es in einigen Minuten erneut oder laden Sie sie unter Kosten › Einkäufe hoch.",
  INVOICE_CURRENCY_MISMATCH:
    "Die Rechnung ist in einer anderen Währung als die Ihres Restaurants. Laden Sie sie unter Kosten › Einkäufe hoch, um sie zu prüfen.",
  INVOICE_UNREADABLE:
    "Ich konnte die Rechnung nicht lesen. Senden Sie ein weiteres Foto: vollständig sichtbar, von vorne und mit gutem Licht.",
  PHOTO_ASK_KIND:
    "✅ Foto erhalten. Ist es eine Rechnung oder ein Rezept? Antworten Sie mit „Rechnung“ oder „Rezept“.",
  PRICE_UPDATE_RECEIVED:
    "✅ Notiert in {empresa}: {items}. Der Inhaber oder ein Admin prüft es unter Kosten › Einkäufe, bevor sich der Preis ändert.",
  PRICE_UPDATE_UNCLEAR:
    "Den Preis habe ich nicht verstanden. Schreiben Sie Produkt, Preis und Einheit, zum Beispiel: „Avocado $1.50 pro Pfund“.",
  PRICE_UPDATE_FAILED:
    "Ich konnte die Preise gerade nicht lesen. Schreiben Sie sie so: Produkt, Preis und Einheit, zum Beispiel: „Avocado $1.50 pro Pfund“.",
  PRICE_UNIT_ASK: "Gilt der Preis von {producto} pro Pfund, Unze oder Stück?",
  PRICE_LOST_AI_DOWN:
    "Den Preis habe ich nicht notiert; senden Sie ihn einzeln, zum Beispiel „Avocado $3.50 pro Pfund“.",
  PRICE_NOT_UNDERSTOOD:
    "Nicht verstanden: {productos}. Schreiben Sie sie so: „Avocado $1.50 pro Pfund“.",
  PRICE_OVER_LIMIT:
    "Ich habe die ersten {n} Preise verarbeitet. Nicht verarbeitet: {productos}. Senden Sie sie in einer weiteren Nachricht.",
  VOICE_UNREADABLE:
    "Ich konnte die Audiodatei nicht verstehen. Senden Sie sie erneut oder schreiben Sie es.",
  VOICE_AI_UNAVAILABLE:
    "Milton kann gerade keine Audiodateien anhören. Schreiben Sie es oder versuchen Sie es später erneut.",
  PRICE_SAVE_FAILED:
    "Ich konnte den Preis nicht speichern. Senden Sie ihn in einem Moment erneut.",
  PRICE_AMOUNT_ASK:
    "Kostet {producto} {moneda}{opcion1} oder {moneda}{opcion2}? Antworten Sie {opcion1} oder {opcion2}.",
  PRICE_CURRENCY_MISMATCH:
    "Sie haben {moneda_dicha} genannt, aber {empresa} arbeitet in {moneda_empresa}. Senden Sie mir den Preis in {moneda_empresa}.",
  PRICE_QUESTION_CLOSED:
    "Ich habe den Preis von {producto} nicht gespeichert. Senden Sie ihn bei Bedarf erneut mit der Einheit, zum Beispiel „{producto} $1.50 pro Pfund“.",
  PRICE_INGREDIENT_NOT_FOUND:
    "Ich habe ‘{ingrediente}’ in Ihren Zutaten nicht gefunden. {parecidos}Ich habe es in den Einkäufen ohne zugeordnete Zutat zur Prüfung belassen.",
  RECIPE_SAVE_FAILED:
    "Ich konnte das Rezept nicht speichern. Senden Sie ein weiteres Foto oder schreiben Sie es.",
  STOCK_REPORT_SAVED:
    "✅ Notiert in {donde}: {detalle}. Sie sehen es unter Küche › {seccion}. Die Leitung prüft es.",
  PHOTO_NOT_RECOGNIZED:
    "Ich kann Lieferantenrechnungen und Rezepte auf Papier lesen. Eine Rechnung sollte vollständig sichtbar und gut beleuchtet sein; bei einem Rezept sollten Zutaten und Mengen erkennbar sein. Wenn es eine Rechnung oder ein Rezept ist, antworten Sie mit „Rechnung“ oder „Rezept“.",
  QUESTION_RESPONSE:
    "Fragen kann ich noch nicht beantworten; ich kann Preise, Rechnungen, Rezepte, ausgegangene Artikel und Ausschuss notieren.",
  GREETING_RESPONSE:
    "👋 Hallo! Ich notiere hier Preise, Rechnungen, Rezepte, ausgegangene Artikel und Ausschuss für {empresa} › {local}.",
  COMPLAINT_RESPONSE:
    "Ich verstehe, dass es ein Problem gibt. Bitte informieren Sie die Leitung von {empresa} › {local}. Ich kann Ihnen helfen, indem ich Preise, Rechnungen, Rezepte, ausgegangene Artikel und Ausschuss notiere.",
  UNCLEAR_MESSAGE:
    "Die Nachricht habe ich nicht ganz verstanden. Ich kann notieren: Preise (zum Beispiel „Avocado $1.50 pro Pfund“), Rechnungen (Foto senden), Rezepte (Foto oder Zutaten senden), ausgegangene Artikel, 86 oder Ausschuss.",
  UNSUPPORTED_MEDIA:
    "Diesen Dateityp kann ich nicht verarbeiten. Ich kann lesen: Fotos (Rechnungen und Rezepte), Sprachnachrichten und Textnachrichten.",
  PROCESSING_FAILED:
    "Ich konnte es gerade nicht verarbeiten. Versuchen Sie es in einem Moment erneut oder informieren Sie die Leitung von {empresa} › {local}.",
  PHOTO_PROCESS_FAILED:
    "Ich konnte das Foto nicht verarbeiten. Versuchen Sie es erneut.",
  OWNER_CHAT_NOT_COOK:
    "Dieser Chat erhält das Briefing von {empresa}. Um Rechnungen, Rezepte oder Preise zu senden, scannen Sie mit diesem Telegram den Küchen-QR-Code in Milton (Küche › Küchenteam).",
  BRIEFING_CHAT_ALREADY_CONNECTED:
    "Dieser Telegram-Chat erhält bereits das Briefing eines anderen Restaurants in Milton. Ein Chat kann nur das Briefing eines Restaurants erhalten.",
  ROUTING_ASK: "Für welches Restaurant ist das?",
  BUTTON_CANCEL: "Abbrechen",
  BUTTON_CHANGE: "Restaurant wechseln",
  BUTTON_MORE: "Mehr anzeigen",
  ROUTING_CHOSEN_EDIT: "Für {empresa} › {local} ✓",
  ROUTING_CANCELLED: "Abgebrochen. Ich habe nichts gespeichert.",
  ROUTING_EXPIRED:
    "15 Minuten sind vergangen und ich habe nicht gespeichert, was Sie gesendet haben (Foto/Sprachnachricht/Nachricht). Senden Sie es erneut und wählen Sie das Restaurant.",
  ROUTING_EXPIRED_EDIT: "Abgelaufen",
  CALLBACK_INVALID: "Diese Option ist nicht mehr gültig.",
  DEFAULT_SET:
    "Erledigt: Was Sie als Nächstes senden, geht an {empresa} › {local} (für 30 Minuten).",
  ONLY_ONE: "Sie sind nur in {empresa} › {local}.",
  LINKS_LIST: "Ihre Restaurants:",
  CHANGE_HINT:
    "Falls Sie sich geirrt haben, kann der Inhaber oder ein Admin es in Milton ablehnen und Sie senden es erneut.",
  DEFAULT_ASK:
    "Wählen Sie das Restaurant für das, was Sie als Nächstes senden.",
  CHANGE_NOTE: "Was Sie bereits gesendet haben, wird nicht verschoben.",
  ROUTING_FAILED:
    "Ich konnte Ihre Nachricht nicht speichern. Senden Sie sie erneut.",
  FRAG_YOUR_RESTAURANT: "Ihr Restaurant",
  FRAG_YOUR_LOCAL: "Ihr Standort",
  FRAG_YOUR_PRODUCT: "Ihr Produkt",
  FRAG_YOUR_REPORT: "Ihre Meldung",
  FRAG_OF_SUPPLIER: " von {proveedor}",
  FRAG_LINE_ONE: "1 Zeile",
  FRAG_LINES: "{n} Zeilen",
  FRAG_SKIPPED_ONE: "1 Zeile blieb {what}.",
  FRAG_SKIPPED_MANY: "{n} Zeilen blieben {what}.",
  FRAG_NO_PRICE: "ohne Preis",
  FRAG_NO_QUANTITY: "ohne Menge",
  FRAG_NO_UNIT: "ohne lesbare Einheit",
  FRAG_SIMILAR: "Ähnlich: {lista}. ",
  FRAG_A_PRICE: "ein Preis",
  FRAG_SOME_PRICES: "einige Preise",
  FRAG_PORTION_ONE: "1 Portion",
  FRAG_PORTIONS: "{n} Portionen",
  FRAG_AND: "und",
  FRAG_AMOUNT_HINT: "(${a} oder ${b}?)",
  FRAG_PER_UNIT: "pro {unidad}",
  SECTION_RUNNING_OUT: "Ausgehend",
  SECTION_WASTE: "Ausschuss",
  STOCK_WASTE: "Ausschuss von {lista}",
  STOCK_LOW: "{lista} wird knapp",
  STOCK_OUT: "{lista} ist ausgegangen",
  CURRENCY_USD: "US-Dollar (USD)",
  CURRENCY_MXN: "Mexikanische Pesos (MXN)",
  CURRENCY_CRC: "Colones (CRC)",
  CURRENCY_GTQ: "Quetzales (GTQ)",
  CURRENCY_HNL: "Lempiras (HNL)",
  CURRENCY_PEN: "Soles (PEN)",
  CURRENCY_EUR: "Euro (EUR)",
  CURRENCY_NIO: "Córdobas (NIO)",
};

const TABLES: Record<PreferredLanguage, CopyTable> = {
  es: KITCHEN_COPY_ES,
  en: KITCHEN_COPY_EN,
  de: KITCHEN_COPY_DE,
};

/** The copy table for a language. */
export function kitchenCopyFor(lang: PreferredLanguage): CopyTable {
  return TABLES[lang];
}

/**
 * The cook-facing copy in the language of the current update (see
 * kitchen-language.ts). Spanish unless the webhook set another language, so
 * KITCHEN_COPY.X can still be compared with the Spanish constant in tests.
 */
export const KITCHEN_COPY: typeof KITCHEN_COPY_ES = new Proxy(KITCHEN_COPY_ES, {
  get(target, prop, receiver) {
    if (typeof prop === "string" && prop in target) {
      return TABLES[currentKitchenLanguage()][prop as KitchenCopyKey];
    }
    return Reflect.get(target, prop, receiver);
  },
});

/** Joins «a, b y c» in the current language. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${KITCHEN_COPY.FRAG_AND} ${names[names.length - 1]}`;
}

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
    empresa: staff.company_name?.trim() || KITCHEN_COPY.FRAG_YOUR_RESTAURANT,
    local: staff.location_name?.trim() || KITCHEN_COPY.FRAG_YOUR_LOCAL,
  };
}

/** «Empresa › Local», or just the company when both names are the same. */
export function destinationWhere(staff: {
  company_name?: string | null;
  location_name?: string | null;
}): string {
  const { empresa, local } = destinationVars(staff);
  if (empresa.toLowerCase() === local.toLowerCase()) return empresa;
  return `${empresa} › ${local}`;
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
