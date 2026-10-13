// The canonical recipe table: one fixed shape for every client file.
// A translator turns a client's workbook into these rows; the import and
// the rest of Milton only read this shape, never the client's layout.

export type CanonicalKind = "dish" | "preparation";

/** Why a line or recipe needs a look. Stable keys; the UI shows the copy. */
export type CanonicalFlag =
  /** Unit cost is #ERROR!, empty or $0 in the file: Pendiente, never $0. */
  | "costo_pendiente"
  /** Same ingredient and unit, another unit cost on another block. */
  | "costo_distinto"
  /** Same ingredient written with another unit in other recipes. */
  | "unidad_distinta"
  /** Unit the app does not know (typo or a name in the unit column). */
  | "unidad_no_reconocida"
  /** Quantity is 0 or missing. */
  | "cantidad_cero"
  /** The Excel's COSTO TOTAL formula does not include this line. */
  | "fuera_del_total_excel"
  /** The file's own line total is not quantity × unit cost. */
  | "total_linea_no_cuadra"
  /** Recipe: the Excel's COSTO TOTAL disagrees with its lines. */
  | "excel_no_cuadra"
  /** Recipe: no COSTO TOTAL row in the file. */
  | "sin_total_excel"
  /** Recipe: some lines have no cost yet. */
  | "lineas_pendientes"
  /** Preparation: the file averages its options (choose one). */
  | "promedio_de_opciones"
  /** Preparation: no "PRECIO POR …" row, yield taken as 1 orden. */
  | "rendimiento_supuesto"
  /** Recipe name used twice in the file; this one got a suffix. */
  | "nombre_repetido"
  /** Dish from the events menu tab. */
  | "menu_eventos";

export interface CanonicalLine {
  dish_name: string;
  size: string | null;
  ingredient_name: string;
  /** As written in the file. */
  unit: string | null;
  /** oz / lb / g / unit / … when the app knows it; else null. */
  unit_norm: string | null;
  quantity: number | null;
  /** Null = Pendiente. Never 0. */
  unit_cost: number | null;
  line_total: number | null;
  excel_total_cost: number | null;
  excel_price_sin_iva: number | null;
  source_tab: string;
  source_cell: string;
  flags: CanonicalFlag[];
  /** The preparation this line uses, when the file points at one. */
  preparation_key: string | null;
}

export interface CanonicalRecipe {
  /** Stable id inside one file: tab!cell of the title. */
  key: string;
  kind: CanonicalKind;
  /** Name to show (title without size or price tag, repeats suffixed). */
  name: string;
  /** Base dish name, without the size. */
  dish_name: string;
  size: string | null;
  /** Size number, for matching ("6" oz, "3" personas). */
  size_value: number | null;
  size_kind: "oz" | "personas" | null;
  source_tab: string;
  source_cell: string;
  excel_total_cost: number | null;
  excel_total_cell: string | null;
  excel_price_sin_iva: number | null;
  /** Preparations: what one batch yields. */
  output: { quantity: number; unit: string } | null;
  lines: CanonicalLine[];
  /** Σ quantity × unit cost over lines with both known. */
  calculated_cost: number;
  pending_lines: number;
  flags: CanonicalFlag[];
}

export interface CanonicalWorkbook {
  recipes: CanonicalRecipe[];
  /** Tabs read and blocks found per tab, for the preview. */
  tabs: Array<{ name: string; dishes: number; preparations: number }>;
}

/** pos_product_links.evidence.source for a dish imported from the file. */
export const EXCEL_IMPORT_SOURCE = "excel_import";

/** Excel COSTO TOTAL and our sum agree within this. */
export const EXCEL_MATCH_TOLERANCE = 0.05;
