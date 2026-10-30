import { afterEach, describe, expect, it, vi } from "vitest";
import { de, en, es } from "../i18n/strings";
import {
  TOAST_MS,
  currentToast,
  sentToastText,
  showToast,
  subscribeToast,
} from "./toast";

afterEach(() => vi.useRealTimers());

describe("sentToastText", () => {
  it("is «Enviado · pan» for a short product name, in each language", () => {
    expect(sentToastText(es.status.sent, { kind: "text", text: "pan" })).toBe(
      "Enviado · pan"
    );
    expect(sentToastText(en.status.sent, { kind: "text", text: "bread" })).toBe(
      "Sent · bread"
    );
    expect(
      sentToastText(de.status.sent, { kind: "text", text: "queso fresco" })
    ).toBe(`${de.status.sent} · queso fresco`);
  });

  it("is just «Enviado» for photos, voice notes and anything longer or with numbers", () => {
    const sent = es.status.sent;
    expect(sentToastText(sent, { kind: "photo" })).toBe("Enviado");
    expect(sentToastText(sent, { kind: "voice" })).toBe("Enviado");
    expect(
      sentToastText(sent, { kind: "text", text: "se nos acaba el queso" })
    ).toBe("Enviado");
    expect(sentToastText(sent, { kind: "text", text: "pan 2" })).toBe(
      "Enviado"
    );
    expect(sentToastText(sent, { kind: "text", text: "  " })).toBe("Enviado");
  });

  it("an explicit name wins (quick replies)", () => {
    expect(
      sentToastText(es.status.sent, {
        kind: "text",
        text: "tomates: 5",
        name: "tomates",
      })
    ).toBe("Enviado · tomates");
  });
});

describe("the toast hides by itself", () => {
  it("shows, notifies, and disappears after a moment", () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const off = subscribeToast(() => seen.push(currentToast()));
    showToast("Enviado · pan");
    expect(currentToast()).toBe("Enviado · pan");
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(currentToast()).toBe("Enviado · pan");
    vi.advanceTimersByTime(2);
    expect(currentToast()).toBeNull();
    expect(seen).toEqual(["Enviado · pan", null]);
    off();
  });

  it("a second toast replaces the first and restarts the clock", () => {
    vi.useFakeTimers();
    showToast("uno");
    vi.advanceTimersByTime(TOAST_MS - 100);
    showToast("dos");
    vi.advanceTimersByTime(200);
    expect(currentToast()).toBe("dos");
    vi.advanceTimersByTime(TOAST_MS);
    expect(currentToast()).toBeNull();
  });
});
