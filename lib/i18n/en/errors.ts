import type { Dictionary } from "../types";

export const errors: Dictionary["errors"] = {
  company: {
    readFailed: "I could not read your company.",
    nameRequired: "Enter a company name (up to 120 characters).",
    nothingToSave: "There is nothing to save.",
    languageInvalid: "Choose a valid language.",
    saveNameFailed: "I could not save the company name.",
    saveLanguageFailed: "I could not save the language.",
  },
};
