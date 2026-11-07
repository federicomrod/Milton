export const support = {
  banner: {
    label: "Modo soporte · {company}",
    exit: "Salir",
    exiting: "Saliendo…",
    exitFailed: "No se pudo salir. Inténtalo de nuevo.",
  },
  switcher: {
    company: "Empresa",
    support: "Soporte",
    switchFailed: "No se pudo cambiar de empresa.",
  },
  team: {
    label: "Soporte Milton",
    note: "Acceso del equipo de Milton. Puedes quitarlo cuando quieras.",
  },
  clients: {
    nav: "Clientes",
    title: "Clientes",
    intro:
      "Abre la cuenta de un cliente como soporte. Cada acceso queda registrado.",
    open: "Abrir cuenta",
    opening: "Abriendo…",
    current: "Cuenta activa",
    none: "No hay clientes.",
    recentTitle: "Accesos recientes",
    colWho: "Quién",
    colCompany: "Empresa",
    colWhen: "Cuándo",
    recentNone: "Aún no hay accesos.",
    loadFailed: "No se pudieron cargar los clientes.",
    errors: {
      forbidden: "Solo el equipo de Milton puede abrir cuentas.",
      company: "No encontré esa empresa.",
      migration: "Falta aplicar la migración 072 en este ambiente.",
      failed: "No se pudo abrir la cuenta. Inténtalo de nuevo.",
    },
  },
} as const;
