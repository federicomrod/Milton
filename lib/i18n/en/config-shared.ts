import type { Dictionary } from "../types";

export const configShared: Dictionary["config"]["shared"] = {
  title: "Settings",
  indexAria: "Settings sections",
  nav: {
    ajustes: "Settings",
    restaurantes: "Restaurants",
    conexiones: "Connections",
    objetivos: "Targets",
    turnos: "Shifts",
    equipo: "Team and access",
    cuenta: "My account",
  },
  edit: "Edit",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  missing: "Missing: add",
  saved: "Saved",
  saveFailed: "Couldn't save. Your entries are still here.",
  unsaved: "You have unsaved changes. Leave without saving?",
  readOnly: "Only the owner can change this.",
  noCompany: "No company is connected.",
};
