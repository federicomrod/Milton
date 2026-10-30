// Configuración › Objetivos y Turnos (read-only summaries; the editors keep
// their strings in settings.goals / settings.shifts).
export const configGoals = {
  monthlySales: "Ventas mensuales",
  foodCost: "Costo de comida",
  grossMargin: "Margen bruto",
  avgTicket: "Ticket promedio",
  comparison: "Comparación en Cockpit",
  defaultValue: "Por defecto: {value}",
  inheritedAll: "{value} (todos los restaurantes)",
  perDay: "{amount} por día",
  shifts: {
    noRestaurants: "Aún no hay restaurantes para definir turnos.",
    edit: "Editar turnos",
    colShift: "Turno",
    colHours: "Horario",
    colDays: "Días",
    colActive: "Activo",
    yes: "Sí",
    no: "No",
    none: "Sin turnos",
  },
} as const;
