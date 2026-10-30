import { describe, it, expect } from "vitest";
import {
  KITCHEN_COPY,
  KITCHEN_COPY_ES,
  kitchenCopyFor,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import {
  languageFromTelegramCode,
  withKitchenLanguage,
} from "@/lib/restaurant/telegram/kitchen-language";
import { formatPriceUpdateItems } from "@/lib/restaurant/telegram/price-update";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("cook-facing Telegram copy in three languages", () => {
  it("every key exists in en and de with the same placeholders", () => {
    for (const key of Object.keys(KITCHEN_COPY_ES) as Array<
      keyof typeof KITCHEN_COPY_ES
    >) {
      for (const lang of ["en", "de"] as const) {
        const text = kitchenCopyFor(lang)[key];
        expect(text, `${lang}.${key}`).toBeTruthy();
        expect(placeholders(text), `${lang}.${key}`).toEqual(
          placeholders(KITCHEN_COPY_ES[key])
        );
      }
    }
  });

  it("is Spanish by default and follows the language of the update", () => {
    expect(KITCHEN_COPY.ROUTING_ASK).toBe("¿Para qué restaurante es?");
    withKitchenLanguage("de", () => {
      expect(KITCHEN_COPY.ROUTING_ASK).toBe("Für welches Restaurant ist das?");
      expect(KITCHEN_COPY.BUTTON_CANCEL).toBe("Abbrechen");
      expect(
        renderKitchenCopy(KITCHEN_COPY.ALREADY_JOINED, {
          empresa: "A",
          local: "B",
        })
      ).toBe("Sie sind bereits in A › B.");
    });
    withKitchenLanguage("en", () => {
      expect(KITCHEN_COPY.BUTTON_CANCEL).toBe("Cancel");
    });
  });

  it("formats price items per language", () => {
    const items = [{ name: "Avocado", price: 1.5, unit: "lb" }];
    expect(formatPriceUpdateItems(items)).toBe("Avocado $1.50 la libra");
    withKitchenLanguage("de", () => {
      expect(formatPriceUpdateItems(items)).toBe("Avocado $1,50 pro Pfund");
    });
    withKitchenLanguage("en", () => {
      expect(formatPriceUpdateItems(items)).toBe("Avocado $1.50 per lb");
    });
  });

  it("maps Telegram and Accept-Language codes", () => {
    expect(languageFromTelegramCode("de")).toBe("de");
    expect(languageFromTelegramCode("en-GB")).toBe("en");
    expect(languageFromTelegramCode("fr")).toBe("es");
    const req = (v: string) => ({ headers: { get: () => v } });
    expect(mobileLanguage(req("de-DE,de;q=0.9"))).toBe("de");
    expect(mobileLanguage(req(""))).toBe("es");
  });
});
