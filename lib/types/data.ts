// Shared data types for transactions, budgets, and CRM deals

export interface TransactionData {
  id: string;
  date: string;
  amount: number | string;
  category?: string | null;
  name?: string | null;
  description?: string | null;
  reference?: string | null;
  user_id?: string;
}

export interface BudgetData {
  id?: string;
  month: string;
  category: string;
  value: number | string;
  user_id?: string;
}

export interface CrmDealData {
  id: string;
  deal_name?: string | null;
  dealName?: string | null; // camelCase variant
  client_name?: string | null;
  clientName?: string | null; // camelCase variant
  amount: number | string;
  phase?: string | null;
  stage?: string | null;
  company?: string | null;
  owner?: string | null;
  product?: string | null;
  created_date?: string | null;
  first_appointment?: string | null;
  close_date?: string | null;
  closing_date?: string | null;
  closingDate?: string | null; // camelCase variant
  user_id?: string;
}

export interface NormalizedTransaction {
  id: string;
  date: string;
  amount: number;
  category: string;
  name?: string;
  description?: string;
  reference?: string;
}

export interface NormalizedBudget {
  month: string;
  category: string;
  value: number;
}

// Data Tables - Centralized table definitions
export interface DataTableField {
  name: string;
  type: string;
  required: boolean;
  primaryKey?: boolean;
  references?: { table: string; field?: string };
  defaultValue?: unknown;
  allowedValues?: string[];
}

export interface DataTable {
  id: string;
  slug: string;
  name: string;
  description?: string;
  fields: DataTableField[];
  created_at: string;
  updated_at: string;
}

// Data Table Relationships
export interface DataTableRelationship {
  from_table: string;
  from_field: string;
  to_table: string;
  to_field: string;
  relationship_id: string;
  relationship_type:
    | "one_to_one"
    | "one_to_many"
    | "many_to_one"
    | "many_to_many";
}

// User Roles
export type UserRole = "user" | "admin";
