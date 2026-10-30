import type { Dictionary } from "../types";

export const configAjustes: Dictionary["config"]["ajustes"] = {
  language: {
    label: "Language",
    aria: "Milton language",
    hint: "Applies to the whole app, the briefings and your company's notices.",
    saved: "Language saved.",
    saveFailed: "We could not save the language. Try again.",
  },
  prefs: {
    timezone: "Time zone",
    currency: "Currency",
    currencyHint: "It comes from your restaurant's data.",
    format: "Format",
    dateFormat: "Date",
    numberFormat: "Numbers",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    saved: "Saved",
    saveFailed: "We could not save your preference. Try again.",
  },
  company: {
    name: "Name",
    legalName: "Legal name",
    taxId: "Tax ID",
    address: "Address",
    unavailable: "This information is not available on your account yet.",
  },
  errors: {
    nameRequired: "Enter a name (up to 120 characters).",
    legalNameTooLong: "The legal name allows up to 160 characters.",
    taxIdTooLong: "The tax ID allows up to 40 characters.",
    addressTooLong: "The address allows up to 240 characters.",
    fieldInvalid: "Check this value.",
    notAvailable:
      "Legal name, tax ID and address are not available yet. Try again later.",
    saveFailed: "I could not save the company details.",
  },
};
