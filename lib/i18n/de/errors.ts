import type { Dictionary } from "../types";

export const errors: Dictionary["errors"] = {
  company: {
    readFailed: "Ihr Unternehmen konnte nicht gelesen werden.",
    nameRequired: "Geben Sie einen Unternehmensnamen ein (bis zu 120 Zeichen).",
    nothingToSave: "Es gibt nichts zu speichern.",
    languageInvalid: "Wählen Sie eine gültige Sprache.",
    saveNameFailed: "Der Unternehmensname konnte nicht gespeichert werden.",
    saveLanguageFailed: "Die Sprache konnte nicht gespeichert werden.",
  },
};
