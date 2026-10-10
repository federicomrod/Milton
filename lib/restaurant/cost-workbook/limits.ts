export const MAX_WORKBOOK_TABS = 40;
export const MAX_ROWS_PER_SHEET = 5000;
export const MAX_WORKBOOK_CELLS = 200_000;

export class WorkbookLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookLimitError";
  }
}

export function assertWorkbookLimits(input: {
  tabCount: number;
  rowsPerSheet: number[];
  cellCount: number;
}): void {
  if (input.tabCount > MAX_WORKBOOK_TABS) {
    throw new WorkbookLimitError(
      `This file has ${input.tabCount} tabs. Maximum is ${MAX_WORKBOOK_TABS}.`
    );
  }
  for (const rows of input.rowsPerSheet) {
    if (rows > MAX_ROWS_PER_SHEET) {
      throw new WorkbookLimitError(
        `A sheet has ${rows} rows. Maximum is ${MAX_ROWS_PER_SHEET} rows per tab.`
      );
    }
  }
  if (input.cellCount > MAX_WORKBOOK_CELLS) {
    throw new WorkbookLimitError(
      `This file has ${input.cellCount} cells. Maximum is ${MAX_WORKBOOK_CELLS}.`
    );
  }
}
