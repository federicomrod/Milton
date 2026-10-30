import type { Dictionary } from "../types";

export const configGoals: Dictionary["config"]["goals"] = {
  monthlySales: "Monatsumsatz",
  foodCost: "Wareneinsatz",
  grossMargin: "Bruttomarge",
  avgTicket: "Durchschnittsbon",
  comparison: "Vergleich im Cockpit",
  defaultValue: "Standard: {value}",
  inheritedAll: "{value} (alle Restaurants)",
  perDay: "{amount} pro Tag",
  shifts: {
    noRestaurants: "Es gibt noch keine Restaurants für Schichten.",
    edit: "Schichten bearbeiten",
    colShift: "Schicht",
    colHours: "Zeiten",
    colDays: "Tage",
    colActive: "Aktiv",
    yes: "Ja",
    no: "Nein",
    none: "Keine Schichten",
  },
};
