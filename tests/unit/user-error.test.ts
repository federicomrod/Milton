import { describe, expect, it } from "vitest";
import { userErrorMessage } from "@/lib/restaurant/user-error";

const FALLBACK = "No se pudo guardar. Inténtalo de nuevo.";

describe("userErrorMessage", () => {
  it("passes through a Spanish error with an accent or ñ", () => {
    expect(
      userErrorMessage({ error: "No encontré la factura." }, FALLBACK)
    ).toBe("No encontré la factura.");
    expect(
      userErrorMessage({ error: "El archivo está vacío." }, FALLBACK)
    ).toBe("El archivo está vacío.");
  });

  it("passes through a Spanish error that uses a common Spanish word", () => {
    expect(
      userErrorMessage({ error: "El cuerpo tiene que ser JSON." }, FALLBACK)
    ).toBe("El cuerpo tiene que ser JSON.");
    expect(userErrorMessage({ error: "Sube un archivo." }, FALLBACK)).toBe(
      "Sube un archivo."
    );
    expect(
      userErrorMessage(
        { error: "Los ingredientes son de familias de unidad distintas." },
        FALLBACK
      )
    ).toBe("Los ingredientes son de familias de unidad distintas.");
    expect(
      userErrorMessage({ error: "Tu rol no puede cambiar precios." }, FALLBACK)
    ).toBe("Tu rol no puede cambiar precios.");
    expect(
      userErrorMessage(
        { error: "No tienes permiso para cambiar esto." },
        FALLBACK
      )
    ).toBe("No tienes permiso para cambiar esto.");
  });

  it("returns the fallback for English errors", () => {
    expect(userErrorMessage({ error: "Invoice not found" }, FALLBACK)).toBe(
      FALLBACK
    );
    expect(userErrorMessage({ error: "Empty file" }, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage({ error: "No file uploaded" }, FALLBACK)).toBe(
      FALLBACK
    );
    expect(userErrorMessage({ error: "Body must be JSON" }, FALLBACK)).toBe(
      FALLBACK
    );
  });

  it("returns the fallback for empty and non-string errors", () => {
    expect(userErrorMessage({ error: "" }, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage({ error: "   " }, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage({ error: 404 }, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage({ error: null }, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage("No encontré la factura.", FALLBACK)).toBe(
      FALLBACK
    );
  });
});
