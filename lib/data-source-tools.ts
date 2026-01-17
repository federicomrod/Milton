// lib/data-source-tools.ts
// Tool definitions for data source declarations

export type DataSourceCategory =
  | "online_banking"
  | "crm"
  | "accounting"
  | "expense_management"
  | "hr"
  | "cms"
  | "g_docs";

export interface ToolDefinition {
  id: string;
  name: string;
  category: DataSourceCategory;
  hasIntegration?: boolean; // Whether we have an active integration for this tool
}

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  // Manual File Upload - Currently Supported
  {
    id: "sheets_excel",
    name: "Sheets/Excel",
    category: "g_docs",
    hasIntegration: true, // This is supported via manual file upload
  },

  // Online Banking - Not yet supported
  {
    id: "banking_psd2",
    name: "Banking (EU/EEA) via PSD2 Open Banking",
    category: "online_banking",
    hasIntegration: false,
  },
  {
    id: "banking_six",
    name: "Banking (Switzerland) via SIX bLink",
    category: "online_banking",
    hasIntegration: false,
  },

  // CRM - Not yet supported
  { id: "hubspot", name: "HubSpot", category: "crm", hasIntegration: false },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm",
    hasIntegration: false,
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "crm",
    hasIntegration: false,
  },

  // Accounting - Not yet supported
  {
    id: "datev",
    name: "DATEV (Germany)",
    category: "accounting",
    hasIntegration: false,
  },
  {
    id: "lexoffice",
    name: "lexoffice (Germany)",
    category: "accounting",
    hasIntegration: false,
  },
  {
    id: "sevdesk",
    name: "sevDesk (Germany)",
    category: "accounting",
    hasIntegration: false,
  },
  {
    id: "bexio",
    name: "bexio (Switzerland)",
    category: "accounting",
    hasIntegration: false,
  },
  {
    id: "abacus",
    name: "Abacus (Switzerland)",
    category: "accounting",
    hasIntegration: false,
  },

  // Nice to have (commented for MVP, can be enabled later)
  // { id: 'personio', name: 'Personio', category: 'hr', hasIntegration: false },
  // { id: 'pleo', name: 'Pleo', category: 'expense_management', hasIntegration: false },
  // { id: 'spendesk', name: 'Spendesk', category: 'expense_management', hasIntegration: false },
  // { id: 'stripe', name: 'Stripe', category: 'accounting', hasIntegration: false },
  // { id: 'shopify', name: 'Shopify', category: 'cms', hasIntegration: false },
];

export const CATEGORY_LABELS: Record<DataSourceCategory, string> = {
  online_banking: "Online Banking",
  crm: "CRM",
  accounting: "Accounting",
  expense_management: "Expense Management",
  hr: "HR",
  cms: "CMS",
  g_docs: "Google Docs",
};

// Check if any selected tools have available integrations
export function hasAvailableIntegrations(selectedToolIds: string[]): boolean {
  const selectedTools = AVAILABLE_TOOLS.filter((tool) =>
    selectedToolIds.includes(tool.id)
  );
  return selectedTools.some((tool) => tool.hasIntegration === true);
}
