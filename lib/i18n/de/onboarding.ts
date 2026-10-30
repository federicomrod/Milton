import type { Dictionary } from "../types";

export const onboarding: Dictionary["onboarding"] = {
  fallbackName: "Ihr Restaurant",
  step1: {
    title: "Ihr Restaurant",
    subtitle: "Wir richten {restaurantName} ein.",
    conceptLabel: "Was beschreibt es am besten?",
    countryLabel: "Wo befindet es sich?",
    countryPlaceholder: "Land auswählen",
    languageLabel: "In welcher Sprache soll Milton mit Ihnen sprechen?",
  },
  step2: {
    title: "Ihr Betrieb",
    locationsLabel: "Wie viele Standorte haben Sie?",
    posLabel: "Welches Kassensystem verwenden Sie?",
  },
  step3: {
    title: "Wobei soll Milton Ihnen helfen?",
    subtitle: "Wählen Sie bis zu {max}.",
  },
  step4: {
    heading: "Milton ist bereit für {restaurantName}.",
    subtitle: "Ein guter Einstieg:",
    recommended: "Empfohlen",
    goToCockpit: "Zum Cockpit",
  },
  nav: {
    back: "Zurück",
    next: "Weiter",
    skip: "Überspringen",
    finish: "Los geht's",
    saving: "Wird eingerichtet…",
  },
  concept: {
    restaurant: "Restaurant",
    bar: "Bar",
    cafe: "Café",
    bakery: "Bäckerei",
    fastCasual: "Schnellrestaurant",
    other: "Andere",
  },
  pos: {
    other: "Andere",
    unknown: "Weiß ich nicht",
  },
  priority: {
    margins: "Meine Margen verstehen",
    foodCost: "Wareneinsatz kontrollieren",
    sales: "Meinen Umsatz verstehen",
    inventory: "Meinen Bestand führen",
    waste: "Abfall reduzieren",
    forecast: "Nachfrage prognostizieren",
  },
  country: {
    MX: "Mexiko",
    US: "USA",
    CA: "Kanada",
    AR: "Argentinien",
    BR: "Brasilien",
    CL: "Chile",
    CO: "Kolumbien",
    SV: "El Salvador",
    GT: "Guatemala",
    ES: "Spanien",
    DE: "Deutschland",
    IT: "Italien",
    CH: "Schweiz",
    PE: "Peru",
    GB: "Vereinigtes Königreich",
    PT: "Portugal",
    OTHER: "Anderes",
  },
  nextSteps: {
    connectPosTitle: "Kassensystem verbinden",
    connectPosOdooDescription:
      "Verbinden Sie Odoo oder laden Sie eine Umsatzdatei hoch, um heute zu starten.",
    connectPosOdooCta: "Umsätze hochladen",
    connectPosDescription:
      "Holen Sie Ihre Umsätze herein, um echte Zahlen zu sehen.",
    connectPosCta: "Starten",
    uploadSalesTitle: "Umsätze hochladen",
    uploadSalesDescription:
      "Importieren Sie eine Datei aus Ihrem Kassensystem und sehen Sie Ihr Cockpit mit echten Daten.",
    uploadSalesCta: "Jetzt hochladen",
    addRecipesTitle: "Rezepte und Kosten hinzufügen",
    addRecipesDescription:
      "Erfassen Sie Ihre Rezepte, damit Milton echte Margen berechnen kann.",
    addRecipesCta: "Rezepte hinzufügen",
  },
  errors: {
    finishFailed:
      "Die Einrichtung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
    finishFailedShort: "Die Einrichtung konnte nicht abgeschlossen werden.",
  },
  addRestaurant: {
    title: "Restaurant hinzufügen",
    description:
      "Fügen Sie Ihrem Konto ein weiteres Restaurant hinzu. Sie können jederzeit zwischen ihnen wechseln.",
    nameLabel: "Name des Restaurants",
    namePlaceholder: "z. B. Casa Centro",
    conceptLabel: "Was beschreibt es am besten?",
    countryLabel: "Land",
    countryPlaceholder: "Land auswählen",
    posLabel: "Kassensystem",
    adding: "Wird hinzugefügt…",
    submit: "Restaurant hinzufügen",
    failed:
      "Das Restaurant konnte nicht hinzugefügt werden. Bitte versuchen Sie es erneut.",
  },
};
