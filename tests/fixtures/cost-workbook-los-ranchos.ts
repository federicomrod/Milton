import * as XLSX from "xlsx";

/**
 * Synthetic Los Ranchos-shaped workbook. No client data.
 * Price list (ambiguous PRECIO UNITARIO) + recipe + sub-recipe + two
 * Spanish category tabs with title rows above headers, typo pairs,
 * LIBRA/ONZA unit cases, an implausible per-gram price, and prepared
 * items that also appear on SUB RECETAS.
 */
export function buildLosRanchosCostWorkbook(opts?: {
  carneLb?: number;
}): Buffer {
  const carneLb = opts?.carneLb ?? 4.8;
  const carneOz = Number((carneLb / 16).toFixed(4));
  const wb = XLSX.utils.book_new();

  const priceList = [
    ["LISTA DE PRECIOS LOS RANCHOS — ABRIL 2026"],
    [],
    ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
    ["Carne para asar", carneLb, carneOz, ""],
    ["Tomate", 1.2, 0.075, ""],
    ["Sal", "", "", 0.15],
    ["Cebolla", 1.8, 0.1125, ""],
    ["Aceite rancio", "", "", "n/a"],
    ["ACEITE DE OLIVA", "", 0.3556, ""],
    ["ACEITE DE OIVA", 0.3556, "", ""],
    ["ZANAHORIA", "", 0.0169, ""],
    ["ZANAHORA", "", 0.0494, ""],
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
    ["ZANAHORA", 1, "oz", "typo of zanahoria"],
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
 * Same shape as the April Los Ranchos file, plus the Latin American
 * kitchen units that the real SUB RECETAS tab uses (GALON, PAQUETE,
 * SOBRES, UNIDA, BOLSA, CAJA), parenthetical / mixed / oversized pack
 * sizes that must go to needs-a-look, one genuinely bad row (ingredient
 * name in the unit column), a cover tab with no headers, and a second
 * recipe tab. No client data.
 */
export function buildLosRanchosKitchenUnitsWorkbook(): Buffer {
  const wb = XLSX.read(buildLosRanchosCostWorkbook(), { type: "buffer" });

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
    ["LISTA DE PRECIOS LOS RANCHOS — ABRIL 2026"],
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
  ];
  wb.Sheets["Lista de precios"] = XLSX.utils.aoa_to_sheet(price);

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["INDICE"], ["Los Ranchos — costos abril"], [""]]),
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
