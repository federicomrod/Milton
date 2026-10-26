// Copy follow-up to #312: the note prefix (and the OLD one still recognized),
// the exact phrase the reply suggests, currency symbols, Spanish labels.
import { describe, expect, it } from "vitest";
import {
  isPriceUpdateNote,
  LEGACY_PRICE_UPDATE_NOTE_PREFIX,
  PRICE_UPDATE_NOTE_PREFIX,
} from "@/lib/restaurant/price-update-note";
import {
  currencySymbolFor,
  formatPriceUpdateItems,
  parsePriceUpdate,
} from "@/lib/restaurant/telegram/price-update";
import { KITCHEN_COPY } from "@/lib/restaurant/telegram/kitchen-copy";

describe("price-update note prefix", () => {
  it("the new text is exactly the agreed wording", () => {
    expect(PRICE_UPDATE_NOTE_PREFIX).toBe(
      "Actualización de precio enviada por Telegram (nota de voz o mensaje). Revísala antes de aprobar."
    );
  });

  it("both the new and the OLD prefix count as a price update (existing staging drafts)", () => {
    expect(isPriceUpdateNote(`${PRICE_UPDATE_NOTE_PREFIX}\nNotas`)).toBe(true);
    expect(isPriceUpdateNote(`${LEGACY_PRICE_UPDATE_NOTE_PREFIX}\nNotas`)).toBe(
      true
    );
    expect(LEGACY_PRICE_UPDATE_NOTE_PREFIX).toBe(
      "Actualización de precio enviada por Telegram (de tu nota de voz / texto): revisa antes de aprobar."
    );
    expect(isPriceUpdateNote("Factura enviada por Telegram")).toBe(false);
    expect(isPriceUpdateNote(`otra cosa. ${PRICE_UPDATE_NOTE_PREFIX}`)).toBe(
      false
    );
    expect(isPriceUpdateNote(null)).toBe(false);
  });
});

describe("the example in the «no entendí» reply is accepted by the parser", () => {
  it("«aguacate $1.50 la libra» parses to aguacate / 1.50 / lb", () => {
    expect(parsePriceUpdate("aguacate $1.50 la libra")).toEqual({
      kind: "price_update",
      items: [{ name: "aguacate", price: 1.5, unit: "lb" }],
    });
    expect(KITCHEN_COPY.PRICE_UPDATE_UNCLEAR).toContain(
      "«aguacate $1.50 la libra»"
    );
  });

  it("the failure copy is separate from the parse-failure copy", () => {
    expect(KITCHEN_COPY.PRICE_UPDATE_FAILED).toBe(
      "No pude leer los precios ahora. Escríbelos así: producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra»."
    );
    expect(KITCHEN_COPY.PRICE_UPDATE_FAILED).not.toBe(
      KITCHEN_COPY.PRICE_UPDATE_UNCLEAR
    );
  });
});

describe("formatPriceUpdateItems", () => {
  const items = [{ name: "aguacate", price: 1.5, unit: "lb" }];
  it("uses the company's currency symbol, not a hardcoded $", () => {
    expect(formatPriceUpdateItems(items, currencySymbolFor("USD"))).toBe(
      "aguacate $1.50 la libra"
    );
    expect(formatPriceUpdateItems(items, currencySymbolFor("EUR"))).toBe(
      "aguacate €1.50 la libra"
    );
    expect(currencySymbolFor("GTQ")).toBe("Q");
    expect(currencySymbolFor(null)).toBe("$");
    expect(currencySymbolFor("NOPE")).toBe("$");
  });

  it("says the unit the way a person does; unknown units fall back to «por <unidad>»", () => {
    expect(
      formatPriceUpdateItems([
        { name: "carne", price: 4, unit: "kg" },
        { name: "huevo", price: 3, unit: "docena" },
        { name: "sal", price: 2, unit: "ristra" },
      ])
    ).toBe("carne $4.00 el kilo, huevo $3.00 la docena, sal $2.00 por ristra");
  });
});

describe("invoice copy", () => {
  it("reviewer term is the app's own («el dueño o un admin»)", () => {
    for (const key of ["INVOICE_RECEIVED", "PRICE_UPDATE_RECEIVED"] as const) {
      expect(KITCHEN_COPY[key].toLowerCase()).toContain("el dueño o un admin");
      expect(KITCHEN_COPY[key]).not.toContain("encargado");
    }
    expect(KITCHEN_COPY.PRICE_UPDATE_RECEIVED).not.toContain("{origen}");
  });

  it("the price reply says where to see it: Costos › Compras", () => {
    expect(KITCHEN_COPY.PRICE_UPDATE_RECEIVED).toContain("Costos › Compras");
    expect(KITCHEN_COPY.PRICE_UPDATE_RECEIVED).toContain(
      "antes de cambiar el precio"
    );
  });
});

describe("the invoice reply names the right reason for skipped lines", () => {
  it("sin precio / sin cantidad / sin unidad legible, each with its own count", async () => {
    const { skippedSentence } =
      await import("@/lib/restaurant/telegram/kitchen-media");
    expect(skippedSentence([])).toBe("");
    expect(skippedSentence([{ reason: "no_price" }])).toBe(
      " 1 línea quedó sin precio."
    );
    expect(
      skippedSentence([{ reason: "no_quantity" }, { reason: "no_quantity" }])
    ).toBe(" 2 líneas quedaron sin cantidad.");
    expect(
      skippedSentence([
        { reason: "no_price" },
        { reason: "no_quantity" },
        { reason: "no_unit" },
      ])
    ).toBe(
      " 1 línea quedó sin precio. 1 línea quedó sin cantidad. 1 línea quedó sin unidad legible."
    );
  });
});
