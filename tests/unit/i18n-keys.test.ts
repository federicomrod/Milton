import { describe, expect, it } from "vitest";
import { de } from "@/lib/i18n/de";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { checkDictionaries } from "@/lib/i18n/check";
import { fmt, getDictionary, localeFor } from "@/lib/i18n";

describe("i18n dictionaries", () => {
  it("es, en and de have the same keys, no empty strings, same {placeholders}", () => {
    expect(checkDictionaries({ es, en, de })).toEqual([]);
  });

  it("reports a missing key, an empty string and a placeholder mismatch", () => {
    const problems = checkDictionaries({
      es: { a: "Hola {name}", b: "x", c: "y" },
      en: { a: "Hello {nombre}", b: "", extra: "z" },
      de: { a: "Hallo {name}", b: "x", c: "y" },
    });
    expect(problems).toContain("en: placeholders differ from es at a");
    expect(problems).toContain("en: empty string at b");
    expect(problems).toContain("en: missing key c");
    expect(problems).toContain("es: missing key extra");
    expect(problems).toContain("de: missing key extra");
  });

  it("getDictionary, localeFor and fmt", () => {
    expect(getDictionary("de")).toBe(de);
    expect(localeFor("de")).toBe("de-DE");
    expect(fmt("Hallo {name}, {n}", { name: "Fede", n: 2 })).toBe(
      "Hallo Fede, 2"
    );
    expect(fmt("Hi {x}", {})).toBe("Hi {x}");
  });
});
