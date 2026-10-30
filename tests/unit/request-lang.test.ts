import { describe, it, expect } from "vitest";
import { languageFromAcceptHeader } from "@/lib/restaurant/request-lang";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { getDictionary } from "@/lib/i18n";

describe("languageFromAcceptHeader", () => {
  it("picks the best supported language", () => {
    expect(languageFromAcceptHeader("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(languageFromAcceptHeader("fr;q=0.9, en;q=0.5, es;q=0.4")).toBe("en");
    expect(languageFromAcceptHeader("fr-FR")).toBeNull();
    expect(languageFromAcceptHeader(null)).toBeNull();
  });
});

describe("userErrorMessage with localized API bodies", () => {
  it("keeps Spanish, German and dictionary English messages", () => {
    for (const lang of ["es", "en", "de"] as const) {
      const msg = getDictionary(lang).admin.api.pickRestaurant;
      expect(userErrorMessage({ error: msg }, "fallback")).toBe(msg);
    }
  });
  it("still hides raw server text", () => {
    expect(userErrorMessage({ error: "Internal Server Error" }, "x")).toBe("x");
  });
});
