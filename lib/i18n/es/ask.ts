export const ask = {
  page: { title: "Preguntar a Milton" },
  api: {
    invalidJson: "El cuerpo de la solicitud no es JSON válido.",
    messageRequired: "Escribe una pregunta.",
    messageTooLong: "La pregunta es demasiado larga (máximo {max} caracteres).",
    contextFailed: "No se pudo preparar el contexto de Milton.",
  },
} as const;
