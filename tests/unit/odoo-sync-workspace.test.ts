import { describe, it, expect } from "vitest";
import {
  canSyncSelectedWorkspace,
  findOwnCompany,
  formatWorkspaceLastSyncLine,
  syncWorkspaceCopy,
} from "@/lib/restaurant/odoo/sync-workspace";
import { compactLastSync } from "@/lib/restaurant/odoo/sync-summary";

describe("canSyncSelectedWorkspace", () => {
  it("allows sync only when the selector is the signed-in workspace", () => {
    expect(canSyncSelectedWorkspace("own-1", "own-1")).toBe(true);
    expect(canSyncSelectedWorkspace("other-2", "own-1")).toBe(false);
  });

  it("fails closed when either id is missing", () => {
    expect(canSyncSelectedWorkspace("own-1", null)).toBe(false);
    expect(canSyncSelectedWorkspace("", "own-1")).toBe(false);
    expect(canSyncSelectedWorkspace(undefined, undefined)).toBe(false);
  });
});

describe("findOwnCompany", () => {
  const companies = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Bravo", is_own: true },
    { id: "c", name: "Charlie" },
  ];

  it("prefers the is_own flag from GET /api/admin/companies", () => {
    expect(findOwnCompany(companies)?.id).toBe("b");
  });

  it("falls back to an explicit own id", () => {
    expect(findOwnCompany(companies.slice(0, 1), "a")?.name).toBe("Alpha");
    expect(findOwnCompany(companies.slice(0, 1), "missing")).toBeNull();
  });
});

describe("syncWorkspaceCopy", () => {
  it("names the workspace that Sync now will update", () => {
    expect(
      syncWorkspaceCopy({
        canSync: true,
        ownCompanyName: "Casa Prueba",
        selectedCompanyName: "Casa Prueba",
      })
    ).toEqual({
      targetLine:
        "Se sincronizará Casa Prueba, el espacio en el que iniciaste sesión.",
      blockedReason: null,
    });
  });

  it("explains why Sync now is disabled for another company", () => {
    const copy = syncWorkspaceCopy({
      canSync: false,
      ownCompanyName: "Casa Prueba",
      selectedCompanyName: "Demo Co",
    });
    expect(copy.targetLine).toBe(
      "«Sincronizar ahora» siempre actualiza Casa Prueba, no Demo Co."
    );
    expect(copy.blockedReason).toBe(
      "Elige Casa Prueba arriba para activar «Sincronizar ahora»."
    );
  });
});

describe("formatWorkspaceLastSyncLine", () => {
  it("labels last sync with the selected company so it cannot look like another workspace", () => {
    const last = compactLastSync(
      {
        synced_range: { start_date: "2026-07-01", end_date: "2026-07-31" },
        orders_fetched: 10,
        rows_upserted: 20,
      },
      new Date("2026-10-10T12:00:00.000Z")
    );
    const line = formatWorkspaceLastSyncLine(last, "Demo Co", false);
    expect(line.startsWith("Última sincronización de Demo Co · ")).toBe(true);
    expect(line).toContain("10 pedidos");
    expect(line).toContain("20 filas guardadas");
  });

  it("does not invite a click when Sync now is locked", () => {
    expect(formatWorkspaceLastSyncLine(null, "Demo Co", false)).toBe(
      "No hay registro de sincronización de Demo Co. «Sincronizar ahora» solo actualiza tu espacio actual."
    );
    expect(formatWorkspaceLastSyncLine(null, "Casa Prueba", true)).toBe(
      "Aún no se ha sincronizado Casa Prueba. Elige un rango de fechas y toca «Sincronizar ahora»."
    );
  });
});
