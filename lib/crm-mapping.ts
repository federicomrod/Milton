// lib/crm-mapping.ts
export type CrmStage =
  | "lead_generation"
  | "first_contact"
  | "need_qualification"
  | "negotiation"
  | "deal"
  | "no_deal";

export interface CrmMapping {
  amount: string; // e.g. 'Amount'
  stage: string; // e.g. 'Deal Phase'
  company?: string; // e.g. 'Company'
  owner?: string; // e.g. 'Owner'
  closeDate?: string; // e.g. 'Deal Closing Date'
  createdDate?: string; // e.g. 'Created Date'
}

// Default mapping for dummy_crm_deals.csv
export const DEFAULT_CRM_MAPPING: CrmMapping = {
  amount: "Amount",
  stage: "Deal Phase",
  company: "Company",
  owner: "Owner",
  closeDate: "Deal Closing Date",
};

export function mapStage(raw: string): CrmStage {
  const s = (raw || "").toLowerCase().trim();

  if (!s) return "lead_generation";

  if (s.includes("no deal") || s.includes("lost")) return "no_deal";
  if (s.includes("lead")) return "lead_generation";
  if (s.includes("first contact") || s.includes("contact"))
    return "first_contact";
  if (s.includes("qualification")) return "need_qualification";
  if (s.includes("negotiation")) return "negotiation";
  if (s.includes("deal") || s.includes("won")) return "deal";

  return "lead_generation";
}
