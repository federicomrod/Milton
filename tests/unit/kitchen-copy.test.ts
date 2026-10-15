import { describe, it, expect } from "vitest";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";

// Sofia's strings, verbatim (bold markers dropped; send.ts is plain text).
describe("kitchen copy", () => {
  it("R1–R6 (+R5a/R5b) and R7–R8 equal Sofia's strings exactly", () => {
    expect(KITCHEN_COPY.JOINED).toBe(
      "✅ ¡Listo! Ya estás en Milton de {local}. Cuando algo se acabe, se tire o quieras mandar una receta, mándalo aquí: texto, nota de voz o foto."
    );
    expect(KITCHEN_COPY.QR_INVALID).toBe(
      "Este QR ya no funciona. Pide al encargado el código actualizado."
    );
    expect(KITCHEN_COPY.ALREADY_JOINED).toBe(
      "Ya estás en Milton de {local}. No tienes que hacer nada más."
    );
    expect(KITCHEN_COPY.MOVED).toBe(
      "🔄 Ahora estás en {local nuevo}. Lo que mandes desde ya va a {local nuevo}, no a {local anterior}."
    );
    expect(KITCHEN_COPY.REPORT_ACK).toBe(
      "✅ Recibido, gracias. Se lo pasamos al encargado de {nombre_local}."
    );
    expect(KITCHEN_COPY.REPORT_ACK_RUNNING_OUT).toBe(
      "✅ Anotado: se acabó o queda poco de {producto}. Gracias por avisar."
    );
    expect(KITCHEN_COPY.REPORT_ACK_WASTE).toBe(
      "✅ Anotada la merma. Gracias por avisar."
    );
    expect(KITCHEN_COPY.RATE_LIMITED).toBe(
      "Ahora mismo hay muchos ingresos con este código. Prueba de nuevo en unos minutos o pide ayuda al encargado."
    );
    expect(KITCHEN_COPY.RECIPE_RECEIVED).toBe(
      "✅ Recibida la receta de {plato}. El encargado la revisa antes de que cuente en los costos."
    );
    expect(KITCHEN_COPY.RECIPE_ASK_PORTIONS).toBe(
      "¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2."
    );
  });

  it("has no markdown bold markers", () => {
    for (const s of Object.values(KITCHEN_COPY)) expect(s).not.toContain("**");
  });

  it("renders placeholders", () => {
    expect(
      renderKitchenCopy(KITCHEN_COPY.JOINED, { local: "Roma Norte" })
    ).toContain("Milton de Roma Norte.");
    expect(
      renderKitchenCopy(KITCHEN_COPY.MOVED, {
        "local nuevo": "Condesa",
        "local anterior": "Roma",
      })
    ).toBe(
      "🔄 Ahora estás en Condesa. Lo que mandes desde ya va a Condesa, no a Roma."
    );
    expect(renderKitchenCopy("hola {x}")).toBe("hola {x}");
  });

  it("the report path always uses the generic R5 (checked in the webhook content test)", () => {
    expect(KITCHEN_COPY.REPORT_ACK).toMatch(/Recibido, gracias/);
  });
});
