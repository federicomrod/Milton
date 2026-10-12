export const WORKBOOK_COST_ABS_TOLERANCE = 0.05;
export const WORKBOOK_COST_REL_TOLERANCE = 0.02;

export function workbookCostTolerance(excel: number): number {
  return Math.max(
    WORKBOOK_COST_ABS_TOLERANCE,
    Math.abs(excel) * WORKBOOK_COST_REL_TOLERANCE
  );
}

export function workbookVarianceAmount(
  excel: number,
  milton: number
): number {
  return milton - excel;
}

export function workbookVariancePct(
  excel: number,
  milton: number
): number | null {
  if (!Number.isFinite(excel) || excel === 0) return null;
  return ((milton - excel) / Math.abs(excel)) * 100;
}

export function workbookCostsMatch(excel: number, milton: number): boolean {
  if (!Number.isFinite(excel) || !Number.isFinite(milton)) return false;
  return (
    Math.abs(workbookVarianceAmount(excel, milton)) <=
    workbookCostTolerance(excel) + 1e-9
  );
}

export function decideWorkbookCostMatch(
  excel: number | null | undefined,
  milton: number | null | undefined
): "match" | "mismatch" | null {
  if (excel == null || !Number.isFinite(excel)) return null;
  if (milton == null || !Number.isFinite(milton)) return "mismatch";
  return workbookCostsMatch(excel, milton) ? "match" : "mismatch";
}

export function workbookVarianceFields(
  excel: number | null | undefined,
  milton: number | null | undefined
): {
  workbook_variance_amount: number | null;
  workbook_variance_pct: number | null;
} {
  if (excel == null || !Number.isFinite(excel)) {
    return { workbook_variance_amount: null, workbook_variance_pct: null };
  }
  if (milton == null || !Number.isFinite(milton)) {
    return { workbook_variance_amount: null, workbook_variance_pct: null };
  }
  return {
    workbook_variance_amount: workbookVarianceAmount(excel, milton),
    workbook_variance_pct: workbookVariancePct(excel, milton),
  };
}
