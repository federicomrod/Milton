// Aprobar is decided on the LIVE lines (the ones the editor totals), by ONE
// function used by the screen and the server. Synthetic data.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  fixStepFor,
  liveApproval,
} from "@/lib/restaurant/recipe-costing/approval-live";
import { approveRecipeVersion } from "@/lib/restaurant/recipe-costing/approval-server";
import { primaryAction } from "@/lib/restaurant/recipe-costing/plato";

const line = (over: Record<string, unknown> = {}) =>
  ({
    key: "l1",
    kind: "ingredient",
    ingredient_id: "i1",
    component_id: null,
    raw_name: "SAL",
    name: "Sal",
    qty: 1,
    unit: "g",
    amount: 1,
    price: { unit: "g" },
    pending: false,
    flags: ["ok"],
    ...over,
  }) as never;

const owner = { user_id: "u1", role: "owner", is_milton_staff: false };
const actor = (can_approve = true) => ({
  user_id: "u",
  role: "owner",
  is_milton_staff: false,
  can_approve,
  can_submit: true,
  needs_client_confirmation: false,
});
// The stored evidence says "pending, no yield": it must not matter.
const staleEditor = {
  link_state: "sugerido",
  recipe_status: "borrador",
  checklist: { ready: false, blockers: ["Hay líneas pendientes."] },
} as never;

const punta = [line({ key: "a" }), line({ key: "b", amount: 4.53 })];
const entrana = [
  line({ key: "a" }),
  line({
    key: "p",
    kind: "component",
    component_id: "c-ent",
    raw_name: "ENTRAÑA",
    name: "ENTRAÑA",
    component_approved: false,
  }),
];
const pollo = [
  line({
    key: "p",
    raw_name: "POLLO",
    name: "POLLO",
    amount: null,
    pending: true,
    flags: ["pendiente_costo"],
  }),
];
const puyazo = [
  line({
    key: "u",
    raw_name: "PUYAZO",
    name: "PUYAZO",
    unit: "orden",
    amount: null,
    pending: true,
    price: { unit: "lb" },
    flags: ["pendiente_unidad"],
  }),
];

describe("liveApproval", () => {
  it("Punta Jalapeña: priced lines, stale evidence, no yield -> Aprobar enabled", () => {
    expect(liveApproval({ lines: punta }).ready).toBe(true);
    expect(
      primaryAction(actor(), staleEditor, true, { lines: punta })
    ).toMatchObject({ label: "Aprobar", enabled: true, blocker: null });
  });

  it("a dish with no lines is blocked", () => {
    expect(liveApproval({ lines: [] }).first?.kind).toBe("no_lines");
  });

  it("Entraña: an unapproved preparation blocks, and the link opens it", () => {
    const action = primaryAction(actor(), staleEditor, true, {
      lines: entrana,
    });
    expect(action?.enabled).toBe(false);
    expect(action?.blocker?.text).toBe(
      "Primero aprueba la preparación ENTRAÑA"
    );
    const step = fixStepFor(action!.blocker!, 0);
    expect(step).toEqual({ do: "open_preparation", componentId: "c-ent" });
  });

  it("an approved preparation does not block", () => {
    const ok = entrana.map((l) =>
      (l as { kind: string }).kind === "component"
        ? ({ ...(l as object), component_approved: true } as never)
        : l
    );
    expect(liveApproval({ lines: ok }).ready).toBe(true);
  });

  it("a line without price: Falta el precio de POLLO, link asks for the price editor", () => {
    const b = liveApproval({ lines: pollo }).first!;
    expect(b.text).toBe("Falta el precio de POLLO");
    expect(fixStepFor(b, 4)).toEqual({
      do: "focus_line",
      request: { lineKey: "p", what: "price", nonce: 5 },
    });
  });

  it("a unit mismatch asks the unit question on that line", () => {
    const b = liveApproval({ lines: puyazo }).first!;
    expect(b.text).toBe("Falta decir cuántas lb lleva 1 orden de PUYAZO");
    expect(fixStepFor(b, 0)).toEqual({
      do: "focus_line",
      request: { lineKey: "u", what: "unit_question", nonce: 1 },
    });
  });

  it("an unresolved line blocks", () => {
    expect(
      liveApproval({
        lines: [line({ kind: "unresolved", amount: null, name: null })],
      }).first?.kind
    ).toBe("unresolved");
  });

  it("unsaved classification blocks until saved", () => {
    const b = liveApproval({ lines: punta, classification_unsaved: true });
    expect(b.first?.text).toBe("Guarda el tipo de plato primero");
    expect(fixStepFor(b.first!, 0)).toEqual({ do: "focus_classification" });
    expect(liveApproval({ lines: punta }).ready).toBe(true);
  });

  it("gray reason is the first blocker; a manager still has no Aprobar", () => {
    expect(
      primaryAction(actor(false), staleEditor, true, { lines: pollo })?.label
    ).toBe("Enviar a aprobación");
  });
});

function fakeDb() {
  const writes: unknown[] = [];
  const db = {
    from() {
      let isUpdate = false;
      let head = false;
      const b: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return b;
        },
        update: (p: unknown) => {
          isUpdate = true;
          writes.push(p);
          return b;
        },
        eq: () => b,
        then: (resolve: (v: unknown) => unknown) => {
          if (isUpdate) return resolve({ error: null });
          if (head) return resolve({ count: 1, error: null });
          return resolve({
            data: [
              {
                id: "v1",
                status: "in_review",
                version_number: 1,
                effective_date: null,
              },
            ],
            error: null,
          });
        },
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}
const version = {
  id: "v1",
  recipe_id: "r1",
  menu_item_id: "m1",
  version_number: 1,
  status: "in_review",
  effective_date: null,
  source_type: "manual",
  notes: null,
};
const approve = (lines: unknown[], who = owner) => {
  const { db, writes } = fakeDb();
  return approveRecipeVersion({
    supabase: db,
    companyId: "co",
    actor: who,
    recipeVersionId: "v1",
    odooProductId: 7,
    version: version as never,
    loadLiveLines: async () => ({
      ok: true,
      version_id: "v1",
      lines: lines as never,
    }),
  }).then((result) => ({ result, writes }));
};

describe("approveRecipeVersion agrees with the screen", () => {
  it("approves when the screen would enable Aprobar (no yield needed)", async () => {
    const { result, writes } = await approve(punta);
    expect(result).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
  });

  it.each([
    ["Entraña", entrana],
    ["Pollo", pollo],
    ["Puyazo", puyazo],
  ])("refuses %s with the screen's first reason", async (_n, lines) => {
    const { result, writes } = await approve(lines);
    const first = liveApproval({ lines: lines as never }).first!.text;
    expect(result).toEqual({ ok: false, error: first });
    expect(writes).toHaveLength(0);
  });

  it("refuses a version the editor does not show", async () => {
    const { db } = fakeDb();
    const r = await approveRecipeVersion({
      supabase: db,
      companyId: "co",
      actor: owner,
      recipeVersionId: "v1",
      odooProductId: 7,
      version: version as never,
      loadLiveLines: async () => ({ ok: true, version_id: "v2", lines: punta }),
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("denies a manager with the Spanish message; staff-less viewer too", async () => {
    const { result, writes } = await approve(punta, {
      user_id: "m",
      role: "manager",
      is_milton_staff: false,
    });
    expect(result).toEqual({
      ok: false,
      error:
        "Como gerente puedes enviar a aprobación, pero solo el dueño o un admin aprueba.",
    });
    expect(writes).toHaveLength(0);
  });
});
