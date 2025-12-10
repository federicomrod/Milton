// types/use-cases.ts

// ===========================
// USE CASE DEFINITIONS
// ===========================

export interface UseCase {
  id: string
  name: string
  description: string
  industry: string
  businessModel: string
  requiredDataTypes: DataType[]
  requiredMetrics: MetricDefinition[]
  aiPromptContext: string // Context for AI to understand this business type
}

export interface DataType {
  id: string
  name: string
  description: string
  requiredFields: string[]
  optionalFields: string[]
  expectedFormats: string[]
}

// ===========================
// METRIC DEFINITIONS
// ===========================

export interface MetricDefinition {
  id: string
  name: string
  description: string
  category: 'financial' | 'growth' | 'efficiency' | 'pipeline'
  priority: 'core' | 'important' | 'advanced'
  calculation: CalculationRule
  requiredInputs: DataInput[]
  unit: 'currency' | 'percentage' | 'number' | 'days' | 'months'
  frequency: 'monthly' | 'quarterly' | 'annual' | 'real-time'
  benchmarks?: BenchmarkRange[]
}

export interface CalculationRule {
  formula: string // Human-readable formula
  logic: string // Detailed calculation logic for AI
  conditions?: string[] // Special conditions or edge cases
  examples?: CalculationExample[]
}

export interface DataInput {
  field: string
  type: 'amount' | 'date' | 'category' | 'boolean' | 'text'| 'number'
  source: 'transactions' | 'crm' | 'budget' | 'manual'
  filters?: string[] // How to identify relevant data
  required: boolean
}

export interface CalculationExample {
  scenario: string
  inputs: Record<string, any>
  expectedOutput: number
  explanation: string
}

export interface BenchmarkRange {
  range: string
  description: string
  color: 'green' | 'yellow' | 'red'
}

// ===========================
// B2B STARTUP USE CASE
// ===========================

export const B2B_STARTUP_USE_CASE: UseCase = {
  id: 'b2b-startup',
  name: 'B2B Startup',
  description: 'Tech startups selling software/services to other businesses with subscription or contract-based revenue',
  industry: 'Technology',
  businessModel: 'B2B SaaS/Services',
  aiPromptContext: `
    This is a B2B startup that typically has:
    - Subscription-based recurring revenue (MRR/ARR)
    - Contract-based deals with sales cycles
    - Monthly/annual billing cycles
    - Key metrics: MRR, ARR, Burn Rate, Runway, Customer metrics
    - Sales pipeline with stages: Lead → Contact → Qualification → Negotiation → Closed
    - Revenue categories: Subscriptions, Professional Services, One-time fees
    - Expense categories: Salaries, Marketing, COGS, Operating expenses
  `,
  requiredDataTypes: [
    {
      id: 'transactions',
      name: 'Bank Transactions',
      description: 'Monthly financial transactions showing revenue and expenses',
      requiredFields: ['date', 'amount', 'description'],
      optionalFields: ['category', 'reference', 'counterparty'],
      expectedFormats: ['CSV', 'Excel']
    },
    {
      id: 'crm',
      name: 'CRM/Sales Data',
      description: 'Sales pipeline data with deal stages and amounts',
      requiredFields: ['deal_name', 'amount', 'stage', 'client'],
      optionalFields: ['close_date', 'probability', 'product', 'source'],
      expectedFormats: ['CSV', 'Excel']
    },
    {
      id: 'budget',
      name: 'Budget/Forecast',
      description: 'Monthly budget projections for revenue and expenses',
      requiredFields: ['category', 'monthly_amounts'],
      optionalFields: ['variance_tracking', 'notes'],
      expectedFormats: ['Excel']
    }
  ],
  requiredMetrics: [] // Will be populated below
}

// ===========================
// METRIC DEFINITIONS FOR B2B STARTUP
// ===========================

export const B2B_STARTUP_METRICS: MetricDefinition[] = [
  {
    id: 'mrr',
    name: 'Monthly Recurring Revenue (MRR)',
    description: 'Predictable monthly revenue from subscriptions and recurring contracts',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'Sum of all recurring revenue in the current month',
      logic: `
        1. Identify recurring revenue transactions (subscriptions, monthly contracts)
        2. Filter transactions for current month
        3. Sum positive amounts where category contains: subscription, recurring, monthly, SaaS, contract
        4. Exclude one-time payments, setup fees, refunds
        5. If no recurring revenue found, use total monthly revenue as fallback
      `,
      conditions: [
        'Only include positive amounts',
        'Exclude refunds and chargebacks',
        'Recurring patterns: monthly, subscription, wiederkehrend (German)'
      ],
      examples: [
        {
          scenario: 'Pure subscription business',
          inputs: { 
            'Jan Subscription Revenue': 15000,
            'Jan Professional Services': 5000,
            'Jan Setup Fees': 2000
          },
          expectedOutput: 15000,
          explanation: 'Only subscription revenue counts as MRR, not one-time services or fees'
        }
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'transactions',
        filters: ['subscription', 'recurring', 'monthly', 'contract'],
        required: true
      },
      {
        field: 'date',
        type: 'date',
        source: 'transactions',
        required: true
      },
      {
        field: 'category',
        type: 'category',
        source: 'transactions',
        filters: ['revenue', 'income'],
        required: false
      }
    ],
    benchmarks: [
      { range: '< $10k', description: 'Early stage', color: 'yellow' },
      { range: '$10k - $100k', description: 'Growth stage', color: 'green' },
      { range: '> $100k', description: 'Scale stage', color: 'green' }
    ]
  },
  
  {
    id: 'arr',
    name: 'Annual Recurring Revenue (ARR)',
    description: 'Annualized value of recurring revenue contracts',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'MRR × 12',
      logic: 'Calculate current MRR and multiply by 12 to get annual run rate',
      examples: [
        {
          scenario: 'Standard calculation',
          inputs: { mrr: 25000 },
          expectedOutput: 300000,
          explanation: 'ARR = MRR × 12 = $25,000 × 12 = $300,000'
        }
      ]
    },
    requiredInputs: [
      {
        field: 'mrr',
        type: 'amount',
        source: 'transactions',
        required: true
      }
    ]
  },

  {
    id: 'billings',
    name: 'Monthly Billings',
    description: 'Total amount invoiced/billed to customers in the current month',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'Sum of all positive revenue transactions in current month',
      logic: `
        1. Filter transactions for current month
        2. Include all positive revenue transactions (recurring + one-time)
        3. Categories: subscriptions, services, setup fees, professional services
        4. Exclude refunds, chargebacks, internal transfers
      `,
      conditions: [
        'Include both recurring and one-time revenue',
        'Exclude negative amounts (refunds)',
        'Match invoice dates, not cash receipt dates'
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'transactions',
        filters: ['revenue', 'positive'],
        required: true
      }
    ]
  },

  {
    id: 'gross_burn_rate',
    name: 'Monthly Gross Burn Rate',
    description: 'Total monthly operating expenses before considering revenue',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'Sum of all operating expenses in current month',
      logic: `
        1. Filter transactions for current month
        2. Sum absolute value of negative amounts
        3. Include: salaries, rent, marketing, software, professional services
        4. Exclude: COGS, one-time investments, loan payments
      `,
      conditions: [
        'Only operating expenses (OpEx)',
        'Exclude Cost of Goods Sold (COGS)',
        'Exclude capital expenditures'
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'transactions',
        filters: ['expense', 'opex', 'operating'],
        required: true
      }
    ]
  },

  {
    id: 'net_burn_rate',
    name: 'Monthly Net Burn Rate',
    description: 'Net cash used per month (expenses minus revenue)',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'Gross Burn Rate - Monthly Revenue',
      logic: 'Total monthly expenses minus total monthly revenue. Positive = burning cash, Negative = cash positive',
      examples: [
        {
          scenario: 'Burning cash',
          inputs: { grossBurn: 50000, revenue: 30000 },
          expectedOutput: 20000,
          explanation: 'Net burn = $50k expenses - $30k revenue = $20k burn'
        },
        {
          scenario: 'Cash positive',
          inputs: { grossBurn: 30000, revenue: 50000 },
          expectedOutput: -20000,
          explanation: 'Net burn = $30k expenses - $50k revenue = -$20k (cash positive)'
        }
      ]
    },
    requiredInputs: [
      {
        field: 'gross_burn_rate',
        type: 'amount',
        source: 'transactions',
        required: true
      },
      {
        field: 'monthly_revenue',
        type: 'amount',
        source: 'transactions',
        required: true
      }
    ]
  },

  {
    id: 'cash_runway',
    name: 'Cash Runway',
    description: 'Number of months the company can operate with current cash and burn rate',
    category: 'financial',
    priority: 'core',
    unit: 'months',
    frequency: 'monthly',
    calculation: {
      formula: 'Current Cash Balance ÷ Net Burn Rate',
      logic: `
        1. Calculate current cash balance (sum of all transactions)
        2. Calculate current net burn rate
        3. If net burn is negative (cash positive), return ∞
        4. If net burn is positive, divide cash by burn rate
      `,
      conditions: [
        'Only calculate if net burn > 0',
        'Return infinity symbol if cash positive',
        'Round to nearest month'
      ]
    },
    requiredInputs: [
      {
        field: 'cash_balance',
        type: 'amount',
        source: 'transactions',
        required: true
      },
      {
        field: 'net_burn_rate',
        type: 'amount',
        source: 'transactions',
        required: true
      }
    ],
    benchmarks: [
      { range: '< 6 months', description: 'Critical - Need funding soon', color: 'red' },
      { range: '6-12 months', description: 'Moderate - Plan fundraising', color: 'yellow' },
      { range: '> 12 months', description: 'Healthy runway', color: 'green' }
    ]
  },

  {
    id: 'cash_balance',
    name: 'Cash Balance',
    description: 'Current total cash available (cumulative of all transactions)',
    category: 'financial',
    priority: 'core',
    unit: 'currency',
    frequency: 'real-time',
    calculation: {
      formula: 'Sum of all historical transactions',
      logic: 'Running total of all positive and negative cash flows from bank transactions',
      conditions: [
        'Include all cash movements',
        'Positive = money in, Negative = money out',
        'Real-time running balance'
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'transactions',
        required: true
      }
    ]
  },

  {
    id: 'net_income',
    name: 'Monthly Net Income',
    description: 'Total monthly revenue minus all expenses (profit/loss)',
    category: 'financial',
    priority: 'important',
    unit: 'currency',
    frequency: 'monthly',
    calculation: {
      formula: 'Monthly Revenue - Monthly Expenses',
      logic: 'Sum of all positive transactions (revenue) minus sum of all negative transactions (expenses) for the month',
      conditions: [
        'Include all revenue types',
        'Include all expense types (COGS + OpEx)',
        'Positive = profit, Negative = loss'
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'transactions',
        required: true
      }
    ]
  },

  {
    id: 'sales_pipeline_by_stage',
    name: 'Sales Pipeline by Stage',
    description: 'Total deal value and count at each stage of the sales process',
    category: 'pipeline',
    priority: 'core',
    unit: 'currency',
    frequency: 'real-time',
    calculation: {
      formula: 'Sum of deal amounts grouped by sales stage',
      logic: `
        1. Group deals by stage/phase
        2. Sum total value per stage
        3. Count number of deals per stage
        4. Calculate average deal size per stage
      `,
      conditions: [
        'Exclude closed-lost deals from active pipeline',
        'Include probability weighting if available',
        'Standard stages: Lead → Contact → Qualification → Negotiation → Closed'
      ]
    },
    requiredInputs: [
      {
        field: 'amount',
        type: 'amount',
        source: 'crm',
        required: true
      },
      {
        field: 'stage',
        type: 'category',
        source: 'crm',
        required: true
      },
      {
        field: 'probability',
        type: 'number',
        source: 'crm',
        required: false
      }
    ]
  },

  {
    id: 'pipeline_by_close_date',
    name: 'Pipeline by Expected Close Date',
    description: 'Deals grouped by expected closing month for forecasting',
    category: 'pipeline',
    priority: 'important',
    unit: 'currency',
    frequency: 'real-time',
    calculation: {
      formula: 'Sum of deal amounts grouped by expected close date',
      logic: `
        1. Group deals by expected close month
        2. Sum total value per month
        3. Apply probability weighting if available
        4. Show next 6 months forecast
      `,
      conditions: [
        'Only include active pipeline (not closed)',
        'Group by month/quarter',
        'Apply stage-based probability weights'
      ]
    },
    requiredInputs: [
      {
        field: 'close_date',
        type: 'date',
        source: 'crm',
        required: true
      },
      {
        field: 'amount',
        type: 'amount',
        source: 'crm',
        required: true
      }
    ]
  }
]

// Update the use case with metrics
B2B_STARTUP_USE_CASE.requiredMetrics = B2B_STARTUP_METRICS

// ===========================
// SCHEMA REGISTRY
// ===========================

export const USE_CASES: UseCase[] = [
  B2B_STARTUP_USE_CASE
  // Future: RESTAURANT_USE_CASE, ECOMMERCE_USE_CASE, etc.
]

export const getUseCase = (id: string): UseCase | undefined => {
  return USE_CASES.find(useCase => useCase.id === id)
}

export const getMetricDefinition = (useCaseId: string, metricId: string): MetricDefinition | undefined => {
  const useCase = getUseCase(useCaseId)
  return useCase?.requiredMetrics.find(metric => metric.id === metricId)
}

// ===========================
// AI PROMPT GENERATION
// ===========================

export const generateAIPromptForUseCase = (useCase: UseCase, fileName: string, headers: string[], sampleData: any[]) => {
  return `
You are an expert financial data analyst for ${useCase.name} businesses.

BUSINESS CONTEXT: ${useCase.aiPromptContext}

REQUIRED METRICS FOR THIS BUSINESS TYPE:
${useCase.requiredMetrics.map(metric => `
- ${metric.name}: ${metric.description}
  Required inputs: ${metric.requiredInputs.map(input => input.field).join(', ')}
  Calculation: ${metric.calculation.formula}
`).join('')}

FILE ANALYSIS:
- File: ${fileName}
- Headers: ${JSON.stringify(headers)}
- Sample data: ${JSON.stringify(sampleData.slice(0, 3))}

Your task is to map the file columns to the standard schema fields needed for calculating the metrics above.

RESPONSE FORMAT (JSON only):
{
  "fileType": "transactions|crm|budget",
  "confidence": 0.8-1.0,
  "reasoning": "explanation of your analysis",
  "columnMappings": [
    {
      "originalHeader": "exact header name",
      "suggestedField": "standard field name",
      "confidence": 0.8-1.0,
      "aiReasoning": "why this mapping makes sense"
    }
  ],
  "businessInsights": {
    "revenueColumns": ["columns that contain revenue"],
    "expenseColumns": ["columns that contain expenses"],
    "recurringRevenue": ["columns with recurring revenue patterns"],
    "primaryAmountColumn": "main amount column",
    "dateFormat": "detected date format",
    "numberFormat": "detected number format"
  }
}
`
}