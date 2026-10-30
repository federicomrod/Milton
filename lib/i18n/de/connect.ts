import type { Dictionary } from "../types";

export const connect: Dictionary["connect"] = {
  header: "Verbinden Sie Ihre Daten, damit Milton echte Zahlen anzeigen kann",
  subheader:
    "Wählen Sie, wie Ihre Umsatzdaten zu Milton gelangen. Sie können das später ändern.",
  skip: "Vorerst überspringen → Übersicht",
  recommended: "Passt zu Ihrer Kasse",
  requestSent: "Danke, wir melden uns bei Ihnen",
  requestError: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  notePlaceholder: "Gibt es etwas, das wir wissen sollten? (optional)",
  otherTextLabel: "Wo liegen Ihre Umsatzdaten derzeit?",
  otherTextPlaceholder:
    "z. B. unsere Kasse heißt … / wir führen die Umsätze in …",
  otherSubmit: "Senden",
  sendRequest: "Anfrage senden",
  sending: "Wird gesendet …",
  comingSoon: "Demnächst",
  options: {
    spreadsheet: {
      title: "Excel- / Tabellen-Upload",
      description:
        "Funktioniert heute. Hinweis: Der Upload erwartet derzeit das Umsatzformat auf Artikelebene (die Spalten „Customer Items“ von Revel), daher lassen sich noch nicht alle Tabellen importieren.",
      upload: "Tabelle hochladen",
    },
    revel: {
      title: "Revel",
      description:
        "Laden Sie heute einen Export „Customer Items“ von Revel hoch. Die Live-Synchronisierung mit Revel folgt bald: Fragen Sie sie an, wir informieren Sie.",
      export: "Revel-Export hochladen",
      request: "Anfragen",
    },
    odoo: {
      title: "Odoo",
      description:
        "Das Milton-Team verbindet Odoo während der Pilotphase für Sie.",
      connect: "Odoo verbinden",
      sent: "Danke! Das Milton-Team verbindet Odoo für Sie. Wir melden uns zur Einrichtung bei Ihnen.",
    },
    other: {
      title: "Anderes / sagen Sie uns, wo Ihre Daten liegen",
      description:
        "Nutzen Sie etwas anderes? Sagen Sie uns, wo Ihre Umsatzdaten liegen, wir prüfen das.",
      send: "Senden",
    },
  },
  picks: {
    square: "Square",
    toast: "Toast",
    other: "Andere",
  },
  api: {
    atLeastOneProduct: "Geben Sie mindestens ein Produkt an.",
    bodyMustBeJson: "Der Inhalt muss JSON sein.",
    companyNotFound: "Ich habe das Unternehmen nicht gefunden.",
    datesOrder:
      "start_date muss vor end_date liegen oder mit ihm übereinstimmen.",
    datesTogether:
      "start_date und end_date müssen zusammen angegeben werden, im Format YYYY-MM-DD.",
    fileEmpty: "Die Datei ist leer.",
    linkChangeFailed: "Ich konnte die Verknüpfung nicht ändern.",
    linkChangeMissing: "Geben Sie das Odoo-Produkt und das Rezept an.",
    linkCreateMissing: "Geben Sie das Odoo-Produkt und seinen Namen an.",
    missingColumns: "Pflichtspalten fehlen.",
    noSheets: "Die Datei enthält keine Tabellenblätter.",
    noValidRows: "Es gibt keine gültigen Zeilen zum Speichern.",
    odooProductIdMissing: "odoo_product_id fehlt.",
    recipeCreateFailed: "Ich konnte das Rezept nicht anlegen.",
    replaceFailed: "Ich konnte die vorhandenen Zeilen nicht ersetzen.",
    resaleCreateFailed: "Ich konnte die Wareneinsatzkosten nicht anlegen.",
    resaleMissing:
      "Geben Sie das Odoo-Produkt, den Einkauf und die Einheit an.",
    rowsSaveFailed: "Ich konnte die Zeilen nicht speichern.",
    telegramAlreadyConnected:
      "Für dieses Restaurant ist bereits ein Telegram-Chat verbunden.",
    treatmentMissing: "Geben Sie das Odoo-Produkt und die Kalkulationsart an.",
    treatmentSaveFailed: "Ich konnte die Kalkulationsart nicht speichern.",
    undoFailed: "Ich konnte die Bestätigung nicht rückgängig machen.",
    uploadFailed: "Die Datei konnte nicht hochgeladen werden.",
    uploadFile: "Laden Sie eine Datei hoch.",
    fileTooBigMb: "Die Datei ist größer als {mb} MB.",
    salesUploadDenied: "Ihre Rolle darf keine Umsätze hochladen.",
  },
};
