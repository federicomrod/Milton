import * as XLSX from "xlsx";

/**
 * Synthetic "COSTO RESTAURANTE" workbook for the recipe import. Made-up
 * restaurant, dishes and prices — no client data. Same layout as a real
 * kitchen cost file: blocks stacked in column B (title, Articulo header,
 * lines, COSTO TOTAL, PRECIO POR …, PRECIO DE VENTA SIN IVA), costs that
 * point at other tabs, #ERROR! cells, a sectioned side-dish tab and an
 * events tab.
 */

type CellSpec =
  | string
  | number
  | null
  | { v?: unknown; f?: string; t?: "n" | "s" | "e" };

const HEADER = [
  "Articulo",
  "Unidad Detalle",
  "Cantidad",
  "Costo Unitario",
  "Total Costo",
];
/** The real file stores the broken cells as the text "#ERROR!". */
const ERROR: CellSpec = "#ERROR!";

function sheet(rows: Record<number, CellSpec[]>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxRow = 0;
  for (const [rowText, cells] of Object.entries(rows)) {
    const r = Number(rowText) - 1;
    maxRow = Math.max(maxRow, r);
    cells.forEach((spec, i) => {
      if (spec === null || spec === undefined) return;
      const ref = XLSX.utils.encode_cell({ r, c: i + 1 }); // column B onward
      if (typeof spec === "string") ws[ref] = { t: "s", v: spec };
      else if (typeof spec === "number") ws[ref] = { t: "n", v: spec };
      else
        ws[ref] = {
          t: spec.t ?? (typeof spec.v === "string" ? "s" : "n"),
          v: spec.v,
          ...(spec.f ? { f: spec.f } : {}),
        } as XLSX.CellObject;
    });
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: 7 },
  });
  return ws;
}

const price = (withIva: number): CellSpec => ({
  v: withIva / 1.13,
  f: `${withIva}/1.13`,
});

export function buildSyntheticCostWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheet({
      1: ["RESTAURANTE DE PRUEBA"],
      5: ["COSTO RESTAURANTE"],
      6: ["CARNE DE PRUEBA 2 LIBRA"],
      7: HEADER,
      8: ["CORTE DE PRUEBA", "LIBRA", 2, 8, { v: 16, f: "+E8*D8" }],
      9: ["COSTO TOTAL", null, null, null, { v: 16, f: "SUM(F8:G8)" }],
      10: ["PRECIO POR ONZA", null, null, null, { v: 0.5, f: "F9/2/16" }],
      14: ["COSTO RESTAURANTE"],
      15: ["ACOMPAÑAMIENTO DE PRUEBA"],
      16: HEADER,
      17: ["ARROZ BLANCO", "ONZA", 4, 0.05, { v: 0.2, f: "+E17*D17" }],
      18: ["SALSA CASERA", "ONZA", 2, ERROR, ERROR],
      19: [
        "COSTO TOTAL RENDIMIENTO",
        null,
        null,
        null,
        { v: 0.2, f: "SUM(F17:G18)" },
      ],
    }),
    "SUB RECETAS"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet({
      4: ["COSTO RESTAURANTE"],
      5: ["GUARNICIONES"],
      6: HEADER,
      7: ["OPCIONES BASICAS"],
      8: ["PAPA", "ONZA", 2, 0.1, { v: 0.2, f: "+E8*D8" }],
      9: ["YUCA", "ONZA", 2, 0.2, { v: 0.4, f: "+E9*D9" }],
      10: [
        "OPCIONES PREMIUM",
        null,
        null,
        null,
        { v: 0.3, f: "AVERAGE(F8:G9)" },
      ],
      11: ["VEGETALES", "ORDEN", 1, 0.5, { v: 0.5, f: "+E11*D11" }],
      12: [
        "COSTO TOTA PROMEDIO",
        null,
        null,
        null,
        { v: 1.47, f: "AVERAGE(F8:G11)*4" },
      ],
    }),
    "GUARNICIONES"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet({
      2: ["RESTAURANTE DE PRUEBA"],
      5: ["COSTO RESTAURANTE"],
      6: ["ASADO DE PRUEBA 6 "],
      7: HEADER,
      8: ["ASADO DE RES", "ONZA", 6, 0.5, { v: 3, f: "+E8*D8" }],
      9: [
        "ACOMPAÑAMIENTO",
        "ORDEN",
        1,
        { v: 0.2, f: "SUM('SUB RECETAS'!F19)" },
        { v: 0.2, f: "+E9*D9" },
      ],
      10: ["SAL", "GRAMO", 3, 0.001, { v: 0.003, f: "+E10*D10" }],
      11: ["PIMIENTA", "GRAMO", 0, 0.01, { v: 0, f: "+E11*D11" }],
      12: ["QUESO DE PRUEBA", "ONZA", 1, ERROR, ERROR],
      13: ["COSTO TOTAL", null, null, null, { v: 3.203, f: "SUM(F8:G12)" }],
      14: ["PRECIO DE VENTA SIN IVA", null, null, null, price(19.99)],
      15: ["MARGEN DE CONTRIBUCION", null, null, null, 14.487],
      18: ["COSTO RESTAURANTE"],
      19: ["ASADO DE PRUEBA 8"],
      20: HEADER,
      21: ["ASADO DE RES", "ONZA", 8, 0.55, { v: 4.4, f: "+E21*D21" }],
      22: ["ACEITE", "ONZA", 1, 0.08, { v: 0.08, f: "+E22*D22" }],
      23: ["COSTO TOTAL", null, null, null, { v: 4.4, f: "SUM(F21:G21)" }],
      24: ["PRECIO DE VENTA SIN IVA", null, null, null, price(23.99)],
    }),
    "DE LA PARRILLA"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet({
      5: ["COSTO RESTAURANTE"],
      6: ["PARRILLADA DE PRUEBA PARA 3"],
      7: HEADER,
      8: ["ASADO DE RES", "LIBRA", 1, 8, { v: 8, f: "+E8*D8" }],
      9: ["CONVOY", "UNIIDAD", 1, 0.9, { v: 0.9, f: "+E9*D9" }],
      10: ["COSTO TOTAL", null, null, null, { v: 8.9, f: "SUM(F8:G9)" }],
      11: ["PRECIO DE VENTA SIN IVA", null, null, null, price(48.99)],
    }),
    "PARRILLADAS"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet({
      5: ["COSTO RESTAURANTE"],
      6: ["ASADO DE PRUEBA 6"],
      7: HEADER,
      8: ["ASADO DE RES", "ONZA", 6, 0.5, { v: 3, f: "+E8*D8" }],
      9: ["COSTO TOTAL", null, null, null, { v: 3, f: "SUM(F8:G8)" }],
      10: ["PRECIO DE VENTA SIN IVA", null, null, null, price(19.99)],
    }),
    "MENU EVENTOS 2026"
  );

  return wb;
}

export function buildSyntheticCostWorkbookBuffer(): Buffer {
  return XLSX.write(buildSyntheticCostWorkbook(), {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}
