// lib/schemas.ts
import { z } from "zod"

export const TransactionRow = z.object({
  date: z.string().min(1, "Missing date"),
  description: z.string().min(1, "Missing description"),
  amount: z.coerce.number(), // coerce turns "2500" into 2500
  category: z.string().min(1, "Missing category"),
  reference: z.string().optional(),
})
export type TransactionRow = z.infer<typeof TransactionRow>

export const CrmDealRow = z.object({
  deal_name: z.string(),
  phase: z.string(),
  amount: z.coerce.number(),
  client_name: z.string(),
  first_appointment: z.string().optional(),
  closing_date: z.string().optional(),
  product: z.string().optional(),
})
export type CrmDealRow = z.infer<typeof CrmDealRow>

export const BudgetRow = z.object({
  month: z.string(), // e.g. "Jan 2025" or "2025-01"
  category: z.string(),
  value: z.coerce.number(),
})
export type BudgetRow = z.infer<typeof BudgetRow>