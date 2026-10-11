import type { CostWorkbookRepo } from "./repo";
import type { CompanyCostResetSummary } from "./types";

export const RESET_CONFIRM_FALLBACK = "START OVER";

export function resetConfirmationMatches(
  typed: string,
  expected: string
): boolean {
  return (
    typed.trim().toLocaleLowerCase("es-419") ===
    expected.trim().toLocaleLowerCase("es-419")
  );
}

export async function resetCompanyCostData(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<CompanyCostResetSummary> {
  return repo.resetCompanyCostCatalog(companyId);
}
