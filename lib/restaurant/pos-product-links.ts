// lib/restaurant/pos-product-links.ts
//
// POS product classification and link states (#162 / #163).
// POS is the source of truth. AI / fuzzy matching may only suggest.
// Only a person moves a link to Confirmado — never the sync, never a
// ranking pass, never a missing-row default.

// How each POS product is costed (premise 8). Only a person sets a
// treatment; code may suggest one. Migration 040 widens the CHECK.
export const POS_PRODUCT_CLASSIFICATIONS = [
  "por_clasificar",
  "plato_preparado",
  "reventa",
  "modificador_con_costo",
  "modificador_sin_costo",
  "combo",
  "excluido",
] as const;
export type PosProductClassification =
  (typeof POS_PRODUCT_CLASSIFICATIONS)[number];

/** Values written before migration 040, read as their treatment. */
export const LEGACY_CLASSIFICATIONS: Record<string, PosProductClassification> =
  {
    requiere_receta: "plato_preparado",
    componente: "modificador_con_costo",
    no_requiere_costeo: "excluido",
  };

export const POS_PRODUCT_LINK_STATES = [
  "sin_vincular",
  "sugerido",
  "confirmado",
] as const;
export type PosProductLinkState = (typeof POS_PRODUCT_LINK_STATES)[number];

export const LINK_STATE_LABELS: Record<PosProductLinkState, string> = {
  sin_vincular: "Sin vincular",
  sugerido: "Sugerido",
  confirmado: "Confirmado",
};

export const CLASSIFICATION_LABELS: Record<PosProductClassification, string> = {
  por_clasificar: "Por clasificar",
  plato_preparado: "Plato preparado",
  reventa: "Reventa",
  modificador_con_costo: "Modificador con costo",
  modificador_sin_costo: "Modificador sin costo",
  combo: "Combo",
  excluido: "Excluido (no es comida)",
};

export interface PosProductLinkRecord {
  id?: string;
  company_id: string;
  location_id: string | null;
  odoo_product_id: number;
  odoo_name: string;
  classification: PosProductClassification;
  menu_item_id: string | null;
  link_state: PosProductLinkState;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmed_how: string | null;
  evidence: Record<string, unknown>;
}

/** Evidence key holding who chose the treatment (kept across suggestions). */
export const TREATMENT_EVIDENCE_KEY = "treatment";

export interface LinkConfirmation {
  confirmed_by: string;
  confirmed_at: string;
  confirmed_how: string;
}

export function isPosProductClassification(
  value: unknown
): value is PosProductClassification {
  return (
    typeof value === "string" &&
    (POS_PRODUCT_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

/** Stored value -> treatment. Legacy values map to their new name;
 *  anything unknown is "por_clasificar". */
export function classificationFromStored(
  value: unknown
): PosProductClassification {
  if (isPosProductClassification(value)) return value;
  if (typeof value === "string" && LEGACY_CLASSIFICATIONS[value]) {
    return LEGACY_CLASSIFICATIONS[value]!;
  }
  return "por_clasificar";
}

export function isPosProductLinkState(
  value: unknown
): value is PosProductLinkState {
  return (
    typeof value === "string" &&
    (POS_PRODUCT_LINK_STATES as readonly string[]).includes(value)
  );
}

/** Implicit row when sales exist but nobody has classified or linked yet. */
export function unlinkedPosProduct(
  input: Pick<
    PosProductLinkRecord,
    "company_id" | "odoo_product_id" | "odoo_name"
  > & { location_id?: string | null }
): PosProductLinkRecord {
  return {
    company_id: input.company_id,
    location_id: input.location_id ?? null,
    odoo_product_id: input.odoo_product_id,
    odoo_name: input.odoo_name,
    classification: "por_clasificar",
    menu_item_id: null,
    link_state: "sin_vincular",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
  };
}

/**
 * Suggestion only. Never writes confirmado, confirmed_by, confirmed_at
 * or confirmed_how — a person must call confirmPosProductLink.
 */
export function suggestPosProductLink(
  base: PosProductLinkRecord,
  input: {
    menu_item_id: string;
    evidence: Record<string, unknown>;
    classification?: PosProductClassification;
  }
): PosProductLinkRecord {
  return {
    ...base,
    menu_item_id: input.menu_item_id,
    classification: input.classification ?? base.classification,
    evidence: {
      ...input.evidence,
      ...(base.evidence[TREATMENT_EVIDENCE_KEY]
        ? { [TREATMENT_EVIDENCE_KEY]: base.evidence[TREATMENT_EVIDENCE_KEY] }
        : {}),
    },
    link_state: "sugerido",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
  };
}

/**
 * A menu draft on a link. A Confirmado link keeps its state, its plato and
 * who/when/how confirmed it: only the evidence changes (the draft is stored
 * there). Any other link becomes a suggestion, as before. Never downgrades.
 */
export function withMenuDraftEvidence(
  base: PosProductLinkRecord,
  input: { menu_item_id: string; evidence: Record<string, unknown> }
): PosProductLinkRecord {
  if (
    base.link_state !== "confirmado" ||
    base.menu_item_id !== input.menu_item_id
  ) {
    return suggestPosProductLink(base, input);
  }
  return {
    ...base,
    evidence: {
      ...input.evidence,
      ...(base.evidence[TREATMENT_EVIDENCE_KEY]
        ? { [TREATMENT_EVIDENCE_KEY]: base.evidence[TREATMENT_EVIDENCE_KEY] }
        : {}),
    },
  };
}

export function confirmPosProductLinkError(
  confirmation: Partial<LinkConfirmation> | null | undefined
): string | null {
  const by = confirmation?.confirmed_by?.trim() ?? "";
  const at = confirmation?.confirmed_at?.trim() ?? "";
  const how = confirmation?.confirmed_how?.trim() ?? "";
  if (!by || !at || !how) {
    return "Solo una persona puede marcar el vínculo como Confirmado. Indica quién, cuándo y cómo.";
  }
  return null;
}

/**
 * The only function that may set link_state to confirmado.
 * Requires a recorded person (who / when / how).
 */
export function confirmPosProductLink(
  base: PosProductLinkRecord,
  confirmation: LinkConfirmation
): PosProductLinkRecord {
  const error = confirmPosProductLinkError(confirmation);
  if (error) {
    throw new Error(error);
  }
  return {
    ...base,
    link_state: "confirmado",
    confirmed_by: confirmation.confirmed_by.trim(),
    confirmed_at: confirmation.confirmed_at.trim(),
    confirmed_how: confirmation.confirmed_how.trim(),
  };
}

/**
 * Location-specific link wins; otherwise the company-wide (NULL location)
 * row. Other companies are ignored — caller still passes companyId.
 */
export function matchPosProductLink(
  links: readonly PosProductLinkRecord[],
  companyId: string,
  odooProductId: number,
  locationId: string | null
): PosProductLinkRecord | null {
  const same = links.filter(
    (link) =>
      link.company_id === companyId && link.odoo_product_id === odooProductId
  );
  if (locationId) {
    const scoped = same.find((link) => link.location_id === locationId);
    if (scoped) return scoped;
  }
  const companyWide = same.find((link) => link.location_id == null);
  if (companyWide || locationId) return companyWide ?? null;
  // "Todos los restaurantes": a product linked only for one restaurant is
  // still that link (the editor opened nothing and coverage missed it).
  // Several restaurants: the confirmed one first, then a stable order.
  const scopedOnly = same
    .filter((link) => link.location_id != null)
    .sort(
      (a, b) =>
        Number(b.link_state === "confirmado") -
          Number(a.link_state === "confirmado") ||
        String(a.location_id).localeCompare(String(b.location_id))
    );
  return scopedOnly[0] ?? null;
}

/**
 * The link that costs the sales of one restaurant: its own link, else the
 * company-wide one. Never another restaurant's link: under "Todos los
 * restaurantes", restaurant B's sales are not costed with a link that
 * only exists for restaurant A (they stay uncovered). Sales with no
 * restaurant take only the company-wide link.
 */
export function matchPosProductLinkForSales(
  links: readonly PosProductLinkRecord[],
  companyId: string,
  odooProductId: number,
  saleLocationId: string | null
): PosProductLinkRecord | null {
  const same = links.filter(
    (link) =>
      link.company_id === companyId && link.odoo_product_id === odooProductId
  );
  if (saleLocationId) {
    const scoped = same.find((link) => link.location_id === saleLocationId);
    if (scoped) return scoped;
  }
  return same.find((link) => link.location_id == null) ?? null;
}

export function odooProductIdFromMetadata(
  meta: Record<string, unknown> | null | undefined
): number | null {
  if (!meta) return null;
  const raw = meta.product_id ?? meta.odoo_product_id;
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}
