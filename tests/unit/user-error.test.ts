import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { userErrorMessage } from "@/lib/restaurant/user-error";

const FALLBACK = "No se pudo guardar. Inténtalo de nuevo.";

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ERROR_LITERAL =
  /\berror:\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.|\$\{[^}]*\})*)`)/g;

function collectRestaurantApiErrors(): string[] {
  const root = path.join(process.cwd(), "app/api/restaurant");
  const found: string[] = [];
  for (const file of walkTsFiles(root)) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(ERROR_LITERAL)) {
      const raw = match[1] ?? match[2];
      if (!raw) continue;
      found.push(raw.replace(/\$\{[^}]*\}/g, "X"));
    }
  }
  return [...new Set(found)];
}

function isSpanishError(text: string): boolean {
  if (/[áéíóúüñÁÉÍÓÚÜÑ¿¡]/.test(text)) return true;
  return /\b(el|la|los|las|un|una|de|del|que|es|ya|hay|ese|esa|debe|deben|tiene|tienen|faltan|demasiados|pude|pudo|nombre|empresa|archivo|cuerpo|nada|actualizar|cantidades|columnas|obligatorio|tratamiento|elementos|formato|turnos)\b/i.test(
    text
  );
}

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
      userErrorMessage({ error: "El nombre es obligatorio." }, FALLBACK)
    ).toBe("El nombre es obligatorio.");
    expect(
      userErrorMessage({ error: "Esa marca no es de esta empresa." }, FALLBACK)
    ).toBe("Esa marca no es de esta empresa.");
    expect(
      userErrorMessage(
        { error: "Ya hay un grupo con ese nombre en ese lugar." },
        FALLBACK
      )
    ).toBe("Ya hay un grupo con ese nombre en ese lugar.");
    expect(
      userErrorMessage({ error: "Faltan columnas obligatorias." }, FALLBACK)
    ).toBe("Faltan columnas obligatorias.");
    expect(
      userErrorMessage(
        { error: "Los turnos no tienen el formato esperado." },
        FALLBACK
      )
    ).toBe("Los turnos no tienen el formato esperado.");
    expect(
      userErrorMessage({ error: "Ese tratamiento no existe." }, FALLBACK)
    ).toBe("Ese tratamiento no existe.");
    expect(
      userErrorMessage(
        { error: "Escribe un nombre de empresa (hasta 120 letras)." },
        FALLBACK
      )
    ).toBe("Escribe un nombre de empresa (hasta 120 letras).");
    expect(userErrorMessage({ error: "Demasiados elementos." }, FALLBACK)).toBe(
      "Demasiados elementos."
    );
    expect(
      userErrorMessage(
        { error: "start_date debe ser anterior o igual a end_date." },
        FALLBACK
      )
    ).toBe("start_date debe ser anterior o igual a end_date.");
    expect(
      userErrorMessage(
        { error: "Las cantidades tienen que ser mayores que 0." },
        FALLBACK
      )
    ).toBe("Las cantidades tienen que ser mayores que 0.");
    expect(
      userErrorMessage({ error: "No hay nada que actualizar." }, FALLBACK)
    ).toBe("No hay nada que actualizar.");
  });

  it("passes through every Spanish error literal in restaurant API routes", () => {
    const literals = collectRestaurantApiErrors();
    const spanish = literals.filter(isSpanishError);
    expect(spanish.length).toBeGreaterThan(20);
    for (const msg of spanish) {
      expect(userErrorMessage({ error: msg }, FALLBACK), msg).toBe(msg);
    }
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
    expect(userErrorMessage({ error: "Nothing to update" }, FALLBACK)).toBe(
      FALLBACK
    );
    expect(
      userErrorMessage({ error: "Could not add restaurant" }, FALLBACK)
    ).toBe(FALLBACK);
    expect(userErrorMessage({ error: "`name` is required" }, FALLBACK)).toBe(
      FALLBACK
    );
    expect(
      userErrorMessage(
        { error: "start_date must be on or before end_date" },
        FALLBACK
      )
    ).toBe(FALLBACK);
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
