import type { Dictionary } from "../types";

export const configAjustes: Dictionary["config"]["ajustes"] = {
  language: {
    label: "Sprache",
    aria: "Sprache von Milton",
    hint: "Gilt für die ganze App, die Briefings und die Hinweise Ihres Unternehmens.",
    saved: "Sprache gespeichert.",
    saveFailed:
      "Die Sprache konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  },
  prefs: {
    timezone: "Zeitzone",
    currency: "Währung",
    currencyHint: "Sie ergibt sich aus den Daten Ihres Restaurants.",
    format: "Format",
    dateFormat: "Datum",
    numberFormat: "Zahlen",
    theme: "Design",
    themeLight: "Hell",
    themeDark: "Dunkel",
    themeSystem: "System",
    saved: "Gespeichert",
    saveFailed:
      "Ihre Einstellung konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  },
  company: {
    name: "Name",
    legalName: "Firmenname",
    taxId: "Steuernummer",
    address: "Adresse",
    unavailable: "Diese Angaben sind in Ihrem Konto noch nicht verfügbar.",
  },
  errors: {
    nameRequired: "Geben Sie einen Namen ein (bis zu 120 Zeichen).",
    legalNameTooLong: "Der Firmenname darf bis zu 160 Zeichen lang sein.",
    taxIdTooLong: "Die Steuernummer darf bis zu 40 Zeichen lang sein.",
    addressTooLong: "Die Adresse darf bis zu 240 Zeichen lang sein.",
    fieldInvalid: "Prüfen Sie diese Angabe.",
    notAvailable:
      "Firmenname, Steuernummer und Adresse sind noch nicht verfügbar. Versuchen Sie es später erneut.",
    saveFailed: "Die Unternehmensdaten konnten nicht gespeichert werden.",
  },
};
