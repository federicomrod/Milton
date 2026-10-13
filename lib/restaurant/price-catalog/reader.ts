// Deterministic reader for a restaurant's ingredient price list
// (ITEM | LIBRA | ONZA | PRECIO UNITARIO).
//
// Plain code, no AI. It turns the sheet into catalog rows with a
// suggested unit and price. Anything it cannot settle on its own is
// marked so the user decides it: it never guesses a unit silently and
// never invents a number. Rows are read-only inputs; persisting them is
// a separate, explicit step.

export type CatalogUnit = "oz" | "lb" | "unit" | "g";

export type CatalogRowStatus =
  /** Unit and price were read directly. */
  | "ok"
  /** Price read, but the unit deserves one confirming look. */
  | "check_unit"
  /** More than one reading is possible: the user picks one. */
  | "ambiguous_unit"
  /** The price cell holds an error (for example a broken formula). */
  | "error_cell"
  | "no_price"
  /** Same name as an earlier row: skipped unless the user keeps it. */
  | "duplicate_name";

export type CatalogReason =
  | "unit_marker"
  | "per_oz_column"
  | "per_gram_inferred"
  | "package_not_multiple_of_16"
  | "lb_or_unit_marker"
  | "single_price_no_unit"
  | "price_and_unit_columns_both_set"
  | "portion_price"
  | "error_cell"
  | "duplicate_name"
  /** LIBRA/UNIDAD label: per libra in ONZA's column, per unidad in D. */
  | "lb_and_unit_prices"
  /** The same number under LIBRA and ONZA: it cannot be both. */
  | "same_price_lb_and_oz"
  /** Under a production section (PLANTA … PRODUCCION): a preparation. */
  | "preparation_section";

export interface CatalogUnitOption {
  unit: CatalogUnit;
  unitCost: number;
}

export interface PriceCatalogRow {
  /** Stable key: `${sheet}|${row}` (1-based sheet row). */
  key: string;
  sheet: string;
  row: number;
  section: string | null;
  name: string;
  /** What the row most likely is. The user can change it. */
  kind: "ingredient" | "preparation";
  status: CatalogRowStatus;
  unit: CatalogUnit | null;
  unitCost: number | null;
  /** Value of the LIBRA column when it was a number (a purchase price). */
  packagePrice: number | null;
  /** packagePrice / per-oz price, when both exist. */
  divisor: number | null;
  /** Readings the user can pick from when status needs a decision. */
  options: CatalogUnitOption[];
  reasons: CatalogReason[];
}

export interface PriceCatalogRead {
  sheet: string;
  headerRow: number;
  rows: PriceCatalogRow[];
}

const PREPARATION_SECTION = /produc|prepar|elabor|planta/;

function plain(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.startsWith("#")) return null;
    const n = Number(text.replace(/^\$/, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isErrorCell(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("#");
}

type Marker = CatalogUnit | "portion" | "lb_or_unit" | null;

/** What a text cell in the price columns says about the unit. */
export function readUnitMarker(value: unknown): Marker {
  if (typeof value !== "string") return null;
  const text = plain(value);
  if (!text || text.startsWith("#")) return null;
  if (/LIBRA\s*\/\s*UNIDAD|UNIDAD\s*\/\s*LIBRA/.test(text)) return "lb_or_unit";
  if (/PORCION/.test(text)) return "portion";
  if (/ONZA/.test(text)) return "oz";
  if (/LIBRA/.test(text)) return "lb";
  if (/UNIDAD|TORTA|PIEZA/.test(text)) return "unit";
  return null;
}

interface Columns {
  name: number;
  lb: number | null;
  oz: number | null;
  unitPrice: number | null;
}

function detectHeader(
  aoa: readonly unknown[][]
): { row: number; cols: Columns } | null {
  const limit = Math.min(aoa.length, 15);
  for (let r = 0; r < limit; r++) {
    const cells = (aoa[r] ?? []).map(plain);
    const name = cells.findIndex((c) =>
      /^(ITEM|INGREDIENTE|PRODUCTO|ARTICULO|NOMBRE)$/.test(c)
    );
    if (name < 0) continue;
    const lb = cells.findIndex((c) => /^(LIBRA|LB|LIBRAS)$/.test(c));
    const oz = cells.findIndex((c) => /^(ONZA|OZ|ONZAS)$/.test(c));
    const unitPrice = cells.findIndex((c) =>
      /^(PRECIO UNITARIO|PRECIO|PRECIO POR UNIDAD|UNIDAD)$/.test(c)
    );
    if (lb < 0 && oz < 0 && unitPrice < 0) continue;
    return {
      row: r,
      cols: {
        name,
        lb: lb >= 0 ? lb : null,
        oz: oz >= 0 ? oz : null,
        unitPrice: unitPrice >= 0 ? unitPrice : null,
      },
    };
  }
  return null;
}

function isMultipleOf16(divisor: number): boolean {
  const ratio = divisor / 16;
  return Math.abs(ratio - Math.round(ratio)) < 0.02 && Math.round(ratio) >= 1;
}

function isMultipleOfGramsPerLb(divisor: number): boolean {
  const ratio = divisor / 453.59;
  return Math.abs(ratio - Math.round(ratio)) < 0.01 && Math.round(ratio) >= 1;
}

function nameKey(value: string): string {
  return plain(value);
}

/** Does this sheet look like an ingredient price list? */
export function looksLikePriceCatalog(aoa: readonly unknown[][]): boolean {
  const header = detectHeader(aoa);
  if (!header) return false;
  let priced = 0;
  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (isBlank(row[header.cols.name])) continue;
    const cells = [header.cols.lb, header.cols.oz, header.cols.unitPrice]
      .filter((i): i is number => i !== null)
      .map((i) => row[i]);
    if (cells.some((cell) => asNumber(cell) !== null)) priced += 1;
    if (priced >= 8) return true;
  }
  return false;
}

export function readPriceCatalog(
  sheet: string,
  aoa: readonly unknown[][]
): PriceCatalogRead | null {
  const header = detectHeader(aoa);
  if (!header) return null;
  const { cols } = header;

  const rows: PriceCatalogRow[] = [];
  const seen = new Map<string, string>();
  let section: string | null = null;

  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const name = cleanName(row[cols.name]);
    if (!name) continue;

    const lbCell = cols.lb !== null ? row[cols.lb] : undefined;
    const ozCell = cols.oz !== null ? row[cols.oz] : undefined;
    const upCell = cols.unitPrice !== null ? row[cols.unitPrice] : undefined;

    if (isBlank(lbCell) && isBlank(ozCell) && isBlank(upCell)) {
      // A row with only a name is a section heading.
      section = name;
      continue;
    }

    const lb = asNumber(lbCell);
    const oz = asNumber(ozCell);
    const up = asNumber(upCell);
    const marker = readUnitMarker(lbCell) ?? readUnitMarker(ozCell);
    const reasons: CatalogReason[] = [];
    const options: CatalogUnitOption[] = [];
    let status: CatalogRowStatus = "ok";
    let unit: CatalogUnit | null = null;
    let unitCost: number | null = null;
    let packagePrice: number | null = lb !== null && lb > 0 ? lb : null;
    let divisor: number | null = null;

    const hasUp = up !== null && up > 0;
    const hasOz = oz !== null && oz > 0;
    const hasLb = lb !== null && lb > 0;

    if (marker === "lb_or_unit") {
      // "LIBRA/ UNIDAD" in LIBRA's column: the ONZA column holds the price
      // per libra and PRECIO UNITARIO the price per unidad. Both are read;
      // the libra price is the ingredient's price (recipes weigh it).
      reasons.push("lb_or_unit_marker");
      const asLb = hasOz ? oz : hasLb ? lb : null;
      if (asLb !== null && asLb !== undefined)
        options.push({ unit: "lb", unitCost: asLb });
      if (hasUp) options.push({ unit: "unit", unitCost: up });
      const first = options[0];
      if (first) {
        unit = first.unit;
        unitCost = first.unitCost;
        if (options.length > 1) reasons.push("lb_and_unit_prices");
      } else if (isErrorCell(ozCell) || isErrorCell(upCell)) {
        status = "error_cell";
        reasons.push("error_cell");
      } else {
        status = "no_price";
      }
      packagePrice = null;
    } else if (marker && hasUp) {
      if (marker === "portion") {
        unit = "unit";
        reasons.push("portion_price");
      } else {
        unit = marker;
        reasons.push("unit_marker");
      }
      unitCost = up;
      packagePrice = null;
    } else if (hasOz) {
      unit = "oz";
      unitCost = oz;
      reasons.push("per_oz_column");
      if (hasUp) {
        status = "ambiguous_unit";
        reasons.push("price_and_unit_columns_both_set");
        options.push({ unit: "oz", unitCost: oz });
        options.push({ unit: "unit", unitCost: up });
        unit = null;
        unitCost = null;
      } else if (hasLb) {
        divisor = lb / oz;
        if (Math.abs(divisor - 1) <= 0.02) {
          // The same number under LIBRA and ONZA cannot be both: ask.
          status = "ambiguous_unit";
          reasons.push("same_price_lb_and_oz");
          options.push({ unit: "unit", unitCost: oz });
          options.push({ unit: "oz", unitCost: oz });
          options.push({ unit: "lb", unitCost: lb });
          unit = null;
          unitCost = null;
        } else if (isMultipleOfGramsPerLb(divisor)) {
          // The sheet header says ONZA, but the price was divided by the
          // grams in the package (453.6 per lb): it is a per-gram price.
          unit = "g";
          reasons.push("per_gram_inferred");
        } else if (!isMultipleOf16(divisor)) {
          // The columns say it: LIBRA is the package price, ONZA the price
          // per onza. Divided by something other than 16 (a package size);
          // kept as information, never asked.
          reasons.push("package_not_multiple_of_16");
        }
      }
    } else if (hasUp) {
      unit = "unit";
      unitCost = up;
      reasons.push("unit_marker");
      packagePrice = null;
    } else if (hasLb) {
      status = "ambiguous_unit";
      reasons.push("single_price_no_unit");
      options.push({ unit: "lb", unitCost: lb });
      options.push({ unit: "unit", unitCost: lb });
      options.push({ unit: "oz", unitCost: lb });
    } else if (
      isErrorCell(lbCell) ||
      isErrorCell(ozCell) ||
      isErrorCell(upCell)
    ) {
      status = "error_cell";
      reasons.push("error_cell");
    } else {
      status = "no_price";
    }

    const key = nameKey(name);
    const earlier = seen.get(key);
    if (earlier) {
      status = "duplicate_name";
      reasons.push("duplicate_name");
    } else {
      seen.set(key, `${sheet}|${r + 1}`);
    }

    const sectionIsPrep = section
      ? PREPARATION_SECTION.test(plain(section).toLowerCase())
      : false;
    // Rows under a production section are the kitchen's own: no question.
    if (sectionIsPrep) reasons.push("preparation_section");
    rows.push({
      key: `${sheet}|${r + 1}`,
      sheet,
      row: r + 1,
      section,
      name,
      kind:
        sectionIsPrep || marker === "portion" ? "preparation" : "ingredient",
      status,
      unit,
      unitCost,
      packagePrice,
      divisor,
      options,
      reasons,
    });
  }

  return { sheet, headerRow: header.row + 1, rows };
}

/** Pick the sheet that holds the ingredient price list, if any. */
export function findPriceCatalog(
  sheets: ReadonlyArray<{ name: string; aoa?: unknown[][] }>
): PriceCatalogRead | null {
  let best: PriceCatalogRead | null = null;
  let bestScore = -1;
  for (const sheet of sheets) {
    if (!sheet.aoa || !looksLikePriceCatalog(sheet.aoa)) continue;
    const read = readPriceCatalog(sheet.name, sheet.aoa);
    if (!read) continue;
    const nameBonus = /bodega|precio|lista|ingrediente|insumo/i.test(sheet.name)
      ? 1000
      : 0;
    const score = nameBonus + read.rows.length;
    if (score > bestScore) {
      best = read;
      bestScore = score;
    }
  }
  return best;
}
