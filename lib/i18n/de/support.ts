import type { Dictionary } from "../types";

export const support: Dictionary["support"] = {
  banner: {
    label: "Support-Modus · {company}",
    exit: "Beenden",
    exiting: "Wird beendet…",
    exitFailed: "Beenden nicht möglich. Bitte erneut versuchen.",
  },
  switcher: {
    company: "Unternehmen",
    support: "Support",
    switchFailed: "Wechsel des Unternehmens nicht möglich.",
  },
  team: {
    label: "Milton Support",
    note: "Zugang des Milton-Teams. Sie können ihn jederzeit entfernen.",
  },
  clients: {
    nav: "Kunden",
    title: "Kunden",
    intro:
      "Öffnen Sie das Konto eines Kunden als Support. Jeder Zugriff wird protokolliert.",
    open: "Konto öffnen",
    opening: "Wird geöffnet…",
    current: "Aktives Konto",
    none: "Keine Kunden.",
    recentTitle: "Letzte Zugriffe",
    colWho: "Wer",
    colCompany: "Unternehmen",
    colWhen: "Wann",
    recentNone: "Noch keine Zugriffe.",
    loadFailed: "Die Kunden konnten nicht geladen werden.",
    errors: {
      forbidden: "Nur das Milton-Team kann Konten öffnen.",
      company: "Dieses Unternehmen wurde nicht gefunden.",
      migration:
        "Migration 072 wurde in dieser Umgebung noch nicht angewendet.",
      failed: "Das Konto konnte nicht geöffnet werden. Bitte erneut versuchen.",
    },
  },
};
