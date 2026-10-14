// lib/restaurant/recipe-costing/preparation-optimistic.ts
//
// What Preparaciones shows the instant "Aprobar" is pressed (R1-13), before
// the server answers. Pure. The server's answer replaces it; on an error the
// caller puts the row back (approved = false).

import type { PreparationsOverview } from "./preparations-server";

export function withPreparationApproved(
  overview: PreparationsOverview,
  componentId: string,
  approved: boolean
): PreparationsOverview {
  const rows = overview.rows.map((row) =>
    row.component_id === componentId
      ? {
          ...row,
          status: approved ? ("aprobada" as const) : ("borrador" as const),
        }
      : row
  );
  return {
    ...overview,
    rows,
    drafts: rows.filter((r) => r.status === "borrador").length,
    approved: rows.filter((r) => r.status === "aprobada").length,
  };
}
