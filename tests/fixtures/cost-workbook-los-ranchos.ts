import * as XLSX from "xlsx";

/**
 * Synthetic Los Ranchos-shaped workbook. No client data.
 * Price list (ambiguous PRECIO UNITARIO) + recipe + sub-recipe + two
 * Spanish category tabs with title rows above headers, one unknown unit,
 * one qty×price mismatch, and one price-list row that fails row checks.
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
    ["Salsa ranchera", 1, "unidad", "prep"],
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
