// Synthetic files for «Sube tus recetas». No client data.
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";

export function buildRecipeWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const platos: (string | number | null)[][] = [
    ["Pollo encebollado"],
    ["Porciones: 6"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Pollo", 3, "lb"],
    ["Cebolla", 2, "unidad"],
    ["Sal", "al gusto", null],
    [],
    ["Carne guisada"],
    ["Porciones: 8"],
    ["Tiempo: 1 h 30 min"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Carne de res", 4, "lb"],
    ["Achiote", 2, "cucharada"],
    ["* el achiote se puede cambiar por pimentón"],
    [],
    ["Pescado frito entero"],
    ["Rendimiento: 4 platos (1 pescado por plato)"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Pescado entero", 4, "unidad"],
    ["Limón", 2, "unidad"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(platos),
    "Platos fuertes"
  );

  const arroz: (string | number | null)[][] = [
    ["Porciones", 10],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Arroz", 5, "lb"],
    ["Pollo", 4, "lb"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(arroz),
    "Arroz con pollo"
  );

  const salsas: (string | number | null)[][] = [
    ["Salsa roja"],
    ["Rinde: 1 litro"],
    ["Tipo: preparación (sub-receta)"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Tomate", 3, "lb"],
    ["Chile", 4, "unidad"],
    [],
    ["Chimol"],
    ["Rinde: 2 tazas"],
    ["Ingrediente", "Cantidad", "Unidad"],
    ["Tomate", 2, "unidad"],
    ["Cebolla", 1, "unidad"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salsas), "Salsas");

  const proveedores: (string | number | null)[][] = [
    ["Proveedor", "Teléfono"],
    ["Distribuidora Uno (ficticia)", "0000-0001"],
    ["Distribuidora Dos (ficticia)", "0000-0002"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(proveedores),
    "Proveedores"
  );

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/** pages: lines of text per page (an empty array = a page with no text). */
export function buildPdf(pages: string[][]): Buffer {
  const doc = new jsPDF();
  pages.forEach((lines, i) => {
    if (i > 0) doc.addPage();
    lines.forEach((line, j) => doc.text(line, 10, 20 + j * 8));
  });
  return Buffer.from(doc.output("arraybuffer"));
}
