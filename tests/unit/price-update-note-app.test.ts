import { describe, expect, it } from "vitest";
import {
  APP_PRICE_UPDATE_NOTE_PREFIX,
  PRICE_UPDATE_NOTE_PREFIX,
  isAppInvoice,
  isPriceUpdateNote,
  isPurchaseInvoice,
  isTelegramInvoice,
} from "@/lib/restaurant/price-update-note";

describe("a price update from the Cocina app", () => {
  const app = { notes: `${APP_PRICE_UPDATE_NOTE_PREFIX}\nextra` };
  const telegram = { notes: PRICE_UPDATE_NOTE_PREFIX };

  it("is a price update, never a purchase (it must not count as spend)", () => {
    expect(isPriceUpdateNote(app.notes)).toBe(true);
    expect(isPurchaseInvoice(app)).toBe(false);
  });

  it("is labelled «por App», not Telegram; Telegram's own is unchanged", () => {
    expect(isAppInvoice(app)).toBe(true);
    expect(isTelegramInvoice(app)).toBe(false);
    expect(isTelegramInvoice(telegram)).toBe(true);
    expect(isAppInvoice(telegram)).toBe(false);
    expect(isTelegramInvoice({ original_file_name: "telegram-foto.jpg" })).toBe(
      true
    );
    expect(isAppInvoice({ notes: null })).toBe(false);
  });
});
