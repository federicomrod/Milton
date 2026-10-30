import type { Dictionary } from "../types";

export const comms: Dictionary["comms"] = {
  api: {
    briefingContextFailed: "Das Briefing konnte nicht vorbereitet werden.",
    prefsLoadFailed: "Die Zustelleinstellungen konnten nicht geladen werden.",
    prefsSaveFailed: "Die Einstellungen konnten nicht gespeichert werden.",
    bodyNotJson: "Der Anfragetext ist kein gültiges JSON.",
    cadenceInvalid:
      "Die Häufigkeit muss „aus“, „täglich“ oder „wöchentlich“ sein.",
    recipientRequired:
      "Bei täglicher oder wöchentlicher Zustellung ist eine gültige E-Mail-Adresse erforderlich.",
    timezoneRequired:
      "Bei täglicher oder wöchentlicher Zustellung ist eine gültige Zeitzone erforderlich.",
    recipientLookupFailed:
      "Der Empfänger des Briefings konnte nicht abgerufen werden.",
    recipientMissing:
      "Es ist keine E-Mail-Adresse für das Briefing hinterlegt.",
    recipientMissingHelp:
      "Speichern Sie in den Zustelleinstellungen des Briefings eine E-Mail-Adresse, bevor Sie einen Test senden.",
    briefingGenerateFailed: "Das Briefing konnte nicht erstellt werden.",
  },
  emailCard: {
    title: "Zustellung des Briefings",
    description: "Erhalten Sie das Milton-Briefing per E-Mail",
    loading: "Wird geladen …",
    cadence: "Häufigkeit",
    cadenceOff: "Aus",
    cadenceDaily: "Täglich",
    cadenceWeekly: "Wöchentlich",
    recipient: "Empfänger-E-Mail",
    invalidEmail: "Geben Sie eine gültige E-Mail-Adresse ein.",
    weekday: "Wochentag",
    weekdays: [
      "Sonntag",
      "Montag",
      "Dienstag",
      "Mittwoch",
      "Donnerstag",
      "Freitag",
      "Samstag",
    ],
    timezone: "Zeitzone der Zustellung",
    timezonePlaceholder: "Zeitzone wählen",
    timezoneMissing: "Die Zeitzone fehlt: Wählen Sie sie oben aus.",
    save: "Speichern",
    saving: "Wird gespeichert …",
    saved: "Gespeichert.",
    sendTest: "Test-E-Mail senden",
    sending: "Wird gesendet …",
    sentTo: "Gesendet. Prüfen Sie {recipient}.",
    sentToInbox: "Gesendet. Prüfen Sie Ihren Posteingang.",
    loadFailed: "Die Zustelleinstellungen konnten nicht geladen werden.",
    saveFailed: "Die Einstellungen konnten nicht gespeichert werden.",
    testFailed:
      "Die Test-E-Mail konnte nicht gesendet werden. Versuchen Sie es erneut.",
  },
};
