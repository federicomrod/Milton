export const connect = {
  header: "Conecta tus datos para que Milton muestre números reales",
  subheader:
    "Elige cómo llegarán tus datos de ventas a Milton. Puedes cambiarlo después.",
  skip: "Omitir por ahora → panel",
  recommended: "Coincide con tu POS",
  requestSent: "Gracias, te respondemos pronto",
  requestError: "Algo salió mal. Inténtalo de nuevo.",
  notePlaceholder: "¿Algo que debamos saber? (opcional)",
  otherTextLabel: "¿Dónde guardas hoy tus datos de ventas?",
  otherTextPlaceholder:
    "p. ej. nuestro POS se llama … / llevamos las ventas en …",
  otherSubmit: "Enviar",
  sendRequest: "Enviar solicitud",
  sending: "Enviando…",
  comingSoon: "Próximamente",
  options: {
    spreadsheet: {
      title: "Carga de Excel / hoja de cálculo",
      description:
        "Funciona hoy. Ojo: el cargador espera por ahora el formato de ventas por artículo (las columnas «Customer Items» de Revel), así que no todas las hojas se importan todavía.",
      upload: "Subir una hoja de cálculo",
    },
    revel: {
      title: "Revel",
      description:
        "Sube hoy una exportación «Customer Items» de Revel. La sincronización en vivo con Revel llegará pronto: solicítala y te avisamos.",
      export: "Subir una exportación de Revel",
      request: "Solicitarla",
    },
    odoo: {
      title: "Odoo",
      description: "El equipo de Milton conecta Odoo por ti durante el piloto.",
      connect: "Conectar Odoo",
      sent: "¡Gracias! El equipo de Milton conecta Odoo por ti. Te contactaremos para configurarlo.",
    },
    other: {
      title: "Otro / cuéntanos dónde están tus datos",
      description:
        "¿Usas otra cosa? Cuéntanos dónde guardas tus datos de ventas y lo revisamos.",
      send: "Enviar",
    },
  },
  picks: {
    square: "Square",
    toast: "Toast",
    other: "Otro",
  },
  api: {
    atLeastOneProduct: "Indica al menos un producto.",
    bodyMustBeJson: "El cuerpo tiene que ser JSON.",
    companyNotFound: "No encontré la empresa.",
    datesOrder: "start_date debe ser anterior o igual a end_date.",
    datesTogether:
      "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
    fileEmpty: "El archivo está vacío.",
    linkChangeFailed: "No pude cambiar el vínculo.",
    linkChangeMissing: "Indica el producto de Odoo y la receta.",
    linkCreateMissing: "Indica el producto de Odoo y su nombre.",
    missingColumns: "Faltan columnas obligatorias.",
    noSheets: "El archivo no tiene hojas.",
    noValidRows: "No hay filas válidas para guardar.",
    odooProductIdMissing: "Falta odoo_product_id.",
    recipeCreateFailed: "No pude crear la receta.",
    replaceFailed: "No pude reemplazar las filas existentes.",
    resaleCreateFailed: "No pude crear el costo de reventa.",
    resaleMissing: "Indica el producto de Odoo, qué compras y la unidad.",
    rowsSaveFailed: "No pude guardar las filas.",
    telegramAlreadyConnected:
      "Este restaurante ya tiene un chat de Telegram conectado.",
    treatmentMissing: "Indica el producto de Odoo y cómo se costea.",
    treatmentSaveFailed: "No pude guardar cómo se costea.",
    undoFailed: "No pude deshacer la confirmación.",
    uploadFailed: "No se pudo subir el archivo.",
    uploadFile: "Sube un archivo.",
    fileTooBigMb: "El archivo pesa más de {mb} MB.",
    salesUploadDenied: "Tu rol no puede cargar ventas.",
  },
} as const;
