import * as XLSX from "xlsx";

/**
 * Synthetic kitchen cost workbook. No client data.
 * Price list (ambiguous PRECIO UNITARIO) + recipe + sub-recipe + two
 * Spanish category tabs with title rows above headers, typo pairs,
 * LIBRA/ONZA unit cases, an implausible per-gram price, and prepared
 * items that also appear on SUB RECETAS.
 */
export function buildSyntheticCostWorkbook(opts?: {
  carneLb?: number;
  /** Write the recipe's carrot line as a typo (ZANAHORA). Default: correct. */
  typoedRecipeLine?: boolean;
}): Buffer {
  const carneLb = opts?.carneLb ?? 4.8;
  const carneOz = Number((carneLb / 16).toFixed(4));
  const wb = XLSX.utils.book_new();

  const priceList = [
    ["LISTA DE PRECIOS DE PRUEBA — ABRIL 2026"],
    [],
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["Carne para asar", carneLb, carneOz, ""],
    ["Tomate", 1.2, 0.075, ""],
    ["Sal", "", "", 0.15],
    ["Cebolla", 1.8, 0.1125, ""],
    ["Aceite rancio", "", "", "n/a"],
    ["ACEITE DE OLIVA", "", 0.3125, ""],
    ["ACEITE DE OIVA", 0.3125, "", ""],
    ["ZANAHORIA", "", 0.0188, ""],
    ["ZANAHORA", "", 0.0525, ""],
    ["AGUACATE", "", 0.55, ""],
    ["AGUCATE", "", "", 0.55],
    ["YUCA FRITA", 0.8, 0.05, ""],
    ["TOSTONES", 0.7, 0.0438, ""],
    ["Yuca", 0.8, 0.05, ""],
    ["Platano", 0.6, 0.0375, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(priceList),
    "Lista de precios"
  );

  const subRecipes = [
    ["SUB RECETAS"],
    [],
    ["Receta", "Ingrediente", "Cantidad", "Unidad"],
    ["Salsa ranchera", "Tomate", 2, "lb"],
    ["Salsa ranchera", "Cebolla", 0.5, "kg"],
    ["YUCA FRITA", "Yuca", 2, "lb"],
    ["TOSTONES", "Platano", 2, "lb"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(subRecipes),
    "SUB RECETAS"
  );

  const recipe = [
    ["RECETA: Carne Asada"],
    ["Ingrediente", "Cantidad", "Unidad", "Notas"],
    ["Carne para asar", 8, "oz", "por porción"],
    ["Tomate", 2, "oz", ""],
    ["Salsa ranchera", 2, "oz", "prep"],
    [
      opts?.typoedRecipeLine ? "ZANAHORA" : "ZANAHORIA",
      1,
      "oz",
      opts?.typoedRecipeLine ? "typo of zanahoria" : "",
    ],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(recipe),
    "RECETA Carne Asada"
  );

  const carnes = [
    ["COSTOS CARNES"],
    [],
    ["Nombre", "Unidad", "Costo", "Cantidad", "Total"],
    ["Pollo entero", "libra", 2.5, 10, 25],
    ["Filo raro", "bulto", 3, 2, 6],
    ["Costilla", "lb", 5, 4, 100],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(carnes), "Carnes");

  const vegetales = [
    ["VEGETALES"],
    ["Producto", "Unidad", "Precio", "Cantidad", "Total"],
    ["Lechuga", "unidad", 0.6, 12, 7.2],
    ["Apio", "gramo", 0.08, 1, 0.08],
    ["ADEREZO", "unidad", 1.2, 1, 1.2],
    ["ADERESO", "unidad", 1.2, 1, 1.2],
    ["TOTAL", "", "", "", 7.2],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(vegetales),
    "Vegetales"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Same shape as a real kitchen cost file, plus the Latin American
 * kitchen units that the real SUB RECETAS tab uses (GALON, PAQUETE,
 * SOBRES, UNIDA, BOLSA, CAJA), parenthetical / mixed / oversized pack
 * sizes that must go to needs-a-look, one genuinely bad row (ingredient
 * name in the unit column), a cover tab with no headers, and a second
 * recipe tab. No client data.
 */
export function buildSyntheticKitchenUnitsWorkbook(): Buffer {
  const wb = XLSX.read(buildSyntheticCostWorkbook(), { type: "buffer" });

  const sub = [
    ["SUB RECETAS"],
    [],
    ["Receta", "Ingrediente", "Cantidad", "Unidad"],
    ["Salsa ranchera", "Tomate", 2, "lb"],
    ["Salsa ranchera", "Cebolla", 0.5, "kg"],
    ["Agua de jamaica", "Agua", 1, "GALON"],
    ["Tortilla taco", "Tortilla", 14, "PAQUETE (TORTILLA DE TACO 14 UNIDADES)"],
    ["Sopa para tacos", "Sopa instantanea", 2, "SOBRES"],
    ["Wantan wrap", "Tela de wantan", 1, "UNIDA"],
    ["Aderezo casa", "ADEREZO", 1, "BOLSA"],
    ["Tomate caja", "Tomate", 1, "CAJA"],
    ["YUCA FRITA", "Yuca", 2, "lb"],
    ["TOSTONES", "Platano", 2, "lb"],
    ["Apio suelto", "APIO", 1, "APIO"],
    ["Arroz saco", "Arroz", 1, "SACO 25 KG (ARROZ)"],
    ["Harina mixta", "Harina", 1, "CAJA 12 x 500 g"],
    ["Aceite cubeta", "Aceite", 1, "CUBETA 18.9 L + 2 L"],
  ];
  wb.Sheets["SUB RECETAS"] = XLSX.utils.aoa_to_sheet(sub);

  const price = [
    ["LISTA DE PRECIOS DE PRUEBA — ABRIL 2026"],
    [],
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["Carne para asar", 4.8, 0.3, ""],
    ["Tomate", 1.2, 0.075, ""],
    ["Cebolla", 1.8, 0.1125, ""],
    ["Agua", "", "", 0.4],
    ["Tortilla", "", "", 2.5],
    ["Sopa instantanea", "", "", 0.35],
    ["Tela de wantan", "", "", 1.1],
    ["ADEREZO", "", "", 1.2],
    ["Yuca", 0.8, 0.05, ""],
    ["Platano", 0.6, 0.0375, ""],
    ["ZANAHORIA", "", 0.0188, ""],
    ["ZANAHORA", "", 0.0525, ""],
  ];
  wb.Sheets["Lista de precios"] = XLSX.utils.aoa_to_sheet(price);

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["INDICE"], ["Restaurante de prueba — costos abril"], [""]]),
    "INDICE"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["RECETA: Agua Jamaica"],
      ["Ingrediente", "Cantidad", "Unidad"],
      ["Agua de jamaica", 0.25, "GALON"],
    ]),
    "RECETA Agua Jamaica"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Reproduces the staging SUB RECETAS failure without client data:
 * an unlabeled unit column (so a naive map reads the ingredient name
 * as the unit — APIO/APIO), typo units GRMO/GRAKO, extra cost/total
 * columns, a title row, and a pack size that must stay in needs-a-look.
 */
export function buildShiftedSubRecipeWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const priceList = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["Perejil", 2.4, 0.15, ""],
    ["Ajo", 3.2, 0.2, ""],
    ["APIO", 1.2, 0.075, ""],
    ["PIMIENTA", "", "", 0.2],
    ["Yuca", 0.8, 0.05, ""],
    ["Tortilla", "", "", 2.5],
    ["Carne para asar", 4.8, 0.3, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(priceList),
    "Lista de precios"
  );

  const sub = [
    ["SUB RECETAS — bloque"],
    [],
    ["Receta", "Ingrediente", "Cantidad", "", "Costo", "Total"],
    ["Chimichurri casa", "Perejil", 80, "GRMO", 0.02, 1.6],
    ["Chimichurri casa", "Ajo", 20, "GRAKO", 0.05, 1],
    ["Chimichurri casa", "APIO", 40, "GRAMO", 0.01, 0.4],
    ["Pimienta molida", "PIMIENTA", 5, "GRMO", 0.2, 1],
    [
      "Tortilla taco",
      "Tortilla",
      14,
      "PAQUETE (TORTILLA DE TACO 14 UNIDADES)",
      2.5,
      2.5,
    ],
    ["YUCA FRITA"],
    ["YUCA FRITA", "Yuca", 2, "LB", 0.8, 1.6],
    ["TOTAL", "", "", "", "", ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sub),
    "SUB RECETAS 2"
  );

  const recipe = [
    ["RECETA: Carne Asada"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Carne para asar", 8, "oz"],
    ["Chimichurri casa", 1, "oz"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(recipe),
    "RECETA Carne Asada"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * A kitchen cost-file shape without client data: dish tabs use a
 * shared Articulo column (title-row dish name, then ingredients),
 * GRAM0 as a zero-for-O typo, and a yearly cost-summary tab that
 * must not become recipes.
 */
export function buildSharedArticuloDishWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const priceList = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["Pescado", 4.8, 0.3, ""],
    ["Limon", "", "", 0.15],
    ["Totopos", "", "", 0.8],
    ["Queso", 3.2, 0.2, ""],
    ["Carne para asar", 4.8, 0.3, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(priceList),
    "Lista de precios"
  );

  const entradas = [
    ["ENTRADAS"],
    [],
    ["Articulo", "Cantidad", "Unidad Detalle", "Costo"],
    ["Ceviche"],
    ["Pescado", 200, "GRAM0", 0.3],
    ["Limon", 30, "ML", 0.15],
    ["Nachos"],
    ["Totopos", 100, "GRMO", 0.8],
    ["Queso", 40, "GRAMO", 0.2],
    ["Totopos pack", 1, "PAQUETE (TORTILLA DE TACO 14 UNIDADES)", 2.5],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(entradas),
    "Entradas"
  );

  const parrilladas = [
    ["PARRILLADAS"],
    ["Articulo", "Cantidad", "Unidad Detalle", "Costo"],
    ["Carne asada"],
    ["Carne para asar", 8, "ONZ", 4.8],
    ["Limon", 10, "ML", 0.15],
    ["Costilla"],
    ["Carne para asar", 12, "ONZ", 4.8],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(parrilladas),
    "Parrilladas"
  );

  const costos = [
    ["COSTOS RESTAURANTE 2026"],
    [],
    ["Concepto", "Enero", "Febrero", "Total"],
    ["Alquiler", 2000, 2000, 4000],
    ["Luz", 400, 420, 820],
    ["Salarios", 8000, 8100, 16100],
    ["TOTAL", 10400, 10520, 20920],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(costos),
    "COSTOS RESTAURANTE 2026"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Kitchen cost-file block layout (no client data): COSTO RESTAURANTE
 * banners, per-block headers, merged name-on-header, no-banner first
 * block, ####### totals, dish sale-price footers, and CONVOY/ORDEN
 * sub-recipe references.
 */
export function buildCostoRestauranteBlockWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];

  const sub = [
    ["RESTAURANTE DE PRUEBA"],
    [],
    ["COSTO RESTAURANTE"],
    ["QUESO FRITO"],
    header,
    ["QUESO GRATINADO", "ONZA", 1, 0.14754, 0.14754],
    ["HARINA", "GRAMO", 5, 0.0012, 0.006],
    ["ACEITE", "ONZA", 0.5, 0.12, 0.06],
    ["COSTO TOTAL", "", 0, 0, 0.21354],
    ["PRECIO COSTO POR UNIDAD", "", 0, 0, 0.21354],
    [],
    ["COSTO RESTAURANTE"],
    [
      "FONDO PARA SOPA DE TORTILLA",
      "Unidad Detalle",
      "Cantidad",
      "Costo Unitario",
      "Total Costo",
    ],
    ["TOMATE", "LIBRA", 0.5, 0.96, 0.48],
    ["CEBOLLA", "LIBRA", 0.25, 0.8, 0.2],
    ["AGUA", "GALON", 1.5, 0.4, 0.6],
    ["TORTILLA", "PAQUETE (TORTILLA DE TACO 14 UNIDADES)", 1, 2.5, 2.5],
    ["COSTO TOTAL", "", "", "", 3.78],
    ["PRECIO POR LIBRA", "", "", "", 0.42],
    [],
    ["COSTO RESTAURANTE"],
    [
      "FONDO DE RES",
      "Unidad Detalle",
      "Cantidad",
      "Costo Unitario",
      "Total Costo",
    ],
    ["HUESO", "LIBRA", 2, 0.4, 0.8],
    ["AGUA", "LITRO", 2, 0.1, 0.2],
    ["COSTO TOTAL", "", "", "", 1.0],
    ["PRECIO POR LIBRA", "", "", "", 1],
    ["PRECIO POR ONZA", "", "", "", 1],
    [],
    ["COSTO RESTAURANTE"],
    ["DEMIGLASS"],
    header,
    ["HUESO", "LIBRA", 4, 0.4, 1.6],
    ["AGUA", "LITRO", 4, 0.1, 0.4],
    ["DEMIGLASS", "COSTO TOTAL", 0, 0, 2],
    ["DEMIGLASS", "PRECIO POR LIBRA", 0, 0, 0.25],
    ["PRECIO POR ONZA $0.015625"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const sub2 = [
    ["RESTAURANTE DE PRUEBA"],
    ["SALSA TARTARA"],
    header,
    ["MAYONESA", "LIBRA", 7.7, 0.9, 6.93],
    ["CEBOLLA", "ONZA", 2, 0.05, "#######"],
    ["SAL", "ONZA", 0.5, 0.02, 0.01],
    ["COSTO TOTAL", "", "", "", 6.93],
    ["PRECIO POR LIBRA", "", "", "", 0.555],
    ["PRECIO POR ONZA", "", "", "", 0.0346875],
    [],
    ["COSTO RESTAURANTE"],
    ["SALSA VERDE"],
    header,
    ["TOMATE", "LIBRA", 2, 0.96, 1.92],
    ["CILANTRO", "ONZA", 3.5, 0.09, 0.315],
    ["COSTO TOTAL", "", "", "", 2.235],
    ["PRECIO POR LIBRA", "", "", "", 0.447],
    [],
    ["COSTO RESTAURANTE"],
    ["CHIMICHURRI"],
    header,
    ["PEREJIL", "ONZA", 2, 0.04, 0.08],
    ["ACEITE", "ONZA", 2, 0.12, 0.24],
    ["COSTO TOTAL", "", "", "", 0.32],
    ["PRECIO POR LIBRA", "", "", "", 0.32],
    [],
    ["COSTO RESTAURANTE"],
    ["GUACAMOL"],
    header,
    ["AGUACATE", "LIBRA", 1, 1.2, 1.2],
    ["COSTO TOTAL", "", "", "", 1.2],
    ["PRECIO POR LIBRA", "", "", "", 1.2],
    [],
    ["COSTO RESTAURANTE"],
    ["CONVOY DE LA CASA"],
    header,
    ["LECHUGA", "ONZA", 2, 0.05, 0.1],
    ["FONDO DE RES", "ONZA", 4, 0.2, 0.8],
    ["COSTO TOTAL", "", "", "", 0.9],
    ["PRECIO POR LIBRA", "", "", "", 0.9],
    [],
    ["COSTO RESTAURANTE"],
    ["GUARNICION 1"],
    header,
    ["PAPA", "LIBRA", 0.5, 0.6, 0.3],
    ["COSTO TOTAL", "", "", "", 0.3],
    ["PRECIO POR LIBRA", "", "", "", 0.3],
    [],
    ["COSTO RESTAURANTE"],
    ["ENSALADA"],
    header,
    ["LECHUGA", "ONZA", 3, 0.05, 0.15],
    ["COSTO TOTAL", "", "", "", 0.15],
    ["PRECIO POR LIBRA", "", "", "", 0.15],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sub2),
    "SUB RECETAS 2"
  );

  const parrilla = [
    ["RESTAURANTE DE PRUEBA"],
    [],
    ["COSTO RESTAURANTE"],
    ["ASADO TIPICO 6"],
    header,
    ["CARNE ASADA", "ONZA", 6, 0.47125, 2.8275],
    ["FRIJOL FRITO", "ONZA", 2.5, 0.045, 0.1125],
    ["PLATANO FRITO", "UNIDAD", 5, 0.05, 0.25],
    ["GUACAMOL", "ONZA", 2.5, 0.15, 0.375],
    ["CHIMICHURRI", "ONZA", 0.25, 0.03, 0.0075],
    ["CONVOY DE LA CASA", "CONVOY", 1, 0.8132, 0.8132],
    ["SAL", "GRAMO", 3, 0.0011, 0.0033],
    ["COSTO TOTAL", "", "", "", 4.389],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 13.274],
    ["MARGEN DE CONTRIBUCION", "", "", "", 8.885, 0.6694],
    [],
    ["COSTO RESTAURANTE"],
    ["ASADO TIPICO 8"],
    header,
    ["CARNE ASADA", "ONZA", 8, 0.47125, 3.77],
    ["GUACAMOL", "ONZA", 2.5, 0.15, 0.375],
    ["CONVOY DE LA CASA", "CONVOY", 1, 0.8132, 0.8132],
    ["COSTO TOTAL", "", "", "", 4.958],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 15.929],
    ["MARGEN DE CONTRIBUCION", "", "", "", 10.971],
    [],
    ["COSTO RESTAURANTE"],
    ["DEDOS DE QUESO"],
    header,
    ["QUESO FRITO", "ORDEN", 1, 0.21354, 0.21354],
    ["COSTO TOTAL", "", 0, 0, 0.21354],
    ["PRECIO DE VENTA SIN IVA", "", 0, 0, 8.4],
    [],
    ["COSTO RESTAURANTE"],
    ["SALSA DEMIGLASS PLATO"],
    header,
    ["DEMIGLASS", "ONZA", 2, 0.015625, 0.03125],
    ["COSTO TOTAL", "", 0, 0, 0.03125],
    ["PRECIO DE VENTA SIN IVA", "", 0, 0, 8],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(parrilla),
    "DE LA PARRILLA"
  );

  const especial = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["CORTE DE LA CASA"],
    header,
    ["CORTE DE LA CASA", "ONZA", 8, 0.5125, 4.1],
    ["GUARNICION 1", "ORDEN", 2, 0.3, 0.6],
    ["CONVOY DE LA CASA", "ORDEN", 1, 0.8132, 99],
    ["COSTO TOTAL", "", "", "", 5.51],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 14.2],
    ["MARGEN DE CONTRIBUCION", "", "", "", 8.69],
    [],
    ["COSTO RESTAURANTE"],
    ["ENTRAÑA"],
    header,
    ["ENTRAÑA", "ONZA", 8, 0.6875, 5.5],
    ["ENSALADA", "ORDEN", 1, 0.15, 0.15],
    ["COSTO TOTAL", "", "", "", 5.65],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 16.5],
    ["MARGEN DE CONTRIBUCION", "", "", "", 10.85],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(especial),
    "ESPECIALIDADES DE LA PARRILLA"
  );

  const price = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["QUESO GRATINADO", 2.36, 0.14754, ""],
    ["HARINA", 0.544, 0.034, 0.0012],
    ["ACEITE", 1.92, 0.12, ""],
    ["TOMATE", 0.96, 0.06, ""],
    ["CEBOLLA", 0.8, 0.05, ""],
    ["AGUA", "", 0.025, 0.4],
    ["HUESO", 0.4, 0.025, ""],
    ["MAYONESA", 0.98051948, 0.06128, ""],
    ["SAL", "", 0.02, ""],
    ["CILANTRO", "", 0.09, ""],
    ["PEREJIL", "", 0.04, ""],
    ["AGUACATE", 1.2, 0.075, ""],
    ["LECHUGA", "", 0.05, ""],
    ["PAPA", 0.6, 0.0375, ""],
    ["CARNE ASADA", 7.54, 0.47125, ""],
    ["FRIJOL FRITO", "", 0.045, ""],
    ["PLATANO FRITO", "", 0.05, 0.05],
    ["CORTE DE LA CASA", 8.2, 0.5125, ""],
    ["ENTRAÑA", 11, 0.6875, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(price),
    "Lista de precios"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Block layout covering footer typos, a sub-recipe used by a dish, a
 * dish/sub-recipe name clash, and a printed total that must mismatch.
 */
export function buildWorkbookMatchFooterWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];

  const sub = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["QUESO FRITO"],
    header,
    ["QUESO GRATINADO", "ONZA", 1, 0.15, 0.15],
    ["COSTO TOTAL", "", "", "", 0.15],
    ["PRECIO COSTO POR UNIDAD", "", "", "", 0.15],
    [],
    ["COSTO RESTAURANTE"],
    ["SALSA CASA"],
    header,
    ["TOMATE", "LIBRA", 2, 1, 2],
    ["COSTO TOTAL", "", "", "", 2],
    ["PRECIO LIBRA", "", "", "", 1],
    ["PRECIOPOR ONZA", "", "", "", 0.0625],
    ["PRECIO POR UNDIAD", "", "", "", 2],
    [],
    ["COSTO RESTAURANTE"],
    ["TORTA FRITA"],
    header,
    ["HARINA", "LIBRA", 1, 0.8, 0.8],
    ["COSTO TOTAL", "", "", "", 0.8],
    ["PRECIO COSTO TORTA", "", "", "", 0.8],
    [],
    ["COSTO RESTAURANTE"],
    ["TOSTONES"],
    header,
    ["PLATANO", "LIBRA", 1, 0.6, 0.6],
    ["COSTO TOTAL", "", "", "", 0.6],
    ["PRECIO COSTO POR UNIDAD", "", "", "", 0.6],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["DEDOS DE QUESO"],
    header,
    ["QUESO FRITO", "ORDEN", 1, 0.15, 0.15],
    ["COSTO TOTAL", "", "", "", 0.15],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 8.4],
    [],
    ["COSTO RESTAURANTE"],
    ["TOSTONES"],
    header,
    ["TOSTONES", "ORDEN", 1, 0.6, 0.6],
    ["PLATANO", "ONZA", 2, 0.0375, 0.075],
    ["COSTO TOTAL", "", "", "", 0.675],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 4],
    [],
    ["COSTO RESTAURANTE"],
    ["PLATO MALO"],
    header,
    ["TOMATE", "LIBRA", 1, 1, 1],
    ["COSTO TOTAL", "", "", "", 9.99],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 12],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );

  const price = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["QUESO GRATINADO", 2.4, 0.15, ""],
    ["TOMATE", 1, 0.0625, ""],
    ["HARINA", 0.8, 0.05, ""],
    ["PLATANO", 0.6, 0.0375, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(price),
    "Lista de precios"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Sub-recipe yield is 3 lb (COSTO TOTAL / PRECIO POR LIBRA). A dish
 * that uses 1 ORDEN is priced in Excel at the whole-batch COSTO TOTAL,
 * not at $0.40/lb. A second dish prints 5.40 as if 1 ORDEN = 1 lb —
 * that must stay a mismatch, never forced.
 */
export function buildOrdenPortionCostWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const sub = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["PAPAS FRITAS"],
    header,
    ["PAPA", "LIBRA", 3, 0.4, 1.2],
    ["COSTO TOTAL", "", "", "", 1.2],
    ["PRECIO POR LIBRA", "", "", "", 0.4],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["BISTEC"],
    header,
    ["CARNE", "LIBRA", 1, 5, 5],
    ["PAPAS FRITAS", "ORDEN", 1, 1.2, 1.2],
    ["COSTO TOTAL", "", "", "", 6.2],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 12],
    [],
    ["COSTO RESTAURANTE"],
    ["BISTEC BARATO"],
    header,
    ["CARNE", "LIBRA", 1, 5, 5],
    ["PAPAS FRITAS", "ORDEN", 1, 1.2, 1.2],
    ["COSTO TOTAL", "", "", "", 5.4],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 12],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );

  const price = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["PAPA", 0.4, 0.025, ""],
    ["CARNE", 5, 0.3125, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(price),
    "Lista de precios"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Protein line uses an unknown unit and is dropped to review. If the
 * remaining ACEITE line were saved as a complete recipe, the dish would
 * cost $0.20 / 2.7% food cost — the Pollo Empanizado failure mode.
 */
export function buildIncompleteDishWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const dishes = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["POLLO EMPANIZADO"],
    header,
    ["POLLO", "BULTAZO", 1, 7, 7],
    ["ACEITE", "ONZA", 1, 0.2, 0.2],
    ["COSTO TOTAL", "", "", "", 7.2],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 7.4],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );
  const price = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["ACEITE", 3.2, 0.2, ""],
    ["POLLO", 7, 0.4375, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(price),
    "Lista de precios"
  );
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Sub-recipe with only COSTO TOTAL (no $/lb, $/oz, or unit price).
 * Yield must be assumed, never confirmed, and dishes that use it stay
 * in review — never costed and never Cuadra con Excel.
 */
export function buildAssumedYieldWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const sub = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["QUESO FRITO"],
    header,
    ["QUESO GRATINADO", "ONZA", 1, 0.15, 0.15],
    ["COSTO TOTAL", "", "", "", 0.15],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["DEDOS DE QUESO"],
    header,
    ["QUESO FRITO", "ORDEN", 1, 0.15, 0.15],
    ["COSTO TOTAL", "", "", "", 0.15],
    ["PRECIO DE VENTA SIN IVA", "", "", "", 8.4],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );

  const price = [
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["QUESO GRATINADO", 2.4, 0.15, ""],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(price),
    "Lista de precios"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

function demiglassWorkbook(opts: {
  lines: Array<Array<string | number>>;
  footers: Array<Array<string | number>>;
}): Buffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const sub = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["DEMIGLASS"],
    header,
    ...opts.lines,
    ...opts.footers,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
      ["HUESO", 0.4, 0.025, ""],
    ]),
    "Lista de precios"
  );
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/** Confirmed DEMIGLASS yield: COSTO TOTAL $2 / $0.25 per lb = 8 lb. */
export function buildConfirmedDemiglassWorkbook(): Buffer {
  return demiglassWorkbook({
    lines: [["HUESO", "LIBRA", 4, 0.4, 1.6]],
    footers: [
      ["COSTO TOTAL", "", "", "", 2],
      ["PRECIO POR LIBRA", "", "", "", 0.25],
    ],
  });
}

/** Same prep with only COSTO TOTAL — assumed 1-unit yield, different qty. */
export function buildAssumedDemiglassWorkbook(): Buffer {
  return demiglassWorkbook({
    lines: [["HUESO", "LIBRA", 8, 0.4, 3.2]],
    footers: [["COSTO TOTAL", "", "", "", 3.2]],
  });
}

/**
 * Mirrors a kitchen cost-file layout without client data: banner,
 * filled-down names (header overlap + extra ingredient column),
 * repeated headers, blank separators, $ in footer labels, Cantidad 0
 * on footer rows, a block starting deep in the sheet, GRAM0, one
 * unknown unit (APIO), and a dish that uses an assumed-yield prep.
 * QUESO CREMADO is only on the recipe lines, not the price list.
 */
export function buildRealLayoutCostoRestauranteWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const overlapHeader = (name: string) => [
    name,
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const filled = (
    name: string,
    ingredient: string,
    unit: string,
    qty: number,
    unitCost: number,
    total: number
  ) => [name, ingredient, unit, qty, unitCost, total];

  const sub: Array<Array<string | number>> = [
    ["RESTAURANTE DE PRUEBA"],
    [],
    ["COSTO RESTAURANTE"],
    ["QUESO FRITO"],
    overlapHeader("QUESO FRITO"),
    filled("QUESO FRITO", "QUESO CREMADO", "ONZA", 1.2, 0.125, 0.15),
    filled("QUESO FRITO", "HARINA", "GRAM0", 5, 0.002, 0.01),
    filled("QUESO FRITO", "ACEITE", "ONZA", 0.1, 0.08, 0.008),
    ["QUESO FRITO", "COSTO TOTAL", 0, 0, 0],
    [],
  ];
  for (let i = 0; i < 28; i += 1) sub.push([]);
  sub.push(
    ["COSTO RESTAURANTE"],
    ["DEMIGLASS"],
    overlapHeader("DEMIGLASS"),
    filled("DEMIGLASS", "HUESO", "LIBRA", 4, 0.4, 1.6),
    filled("DEMIGLASS", "AGUA", "LITRO", 4, 0.1, 0.4),
    ["DEMIGLASS", "COSTO TOTAL", 0, 0, 0],
    ["DEMIGLASS", "PRECIO POR LIBRA $0.25"],
    ["PRECIO POR ONZA $0.015625"],
    [],
    ["COSTO RESTAURANTE"],
    ["ROLL VEGETALES"],
    overlapHeader("ROLL VEGETALES"),
    filled("ROLL VEGETALES", "ZANAHORIA", "ONZA", 2, 0.05, 0.1),
    filled("ROLL VEGETALES", "APIO", "APIO", 1, 0.2, 0.2),
    ["ROLL VEGETALES", "COSTO TOTAL", 0, 0, 0, 0.3]
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["DEDOS DE QUESO"],
    overlapHeader("DEDOS DE QUESO"),
    filled("DEDOS DE QUESO", "QUESO FRITO", "ORDEN", 1, 0.18465, 0.18465),
    ["DEDOS DE QUESO", "COSTO TOTAL", 0, 0, 0, 0.18465],
    ["DEDOS DE QUESO", "PRECIO DE VENTA SIN IVA", 0, 0, 0, 8.4],
    ["MARGEN DE CONTRIBUCION", "", "", "", 7.3],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "ENTRADAS INDIVIDUALES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
      ["HARINA", 0.544, 0.034, ""],
      ["ACEITE", 1.92, 0.12, ""],
      ["HUESO", 0.4, 0.025, ""],
      ["AGUA", "", 0.025, 0.4],
      ["ZANAHORIA", "", 0.05, ""],
    ]),
    "BODEGA VIRTUAL"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["COSTOS RESTAURANTE 2026"],
      ["Concepto", "Enero", "Febrero", "Total"],
      ["Alquiler", 2000, 2000, 4000],
    ]),
    "COSTOS RESTAURANTE 2026"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Real-layout shape: empty column A, filled-down recipe name, comma
 * decimals, ORDEN on an exact sub-recipe, a typo line, and a missing
 * COSTO TOTAL that must stay inferred. Synthetic names only.
 */
export function buildLeadingEmptyOrdenCommaWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const e = "";
  const overlap = (name: string) => [
    e,
    name,
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const filled = (
    recipe: string,
    ingredient: string,
    unit: string,
    qty: string | number,
    unitCost: string | number,
    total: string | number
  ) => [e, recipe, ingredient, unit, qty, unitCost, total];

  const sub: Array<Array<string | number>> = [
    [e, "RESTAURANTE DE PRUEBA"],
    [],
    [e, "COSTO RESTAURANTE"],
    [e, "GUARNICION 1"],
    overlap("GUARNICION 1"),
    filled("GUARNICION 1", "PAPA", "LIBRA", "0,5", "$ 0,60", "$ 0,30"),
    [e, "GUARNICION 1", "COSTO TOTAL", "", "", "", "$ 0,30"],
    [e, "GUARNICION 1", "PRECIO POR LIBRA", "", "", "", "$ 0,30"],
    [],
    [e, "COSTO RESTAURANTE"],
    [e, "DEMIGLASS"],
    overlap("DEMIGLASS"),
    filled("DEMIGLASS", "HUESO", "LIBRA", 4, "$ 0,40", "$ 1,60"),
    filled("DEMIGLASS", "AGUA", "LITRO", 4, "$ 0,10", "$ 0,40"),
    [e, "DEMIGLASS", "PRECIO POR LIBRA $0,25"],
    [],
    [e, "COSTO RESTAURANTE"],
    [e, "DEDOS DE QUESO"],
    overlap("DEDOS DE QUESO"),
    filled(
      "DEDOS DE QUESO",
      "QUESO CREMADO",
      "ONZA",
      "1,14",
      "$ 0,18",
      "$ 0,21"
    ),
    filled("DEDOS DE QUESO", "EMPANIZAOR", "ONZA", "0,25", "$ 0,09", "$ 0,02"),
    [e, "DEDOS DE QUESO", "COSTO TOTAL", "", "", "", "$ 0,23"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes = [
    [e, "COSTO RESTAURANTE"],
    [e, "CORTE DE LA CASA"],
    overlap("CORTE DE LA CASA"),
    filled("CORTE DE LA CASA", "CORTE DE LA CASA", "ONZA", 8, "$ 0,51250", "$ 4,10000"),
    filled("CORTE DE LA CASA", "GUARNICION 1", "ORDEN", 2, "$ 0,25000", "$ 0,50000"),
    [e, "CORTE DE LA CASA", "COSTO TOTAL", "", "", "", "$ 4,60"],
    [e, "CORTE DE LA CASA", "PRECIO DE VENTA SIN IVA", "", "", "", "$ 13,27"],
    [],
    [e, "COSTO RESTAURANTE"],
    [e, "PLATO RARO"],
    overlap("PLATO RARO"),
    filled("PLATO RARO", "SAL", "GRAMO", "1,234", "$ 0,01", "$ 12,34"),
    [e, "PLATO RARO", "COSTO TOTAL", "", "", "", "$ 12,34"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
      ["PAPA", 0.6, 0.0375, ""],
      ["HUESO", 0.4, 0.025, ""],
      ["AGUA", "", 0.025, 0.4],
      ["CORTE DE LA CASA", 8.2, 0.5125, ""],
      ["EMPANIZADOR", "", 0.09, ""],
    ]),
    "Lista de precios"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

/**
 * Synthetic COSTO RESTAURANTE blocks for AI recipe
 * suggestions. No client data. Covers APIO-as-unit, QUESILLO without
 * cost, confirmed DEMIGLASS per-lb/oz, and a clean dish.
 */
export function buildRecipeSuggestionWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const header = () => [
    "Articulo",
    "Unidad Detalle",
    "Cantidad",
    "Costo Unitario",
    "Total Costo",
  ];
  const line = (
    ingredient: string,
    unit: string,
    qty: number,
    unitCost: number | "",
    total: number | ""
  ) => [ingredient, unit, qty, unitCost, total];

  const sub: Array<Array<string | number>> = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["DEMIGLASS"],
    header(),
    line("HUESO", "LIBRA", 4, 0.4, 1.6),
    line("AGUA", "LITRO", 4, 0.1, 0.4),
    ["DEMIGLASS", "COSTO TOTAL", 0, 0, 2],
    ["DEMIGLASS", "PRECIO POR LIBRA", 0, 0, 0.25],
    ["PRECIO POR ONZA $0.015625"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), "SUB RECETAS");

  const dishes: Array<Array<string | number>> = [
    ["RESTAURANTE DE PRUEBA"],
    ["COSTO RESTAURANTE"],
    ["BISTEC TIPICO"],
    header(),
    line("TOMATE", "LIBRA", 0.5, 0.96, 0.48),
    line("CEBOLLA", "LIBRA", 0.25, 0.8, 0.2),
    ["BISTEC TIPICO", "COSTO TOTAL", 0, 0, 0.68],
    ["BISTEC TIPICO", "PRECIO POR UNIDAD", 0, 0, 0.68],
    [],
    ["COSTO RESTAURANTE"],
    ["SALSA DEMIGLASS PLATO"],
    header(),
    line("DEMIGLASS", "ONZA", 2, 0.015625, 0.03125),
    ["SALSA DEMIGLASS PLATO", "COSTO TOTAL", 0, 0, 0.03125],
    [],
    ["COSTO RESTAURANTE"],
    ["ROLL VEGETALES"],
    header(),
    line("ZANAHORIA", "ONZA", 2, 0.05, 0.1),
    line("APIO", "APIO", 1, 0.2, 0.2),
    ["ROLL VEGETALES", "COSTO TOTAL", 0, 0, 0.3],
    [],
    ["COSTO RESTAURANTE"],
    ["ASADO CON QUESILLO"],
    header(),
    line("CORTE DE LA CASA", "ONZA", 8, 0.5, 4),
    line("QUESILLO", "ONZA", 2, "", ""),
    ["ASADO CON QUESILLO", "COSTO TOTAL", 0, 0, 4],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(dishes),
    "DE LA PARRILLA"
  );

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}
