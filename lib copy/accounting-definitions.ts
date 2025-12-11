// Accounting Definitions for AI Data Processing
// This file provides comprehensive definitions to help the AI understand financial concepts
// and categorize transaction data correctly

export interface AccountingCategory {
  name: string
  type: 'revenue' | 'expense' | 'asset' | 'liability' | 'equity'
  description: string
  examples: string[]
  germanTerms: string[]
  englishTerms: string[]
}

export const ACCOUNTING_CATEGORIES: AccountingCategory[] = [
  // Revenue Categories
  {
    name: 'Revenue',
    type: 'revenue',
    description: 'Income from business activities',
    examples: ['sales', 'subscriptions', 'consulting fees', 'training revenue'],
    germanTerms: ['einnahmen', 'umsatz', 'erlös', 'trainings', 'coaching', 'programme', 'abonnement'],
    englishTerms: ['revenue', 'income', 'sales', 'subscription', 'consulting', 'training', 'coaching', 'program']
  },
  {
    name: 'Subscription Revenue',
    type: 'revenue',
    description: 'Recurring revenue from subscriptions',
    examples: ['monthly subscriptions', 'annual memberships', 'recurring services'],
    germanTerms: ['abonnement', 'subscription', 'wiederkehrend'],
    englishTerms: ['subscription', 'recurring', 'membership', 'monthly', 'annual']
  },
  {
    name: 'One-time Service',
    type: 'revenue',
    description: 'Revenue from one-time services',
    examples: ['consulting projects', 'training sessions', 'coaching sessions'],
    germanTerms: ['beratung', 'consulting', 'einmalig', 'projekt'],
    englishTerms: ['consulting', 'service', 'project', 'one-time', 'training', 'coaching']
  },

  // Expense Categories
  {
    name: 'COGS',
    type: 'expense',
    description: 'Cost of Goods Sold - direct costs of producing goods/services',
    examples: ['materials', 'direct labor', 'production costs'],
    germanTerms: ['warenkosten', 'herstellungskosten', 'materialkosten'],
    englishTerms: ['cogs', 'cost of goods', 'direct costs', 'production costs']
  },
  {
    name: 'Salaries',
    type: 'expense',
    description: 'Employee compensation and wages',
    examples: ['employee salaries', 'wages', 'payroll', 'bonuses'],
    germanTerms: ['gehälter', 'gehalt', 'lohn', 'löhne', 'gehaltszahlungen'],
    englishTerms: ['salary', 'salaries', 'wages', 'payroll', 'compensation']
  },
  {
    name: 'Marketing',
    type: 'expense',
    description: 'Marketing and advertising expenses',
    examples: ['advertising', 'promotional materials', 'marketing campaigns'],
    germanTerms: ['marketing', 'werbung', 'promotion'],
    englishTerms: ['marketing', 'advertising', 'promotion', 'campaign']
  },
  {
    name: 'Rent',
    type: 'expense',
    description: 'Office and equipment rental costs',
    examples: ['office rent', 'equipment lease', 'space rental'],
    germanTerms: ['miete', 'mietkosten', 'leasing'],
    englishTerms: ['rent', 'lease', 'rental', 'office rent']
  },
  {
    name: 'Software',
    type: 'expense',
    description: 'Software licenses and IT tools',
    examples: ['software licenses', 'SaaS subscriptions', 'IT tools'],
    germanTerms: ['software', 'lizenz', 'lizenzen', 'saas'],
    englishTerms: ['software', 'license', 'saas', 'it tools', 'subscription']
  },
  {
    name: 'Other OpEx',
    type: 'expense',
    description: 'Other operating expenses',
    examples: ['utilities', 'insurance', 'legal fees', 'accounting'],
    germanTerms: ['sonstiges', 'betriebskosten', 'nebenkosten'],
    englishTerms: ['other', 'miscellaneous', 'operating expenses', 'utilities']
  }
]

export interface FinancialMetrics {
  name: string
  description: string
  calculation: string
  formula: string
  germanTerms: string[]
  englishTerms: string[]
}

export const FINANCIAL_METRICS: FinancialMetrics[] = [
  {
    name: 'Revenue',
    description: 'Total income from business activities',
    calculation: 'Sum of all positive transaction amounts',
    formula: 'Revenue = Sum(positive transactions)',
    germanTerms: ['umsatz', 'einnahmen', 'erlös'],
    englishTerms: ['revenue', 'income', 'sales']
  },
  {
    name: 'Expenses',
    description: 'Total costs of running the business',
    calculation: 'Sum of all negative transaction amounts',
    formula: 'Expenses = Sum(negative transactions)',
    germanTerms: ['ausgaben', 'kosten', 'aufwendungen'],
    englishTerms: ['expenses', 'costs', 'expenditures']
  },
  {
    name: 'Net Income',
    description: 'Profit or loss after all expenses',
    calculation: 'Revenue minus Expenses',
    formula: 'Net Income = Revenue - Expenses',
    germanTerms: ['gewinn', 'verlust', 'ergebnis'],
    englishTerms: ['net income', 'profit', 'loss', 'earnings']
  },
  {
    name: 'Burn Rate',
    description: 'Rate at which company spends money',
    calculation: 'Monthly expenses minus monthly revenue',
    formula: 'Burn Rate = Monthly Expenses - Monthly Revenue',
    germanTerms: ['burn rate', 'verbrauchsrate'],
    englishTerms: ['burn rate', 'cash burn', 'spending rate']
  },
  {
    name: 'MRR',
    description: 'Monthly Recurring Revenue',
    calculation: 'Sum of all recurring monthly revenue',
    formula: 'MRR = Sum(monthly recurring revenue)',
    germanTerms: ['monatlicher wiederkehrender umsatz'],
    englishTerms: ['mrr', 'monthly recurring revenue']
  }
]

export interface BudgetStructure {
  revenueKeys: string[]
  expenseKeys: string[]
  commonFormats: string[]
}

export const BUDGET_STRUCTURE: BudgetStructure = {
  revenueKeys: ['MRR', 'mrr', 'Monthly Revenue', 'Revenue', 'Billings', 'Income'],
  expenseKeys: ['OPEX Total', 'Total FC', 'Total Costs', 'Expenses', 'Total Expenses', 'Fixed Costs', 'Variable Costs'],
  commonFormats: [
    'Jan 2025', 'Feb 2025', 'Mar 2025', // English format
    'Jan-25', 'Feb-25', 'Mar-25',       // Short format
    '2025-01', '2025-02', '2025-03'     // ISO format
  ]
}

// Helper function to categorize transactions based on accounting definitions
export function categorizeTransaction(
  description: string, 
  amount: number, 
  originalCategory?: string
): string {
  const lowerDesc = description.toLowerCase()
  const lowerCategory = originalCategory?.toLowerCase() || ''
  
  // Check if it's revenue (positive amount) or expense (negative amount)
  const isRevenue = amount > 0
  const isExpense = amount < 0
  
  // Find matching category based on description and original category
  for (const category of ACCOUNTING_CATEGORIES) {
    // Check if the transaction type matches the category type
    if ((isRevenue && category.type === 'revenue') || 
        (isExpense && category.type === 'expense')) {
      
      // Check German terms
      const hasGermanMatch = category.germanTerms.some(term => 
        lowerDesc.includes(term) || lowerCategory.includes(term)
      )
      
      // Check English terms
      const hasEnglishMatch = category.englishTerms.some(term => 
        lowerDesc.includes(term) || lowerCategory.includes(term)
      )
      
      if (hasGermanMatch || hasEnglishMatch) {
        return category.name
      }
    }
  }
  
  // Default categorization based on amount
  if (isRevenue) {
    return 'Revenue'
  } else if (isExpense) {
    return 'Other OpEx'
  }
  
  return originalCategory || 'Other'
}

// Helper function to identify budget keys
export function identifyBudgetKey(budgetData: any, keyType: 'revenue' | 'expense'): string | null {
  const keys = keyType === 'revenue' ? BUDGET_STRUCTURE.revenueKeys : BUDGET_STRUCTURE.expenseKeys
  
  for (const key of keys) {
    if (budgetData[key]) {
      return key
    }
  }
  
  return null
}

// Helper function to get month format from budget data
export function getMonthFormat(budgetData: any): string {
  // Check if budget has any data to determine format
  const firstKey = Object.keys(budgetData).find(key => 
    typeof budgetData[key] === 'object' && budgetData[key] !== null
  )
  
  if (firstKey && budgetData[firstKey]) {
    const monthKeys = Object.keys(budgetData[firstKey])
    if (monthKeys.length > 0) {
      return monthKeys[0] // Return the format of the first month key
    }
  }
  
  return 'Jan 2025' // Default format
} 