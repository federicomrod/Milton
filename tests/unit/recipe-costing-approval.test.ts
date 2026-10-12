import { describe, expect, it } from "vitest";
import {
  actorCanApprove,
  actorCanConfirmLink,
  actorCanSubmitForApproval,
  buildApprovalChecklist,
} from "@/lib/restaurant/recipe-costing/approval";
import { parseSuggestionEvidence } from "@/lib/restaurant/recipe-costing/evidence";

const owner = { user_id: "u1", role: "owner", is_milton_staff: false };
const admin = { user_id: "u2", role: "admin", is_milton_staff: false };
const manager = { user_id: "u3", role: "manager", is_milton_staff: false };
const staff = { user_id: "u4", role: "member", is_milton_staff: true };

describe("approval roles", () => {
  it("lets the owner or admin approve and a manager only send for approval", () => {
    expect(actorCanApprove(owner).ok).toBe(true);
    expect(actorCanApprove(admin).ok).toBe(true);
    expect(actorCanApprove(manager).ok).toBe(false);
    expect(actorCanSubmitForApproval(manager)).toBe(true);
    expect(actorCanApprove(staff).ok).toBe(false);
  });

  it("lets Milton staff approve only with a recorded confirmation", () => {
    expect(
      actorCanApprove(staff, {
        confirmed_by: "u4",
        confirmed_at: "2026-10-12T18:00:00Z",
        confirmed_how: "whatsapp",
      }).ok
    ).toBe(true);
    expect(actorCanApprove(staff, { confirmed_how: "" }).ok).toBe(false);
    expect(
      actorCanConfirmLink(staff, {
        confirmed_by: "u4",
        confirmed_at: "2026-10-12T18:00:00Z",
        confirmed_how: "correo",
      }).ok
    ).toBe(true);
  });
});

describe("approval checklist gate", () => {
  const pendingEvidence = parseSuggestionEvidence({
    pending: true,
    yield: { value: 1, unit: "orden", source: "assumed" },
    excel_match: "mismatch",
    reasons: ["Rendimiento asumido: 1 orden (el Excel solo trae COSTO TOTAL)"],
    lines: [
      {
        raw_name: "QUESILLO",
        qty: 1,
        unit: "g",
        unit_cost: null,
        pending: true,
        flags: ["pendiente_costo"],
        reasons: [
          "esta línea quedó pendiente: falta el costo de QUESILLO. No puse $0",
        ],
      },
      {
        raw_name: "APIO",
        qty: 1,
        unit: "APIO",
        unit_cost: null,
        pending: true,
        flags: ["pendiente_unidad"],
        reasons: [
          "esta línea quedó pendiente: la unidad (APIO) parece el nombre de un ingrediente",
        ],
      },
    ],
  });

  it("blocks Aprobar when lines are pending, yield is assumed or units are invalid", () => {
    const checklist = buildApprovalChecklist({
      link_state: "sugerido",
      evidence: pendingEvidence,
    });
    expect(checklist.no_pending_lines).toBe(false);
    expect(checklist.yield_confirmed).toBe(false);
    expect(checklist.units_valid).toBe(false);
    expect(checklist.ready).toBe(false);
    expect(checklist.blockers.length).toBeGreaterThan(0);
  });

  it("opens the gate when there are no pending lines, yield is confirmed and units are valid", () => {
    const ready = buildApprovalChecklist({
      link_state: "confirmado",
      evidence: parseSuggestionEvidence({
        pending: false,
        yield: { value: 4, unit: "orden", source: "excel" },
        excel_match: "match",
        lines: [
          {
            raw_name: "Pollo",
            qty: 200,
            unit: "g",
            unit_cost: 0.012,
            pending: false,
            flags: ["ok"],
            reasons: [],
          },
        ],
      }),
    });
    expect(ready.no_pending_lines).toBe(true);
    expect(ready.yield_confirmed).toBe(true);
    expect(ready.units_valid).toBe(true);
    expect(ready.ready).toBe(true);
  });
});
