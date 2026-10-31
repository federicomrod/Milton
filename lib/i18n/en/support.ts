import type { Dictionary } from "../types";

export const support: Dictionary["support"] = {
  banner: {
    label: "Support mode · {company}",
    exit: "Exit",
    exiting: "Exiting…",
    exitFailed: "Couldn't exit. Try again.",
  },
  switcher: {
    company: "Company",
    support: "Support",
    switchFailed: "Couldn't switch company.",
  },
  team: {
    label: "Milton Support",
    note: "Access for the Milton team. You can remove it any time.",
  },
  clients: {
    nav: "Clients",
    title: "Clients",
    intro: "Open a client's account as support. Every open is logged.",
    open: "Open account",
    opening: "Opening…",
    current: "Active account",
    none: "No clients.",
    recentTitle: "Recent opens",
    colWho: "Who",
    colCompany: "Company",
    colWhen: "When",
    recentNone: "No opens yet.",
    loadFailed: "Couldn't load the clients.",
    errors: {
      forbidden: "Only the Milton team can open accounts.",
      company: "I couldn't find that company.",
      migration: "Migration 072 has not been applied in this environment.",
      failed: "Couldn't open the account. Try again.",
    },
  },
};
