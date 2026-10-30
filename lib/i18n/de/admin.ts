import type { Dictionary } from "../types";

export const admin: Dictionary["admin"] = {
  api: {
    signInAgain: "Bitte melden Sie sich erneut an.",
    companyInvalid: "Das Unternehmen ist ungültig.",
    noCompanyAccess: "Sie haben keinen Zugriff auf dieses Unternehmen.",
    accountLoadFailed: "Ihr Konto konnte nicht geladen werden.",
    signupVerifyFailed:
      "Die Registrierung konnte nicht überprüft werden. Bitte versuchen Sie es erneut.",
    signupPendingInvite:
      "Für diese E-Mail-Adresse liegt eine Einladung vor. Bitte aktivieren Sie Ihr Konto über den Einladungslink.",
    locationNotFound: "Restaurant nicht gefunden.",
    bodyMustBeJson: "Der Inhalt muss JSON sein.",
    locationsReadFailed: "Ihre Restaurants konnten nicht gelesen werden.",
    archiveFailed: "Das Restaurant konnte nicht archiviert werden.",
    nameSaveFailed: "Der Name konnte nicht gespeichert werden.",
    pickRestaurant: "Wählen Sie ein Restaurant.",
    shiftsBadFormat: "Die Schichten haben nicht das erwartete Format.",
    shiftsSaveFailed: "Die Schichten konnten nicht gespeichert werden.",
    targetsSaveFailed: "Die Ziele konnten nicht gespeichert werden.",
    forbidden: "Sie haben keine Berechtigung, dies zu ändern.",
    restaurantInvalid: "Ungültiges Restaurant.",
    valueInvalid: "Ungültiger Wert für {metric}.",
    nothingToSave: "Es gibt nichts zu speichern.",
    comparisonInvalid: "Ungültiger Vergleich.",
    dailySplitInvalid: "Die Tagesverteilung ist ungültig.",
    effectiveFromInvalid: "Das Datum „Gültig ab“ ist ungültig.",
    targetsMigrationMissing:
      "Migration 052 wurde in dieser Umgebung noch nicht angewendet.",
    shiftsMigrationMissing:
      "Migration 054 wurde in dieser Umgebung noch nicht angewendet: Schichten können noch nicht gespeichert werden.",
    archiveMigrationMissing:
      "Migration 055 wurde in dieser Umgebung noch nicht angewendet: Archivieren ist noch nicht möglich.",
  },
  capabilities: {
    recipesEdit: "Ihre Rolle darf keine Rezepte bearbeiten.",
    recipesSubmit: "Ihre Rolle darf keine Rezepte zur Freigabe einreichen.",
    recipesApprove: "Ihre Rolle darf keine Rezepte freigeben.",
    pricesEdit: "Ihre Rolle darf keine Preise ändern.",
    linksConfirm: "Ihre Rolle darf keine Produkte verknüpfen.",
    ingredientsManage: "Ihre Rolle darf keine Zutaten ändern.",
    menuManage: "Ihre Rolle darf keine Gerichte der Speisekarte ändern.",
    groupsManage: "Ihre Rolle darf keine Gruppierungen ändern.",
    locationsArchive: "Ihre Rolle darf keine Restaurants archivieren.",
    targetsEdit: "Ihre Rolle darf keine Ziele ändern.",
    shiftsEdit: "Ihre Rolle darf keine Schichten ändern.",
    costsFixed: "Ihre Rolle darf Fixkosten weder ansehen noch ändern.",
    importsRun: "Ihre Rolle darf keine Rezepte importieren.",
    companyEdit: "Ihre Rolle darf die Unternehmensdaten nicht ändern.",
  },
  odoo: {
    title: "Umsätze aus Odoo synchronisieren",
    intro:
      "Übernimmt abgeschlossene Kassenbestellungen in Milton. Sie können bis zu {days} Tage auf einmal synchronisieren.",
    quickRange: "Schnellauswahl",
    presetYesterday: "Gestern",
    presetLast7Days: "Letzte 7 Tage",
    presetThisMonth: "Dieser Monat",
    presetLastMonth: "Letzter Monat",
    startDate: "Startdatum",
    endDate: "Enddatum",
    syncing: "Synchronisiere …",
    syncNow: "Jetzt synchronisieren",
    syncingLong:
      "Umsätze werden synchronisiert … ein ganzer Monat kann eine Minute dauern.",
    toastTitle: "Umsätze aktualisiert",
    viewReasons: "Gründe anzeigen",
    viewList: "Liste anzeigen",
    warnings: "Hinweise",
  },
};
