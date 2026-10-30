import type { Dictionary } from "../types";

export const configGoals: Dictionary["config"]["goals"] = {
  monthlySales: "Monthly sales",
  foodCost: "Food cost",
  grossMargin: "Gross margin",
  avgTicket: "Average ticket",
  comparison: "Cockpit comparison",
  defaultValue: "Default: {value}",
  inheritedAll: "{value} (all restaurants)",
  perDay: "{amount} per day",
  shifts: {
    noRestaurants: "There are no restaurants to set shifts for yet.",
    edit: "Edit shifts",
    colShift: "Shift",
    colHours: "Hours",
    colDays: "Days",
    colActive: "Active",
    yes: "Yes",
    no: "No",
    none: "No shifts",
  },
};
