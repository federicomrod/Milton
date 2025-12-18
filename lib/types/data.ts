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
