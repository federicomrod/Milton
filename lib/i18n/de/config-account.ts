import type { Dictionary } from "../types";

export const configAccount: Dictionary["config"]["account"] = {
  name: "Name",
  nameHint: "Ihr Name",
  nameFailed:
    "Der Name konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.",
  nameRequired: "Geben Sie Ihren Namen ein.",
  email: "E-Mail",
  emailNote:
    "Die E-Mail-Adresse ist schreibgeschützt: Eine Änderung erfordert eine Bestätigung.",
  password: "Passwort",
  changePassword: "Passwort ändern",
  newPassword: "Neues Passwort",
  confirmPassword: "Passwort wiederholen",
  passwordShort: "Mindestens 8 Zeichen.",
  passwordMismatch: "Die Passwörter stimmen nicht überein.",
  passwordChanged: "Passwort geändert",
  passwordFailed:
    "Das Passwort konnte nicht geändert werden. Versuchen Sie es erneut.",
  notifications: "Benachrichtigungen",
  briefingEmail: "Briefing per E-Mail",
  briefingTelegram: "Briefing per Telegram",
  off: "Aus",
  daily: "Täglich",
  weekly: "Wöchentlich",
  connected: "Verbunden",
  notConnected: "Nicht verbunden",
  loadFailed: "Konnte nicht geladen werden.",
  close: "Fertig",
  status: "Kontostatus",
  plan: "Tarif",
  freeTrial: "Kostenlose Testphase",
  memberSince: "Mitglied seit",
};
