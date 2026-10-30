import { describe, expect, it } from "vitest";
import { formatElapsed, formatQuantity, formatWhen } from "./format";
import { newClientRef } from "./ids";

describe("format", () => {
  it("formats elapsed recording time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(75_000)).toBe("1:15");
    expect(formatElapsed(300_000)).toBe("5:00");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("formats when something was sent", () => {
    const now = new Date(2026, 9, 29, 15, 0);
    expect(formatWhen(new Date(2026, 9, 29, 9, 5).toISOString(), now)).toBe(
      "Hoy 09:05"
    );
    expect(formatWhen(new Date(2026, 9, 28, 23, 59).toISOString(), now)).toBe(
      "Ayer 23:59"
    );
    expect(formatWhen(new Date(2026, 9, 20, 14, 30).toISOString(), now)).toBe(
      "20 oct 14:30"
    );
    expect(formatWhen("nope", now)).toBe("");
  });

  it("trims quantities", () => {
    expect(formatQuantity(12)).toBe("12");
    expect(formatQuantity(0.5)).toBe("0.5");
    expect(formatQuantity(1.2504)).toBe("1.25");
  });

  it("makes client refs the server accepts", () => {
    const ref = newClientRef();
    expect(ref).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    expect(newClientRef()).not.toBe(ref);
    expect(newClientRef(() => 0.5)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
