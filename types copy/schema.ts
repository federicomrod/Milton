// types/schema.ts
// Unified schema definitions for normalized data output

export interface StandardTransaction {
  id: string
  date: string
  description: string
  amount: number
  category: string
  reference?: string
  account?: string
  type?: 'income' | 'expense'
}

export interface StandardDeal {
  id: string
  dealName: string
  phase: string
  amount: number
  clientName: string
  firstAppointment?: string
  closingDate?: string
  product?: string
  probability?: number
  source?: string
}

export interface StandardBudget {
  months: string[]
  categories: { [category: string]: { [month: string]: number } }
  totalBudget?: number
  actualSpent?: number
}

export interface StandardizedData {
  transactions?: StandardTransaction[]
  deals?: StandardDeal[]
  budget?: StandardBudget
}

export interface ColumnMapping {
  originalColumn: string
  standardField: string
  confidence: number
  dataType: 'string' | 'number' | 'date' | 'currency'
  transformation?: 'date_conversion' | 'currency_conversion' | 'text_cleanup' | 'none'
}

export interface DataProcessingResult {
  fileType: 'transactions' | 'deals' | 'budget'
  confidence: number
  suggestedMappings: ColumnMapping[]
  previewData: any[]
  issues: string[]
  needsManualReview: boolean
  autoMapped?: boolean
  businessInsights?: {
    detectedLanguage?: string
    dateFormat?: string
    currencyFormat?: string
    primaryAmount?: string
  }
}

// File type detection constants
export const FILE_TYPES = {
  TRANSACTIONS: 'transactions',
  DEALS: 'deals',
  BUDGET: 'budget'
} as const

export type FileType = typeof FILE_TYPES[keyof typeof FILE_TYPES]

// Standard field mappings
export const STANDARD_FIELDS = {
  // Transaction fields
  ID: 'id',
  DATE: 'date',
  DESCRIPTION: 'description',
  AMOUNT: 'amount',
  CATEGORY: 'category',
  REFERENCE: 'reference',
  ACCOUNT: 'account',
  TYPE: 'type',
  
  // Deal fields
  DEAL_NAME: 'dealName',
  CLIENT_NAME: 'clientName',
  PHASE: 'phase',
  PRODUCT: 'product',
  FIRST_APPOINTMENT: 'firstAppointment',
  CLOSING_DATE: 'closingDate',
  PROBABILITY: 'probability',
  SOURCE: 'source',
  
  // Budget fields
  BUDGET_CATEGORY: 'category',
  BUDGET_MONTH: 'month',
  BUDGET_AMOUNT: 'amount'
} as const

export type StandardField = typeof STANDARD_FIELDS[keyof typeof STANDARD_FIELDS]

// Phase constants for deals
export const DEAL_PHASES = {
  LEAD_GENERATION: 'Lead Generation',
  FIRST_CONTACT: 'First Contact',
  NEED_QUALIFICATION: 'Need Qualification',
  NEGOTIATION: 'Negotiation',
  DEAL: 'Deal',
  NO_DEAL: 'No Deal',
  UNKNOWN: 'Unknown'
} as const

export type DealPhase = typeof DEAL_PHASES[keyof typeof DEAL_PHASES]

// Data type constants
export const DATA_TYPES = {
  STRING: 'string',
  NUMBER: 'number',
  DATE: 'date',
  CURRENCY: 'currency'
} as const

export type DataType = typeof DATA_TYPES[keyof typeof DATA_TYPES]

// Transformation constants
export const TRANSFORMATIONS = {
  DATE_CONVERSION: 'date_conversion',
  CURRENCY_CONVERSION: 'currency_conversion',
  TEXT_CLEANUP: 'text_cleanup',
  NONE: 'none'
} as const

export type Transformation = typeof TRANSFORMATIONS[keyof typeof TRANSFORMATIONS] 