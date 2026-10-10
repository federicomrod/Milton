// Infer a default cost date from a filename or sheet title.
// "Abril-2026", "Costos_Los Ranchos_Abril-2026.xlsx", "2026-04" → 2026-04-01.

const MONTHS: Record<string, number> = {
  january: 1,
  febrero: 2,
  february: 2,
  marzo: 3,
  march: 3,
  abril: 4,
  april: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  june: 6,
  julio: 7,
  july: 7,
  agosto: 8,
  august: 8,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  octubre: 10,
  october: 10,
  noviembre: 11,
  november: 11,
  diciembre: 12,
  december: 12,
  enero: 1,
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatIsoDate(year: number, month: number, day = 1): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Best-effort month from a filename or sheet name. Returns YYYY-MM-DD
 * (first of the month) or null when nothing looks like a month+year.
 */
export function inferDateFromName(
  name: string | null | undefined
): string | null {
  if (!name) return null;
  const normalized = stripAccents(name).toLowerCase().replace(/[_]+/g, " ");

  const iso = normalized.match(/(20\d{2})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      const day = iso[3] ? Number(iso[3]) : 1;
      return formatIsoDate(year, month, day >= 1 && day <= 31 ? day : 1);
    }
  }

  const monthYear = normalized.match(
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b[\s\-/,._]*?(20\d{2})/
  );
  if (monthYear) {
    const month = MONTHS[monthYear[1]];
    const year = Number(monthYear[2]);
    if (month) return formatIsoDate(year, month);
  }

  const yearMonth = normalized.match(
    /(20\d{2})[\s\-/,._]*?\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = MONTHS[yearMonth[2]];
    if (month) return formatIsoDate(year, month);
  }

  return null;
}

export function inferWorkbookDate(
  filename: string,
  sheetNames: string[] = []
): string | null {
  const fromFile = inferDateFromName(filename);
  if (fromFile) return fromFile;
  for (const sheet of sheetNames) {
    const fromSheet = inferDateFromName(sheet);
    if (fromSheet) return fromSheet;
  }
  return null;
}
