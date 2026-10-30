import type { Dictionary } from "../types";

export const ask: Dictionary["ask"] = {
  page: { title: "Ask Milton" },
  api: {
    invalidJson: "Der Anfragetext ist kein gültiges JSON.",
    messageRequired: "Bitte geben Sie eine Frage ein.",
    messageTooLong: "Die Frage ist zu lang (höchstens {max} Zeichen).",
    contextFailed: "Der Kontext für Milton konnte nicht vorbereitet werden.",
  },
};
