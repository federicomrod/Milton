'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DollarSign, TrendingUp, CreditCard, Activity, Users, Target, Wallet, Percent, Calendar, Zap } from 'lucide-react'
import { useUserPreferences } from '@/lib/context/UserPreferencesContext'
import { formatCurrency as formatCurrencyUtil, formatNumber, formatPercentage } from '@/lib/utils/formatters'

interface Transaction {
  id: string
  date: string
  name?: string
  description?: string
  amount: number
  reference: string
  category: string
}

interface Deal {
  id: string
  dealName: string
  phase: string
  amount: number
  clientName: string
  firstAppointment: string
  closingDate: string
  product: string
}

interface Metrics {
  mrr: number
  arr: number
  cashBalance: number
  burnRate: number
  burnRateLTM: number
  burnVariance: number
  ltmRevenue: number
  contractedRevenue: number
  grossMargin: number
  netMargin: number
  customerCount: number
  cac: number | null
  ltv: number | null
  churn: number | null
  nps: number | null
  runway: number
  quickRatio: number | null
}

interface MetricsGridProps {
  selectedMetrics?: string[]
}

export function MetricsGrid({ selectedMetrics = ['mrr', 'arr', 'cashBalance', 'burnRate', 'contracted', 'ltmRevenue', 'grossMargin', 'customers'] }: MetricsGridProps) {
  const { prefs } = useUserPreferences()
  const [metrics, setMetrics] = useState<Metrics>({
    mrr: 0,
    arr: 0,
    cashBalance: 0,
    burnRate: 0,
    burnRateLTM: 0,
    burnVariance: 0,
    ltmRevenue: 0,
    contractedRevenue: 0,
    grossMargin: 0,
    netMargin: 0,
    customerCount: 0,
    cac: null,
    ltv: null,
    churn: null,
    nps: null,
    runway: 0,
    quickRatio: null
  })

  // Safe helper functions with proper null/undefined checks
  const safeToString = (value: any): string => {
    if (value === null || value === undefined) return ''
    return String(value)
  }

  const safeToLowerCase = (value: any): string => {
    return safeToString(value).toLowerCase()
  }

  const safeParseFloat = (value: any): number => {
    if (value === null || value === undefined) return 0
    const parsed = parseFloat(value)
    return isNaN(parsed) ? 0 : parsed
  }

  // Helper function to classify revenue types with safe string handling
  const isRecurringRevenue = (category: any): boolean => {
    if (!category) return false
    const categoryStr = safeToLowerCase(category)
    const recurringCategories = ['subscription', 'monthly', 'recurring', 'mrr', 'wiederk']
    return recurringCategories.some(cat => categoryStr.includes(cat))
  }

  const isRevenue = (category: any): boolean => {
    if (!category) return false
    const categoryStr = safeToLowerCase(category)
    const revenueCategories = ['subscription', 'consulting', 'one-time service', 'service', 'sales', 'revenue', 'wiederk']
    return revenueCategories.some(cat => categoryStr.includes(cat))
  }

  const isCOGS = (category: any): boolean => {
    if (!category) return false
    const categoryStr = safeToLowerCase(category)
    return categoryStr.includes('cogs')
  }

  const validateTransaction = (tx: any): tx is Transaction => {
    // Check if transaction has required properties and they're valid
    // Note: enhanced-data-processor uses 'description' instead of 'name'
    return (
      tx &&
      typeof tx === 'object' &&
      tx.hasOwnProperty('id') &&
      tx.hasOwnProperty('date') &&
      tx.hasOwnProperty('amount') &&
      (tx.hasOwnProperty('name') || tx.hasOwnProperty('description')) &&
      tx.hasOwnProperty('category') &&
      !isNaN(safeParseFloat(tx.amount))
    )
  }

  const validateDeal = (deal: any): deal is Deal => {
    return (
      deal &&
      typeof deal === 'object' &&
      deal.hasOwnProperty('id') &&
      deal.hasOwnProperty('dealName') &&
      deal.hasOwnProperty('phase') &&
      deal.hasOwnProperty('amount') &&
      deal.hasOwnProperty('clientName') &&
      !isNaN(safeParseFloat(deal.amount))
    )
  }

  useEffect(() => {
    try {
      console.log('MetricsGrid: Starting calculation...')
      
      // Load all data sources with error handling
      const storedTransactions = localStorage.getItem('transactions')
      const storedCRM = localStorage.getItem('crmDeals')
      const storedBudget = localStorage.getItem('budget')
      const storedAIInsights = localStorage.getItem('aiBusinessInsights')
      
      console.log('Raw stored data:', {
        transactions: storedTransactions ? 'found' : 'not found',
        crm: storedCRM ? 'found' : 'not found',
        budget: storedBudget ? 'found' : 'not found',
        aiInsights: storedAIInsights ? 'found' : 'not found'
      })
      
      let transactions: Transaction[] = []
      let crmDeals: Deal[] = []
      let budget = null
      let aiInsights = null
      
      // Parse AI business insights
      if (storedAIInsights && storedAIInsights !== 'undefined' && storedAIInsights !== 'null') {
        try {
          aiInsights = JSON.parse(storedAIInsights)
          console.log('AI business insights loaded:', aiInsights)
        } catch (error) {
          console.error('Failed to parse AI insights:', error)
          // Clear the invalid data
          localStorage.removeItem('aiBusinessInsights')
        }
      }
      
      // Parse transactions with validation
      if (storedTransactions) {
        try {
          const parsedTransactions = JSON.parse(storedTransactions)
          if (Array.isArray(parsedTransactions)) {
            transactions = parsedTransactions.filter(validateTransaction)
            console.log(`MetricsGrid: Loaded ${transactions.length} valid transactions from ${parsedTransactions.length} total`)
            
            // Show sample transaction for debugging
            if (transactions.length > 0) {
              console.log('Sample transaction:', transactions[0])
            }
          } else {
            console.warn('MetricsGrid: Transactions data is not an array')
          }
        } catch (error) {
          console.error('MetricsGrid: Error parsing transactions:', error)
        }
      }
      
      // Parse CRM deals with validation
      if (storedCRM) {
        try {
          const parsedCRM = JSON.parse(storedCRM)
          if (Array.isArray(parsedCRM)) {
            crmDeals = parsedCRM.filter(validateDeal)
            console.log(`MetricsGrid: Loaded ${crmDeals.length} valid deals from ${parsedCRM.length} total`)
          } else {
            console.warn('MetricsGrid: CRM data is not an array')
          }
        } catch (error) {
          console.error('MetricsGrid: Error parsing CRM data:', error)
        }
      }
      
      // Parse budget with validation
      if (storedBudget) {
        try {
          budget = JSON.parse(storedBudget)
          console.log('MetricsGrid: Loaded budget data')
        } catch (error) {
          console.error('MetricsGrid: Error parsing budget data:', error)
        }
      }
      
      if (transactions.length === 0) {
        console.log('MetricsGrid: No valid transactions found, using default metrics')
        setMetrics({
          mrr: 0, arr: 0, cashBalance: 0, burnRate: 0, burnRateLTM: 0, burnVariance: 0,
          ltmRevenue: 0, contractedRevenue: 0, grossMargin: 0, netMargin: 0,
          customerCount: 0, cac: null, ltv: null, churn: null, nps: null, runway: 0, quickRatio: null
        })
        return
      }
      
      // Enhanced revenue classification using AI insights
      const isRecurringRevenue = (transaction: any): boolean => {
        // Use AI insights if available
        if (aiInsights?.recurringRevenue?.length > 0) {
          return aiInsights.recurringRevenue.some((col: string) => 
            transaction.categoryColumn === col || 
            transaction.category?.toLowerCase().includes(col.toLowerCase())
          )
        }
        
        // Fallback to original logic
        const category = safeToLowerCase(transaction.category)
        const recurringCategories = ['subscription', 'monthly', 'recurring', 'mrr', 'wiederk']
        return recurringCategories.some(cat => category.includes(cat))
      }

      const isRevenue = (transaction: any): boolean => {
        // Use AI insights if available
        if (aiInsights?.revenueColumns?.length > 0) {
          const isRevenueByAI = aiInsights.revenueColumns.some((col: string) => 
            transaction.categoryColumn === col || 
            (transaction.categoryType === 'revenue')
          )
          if (isRevenueByAI) return true
        }
        
        // Check if amount is positive (common revenue pattern)
        if (transaction.amount > 0) {
          const category = safeToLowerCase(transaction.category)
          const revenueCategories = ['subscription', 'consulting', 'service', 'sales', 'revenue', 'wiederk', 'eingehende']
          return revenueCategories.some(cat => category.includes(cat))
        }
        
        return false
      }

      const isCOGS = (transaction: any): boolean => {
        const category = safeToLowerCase(transaction.category)
        return category.includes('cogs')
      }
      
      // Use current date for calculations
      const now = new Date()
      
      // Calculate for most recent month with data
      const latestTransaction = transactions
        .map(t => {
          try {
            return new Date(t.date)
          } catch {
            return new Date()
          }
        })
        .sort((a, b) => b.getTime() - a.getTime())[0]
      
      const targetMonth = latestTransaction || now
      const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1)
      const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0)
      
      console.log(`MetricsGrid: Calculating metrics for: ${targetMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`)
      
      // Filter transactions for the target month with safe date parsing
      const currentMonthTransactions = transactions.filter(t => {
        try {
          const date = new Date(t.date)
          return date >= monthStart && date <= monthEnd && !isNaN(date.getTime())
        } catch {
          return false
        }
      })
      
      console.log(`MetricsGrid: Found ${currentMonthTransactions.length} transactions for the month`)
      
      // Calculate MRR using AI-enhanced logic
      const recurringRevenue = currentMonthTransactions
        .filter(t => safeParseFloat(t.amount) > 0 && isRecurringRevenue(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
      
      const totalMonthlyRevenue = currentMonthTransactions
        .filter(t => safeParseFloat(t.amount) > 0 && isRevenue(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
      
      // Use recurring revenue if available, otherwise fall back to total revenue
      const mrr = recurringRevenue > 0 ? recurringRevenue : totalMonthlyRevenue
      
      // Calculate total cash balance
      const totalCash = transactions.reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
      
      // Calculate monthly expenses (excluding COGS)
      const monthlyExpenses = Math.abs(currentMonthTransactions
        .filter(t => safeParseFloat(t.amount) < 0 && !isCOGS(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0))
      
      // Calculate COGS separately
      const cogs = Math.abs(currentMonthTransactions
        .filter(t => safeParseFloat(t.amount) < 0 && isCOGS(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0))
      
      // Calculate net burn (expenses minus revenue)
      const netBurn = monthlyExpenses - totalMonthlyRevenue
      
      // Calculate LTM metrics with consistent date range
      const yearAgo = new Date(targetMonth)
      yearAgo.setFullYear(yearAgo.getFullYear() - 1)
      
      const ltmTransactions = transactions.filter(t => {
        try {
          const date = new Date(t.date)
          return date > yearAgo && date <= targetMonth && !isNaN(date.getTime())
        } catch {
          return false
        }
      })
      
      // Calculate LTM total revenue (all revenue types)
      const ltmTotalRevenue = ltmTransactions
        .filter(t => safeParseFloat(t.amount) > 0 && isRevenue(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
      
      const ltmMonthlyRevenue = ltmTotalRevenue / 12
      
      // Calculate LTM expenses and burn rate
      const ltmTotalExpenses = Math.abs(ltmTransactions
        .filter(t => safeParseFloat(t.amount) < 0 && !isCOGS(t))
        .reduce((sum, t) => sum + safeParseFloat(t.amount), 0))
      
      const ltmMonthlyExpenses = ltmTotalExpenses / 12
      const ltmNetBurn = ltmMonthlyExpenses - ltmMonthlyRevenue
      
      // Calculate burn variance (current vs LTM)
      const burnVariance = netBurn - ltmNetBurn
      const burnVariancePercent = ltmNetBurn > 0 ? (burnVariance / ltmNetBurn) * 100 : 0
      
      // Calculate contracted revenue from CRM
      const contractedRevenue = crmDeals
        .filter(d => ['Negotiation', 'Deal', 'Closed', 'Contract'].includes(safeToString(d.phase)))
        .reduce((sum, d) => sum + safeParseFloat(d.amount), 0)
      
      // Calculate gross margin
      const grossMargin = totalMonthlyRevenue > 0 ? 
        ((totalMonthlyRevenue - cogs) / totalMonthlyRevenue * 100) : 0
      
      // Calculate net margin
      const netMargin = totalMonthlyRevenue > 0 ? 
        ((totalMonthlyRevenue - monthlyExpenses - cogs) / totalMonthlyRevenue * 100) : 0
      
      // Calculate unique customers with safe string handling
      const customerCount = crmDeals.length > 0 
        ? new Set(crmDeals.map(d => safeToLowerCase(d.clientName).trim()).filter(name => name !== '')).size
        : new Set(
            transactions
              .filter(t => safeParseFloat(t.amount) > 0 && isRevenue(t))
              .map(t => safeToLowerCase(t.name || t.description || '').trim())
              .filter(name => name !== '')
          ).size
      
      // Calculate runway
      const monthlyBurnRate = Math.max(0, netBurn) // Ensure positive burn rate
      const runway = monthlyBurnRate > 0 && totalCash > 0 ? 
        Math.round(totalCash / monthlyBurnRate) : 999
      
      console.log('MetricsGrid: Calculated metrics with AI insights:', {
        mrr, totalMonthlyRevenue, monthlyExpenses, netBurn, ltmMonthlyRevenue, ltmNetBurn,
        totalCash, contractedRevenue, customerCount, aiInsightsUsed: !!aiInsights
      })
      
      setMetrics({
        mrr: Math.round(mrr),
        arr: Math.round(mrr * 12),
        cashBalance: Math.round(totalCash),
        burnRate: Math.round(Math.max(0, netBurn)),
        burnRateLTM: Math.round(Math.max(0, ltmNetBurn)),
        burnVariance: Math.round(burnVariancePercent),
        ltmRevenue: Math.round(ltmMonthlyRevenue),
        contractedRevenue: Math.round(contractedRevenue),
        grossMargin: Math.round(grossMargin),
        netMargin: Math.round(netMargin),
        customerCount: customerCount,
        cac: null, ltv: null, churn: null, nps: null,
        runway: runway, quickRatio: null
      })
      
    } catch (error) {
      console.error('MetricsGrid: Error calculating metrics:', error)
      // Set safe default values on any error
      setMetrics({
        mrr: 0, arr: 0, cashBalance: 0, burnRate: 0, burnRateLTM: 0, burnVariance: 0,
        ltmRevenue: 0, contractedRevenue: 0, grossMargin: 0, netMargin: 0, customerCount: 0,
        cac: null, ltv: null, churn: null, nps: null, runway: 0, quickRatio: null
      })
    }
  }, [])

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'N/A'
    const absValue = Math.abs(value)
    const currencySymbol = prefs.currency === 'EUR' ? '€' : prefs.currency === 'USD' ? '$' : prefs.currency === 'GBP' ? '£' : 'CHF'
    
    if (absValue >= 1000000) {
      return `${currencySymbol}${(value / 1000000).toFixed(1)}M`
    } else if (absValue >= 1000) {
      return `${currencySymbol}${(value / 1000).toFixed(1)}k`
    }
    return formatCurrencyUtil(value, prefs.currency)
  }

  const formatMetricValue = (metric: any) => {
    if (metric.format === 'currency') {
      return formatCurrency(metric.value)
    } else if (metric.format === 'percentage') {
      return metric.value !== null ? formatPercentage(metric.value / 100) : 'N/A'
    } else if (metric.format === 'number') {
      return metric.value !== null ? formatNumber(metric.value, prefs.number_format) : 'N/A'
    } else if (metric.format === 'months') {
      return metric.value !== null ? 
        (metric.value > 100 ? '∞' : `${metric.value} months`) : 'N/A'
    }
    return metric.value?.toString() || 'N/A'
  }

  const allMetricCards = [
    {
      id: 'mrr',
      title: 'MRR',
      value: metrics.mrr,
      format: 'currency',
      description: 'Monthly Recurring Revenue',
      icon: DollarSign,
      color: 'text-green-600'
    },
    {
      id: 'arr',
      title: 'ARR',
      value: metrics.arr,
      format: 'currency',
      description: 'Annual Recurring Revenue',
      icon: TrendingUp,
      color: 'text-blue-600'
    },
    {
      id: 'cashBalance',
      title: 'Cash Balance',
      value: metrics.cashBalance,
      format: 'currency',
      description: 'Total cash on hand',
      icon: CreditCard,
      color: metrics.cashBalance >= 0 ? 'text-green-600' : 'text-red-600'
    },
    {
      id: 'burnRate',
      title: 'Net Burn',
      value: metrics.burnRate,
      format: 'currency',
      suffix: '/mo',
      description: 'Monthly net cash burn',
      icon: Activity,
      color: metrics.burnRate > 0 ? 'text-red-600' : 'text-green-600'
    },
    {
      id: 'contracted',
      title: 'Contracted',
      value: metrics.contractedRevenue,
      format: 'currency',
      description: 'Pipeline in negotiation/closed',
      icon: Target,
      color: 'text-purple-600'
    },
    {
      id: 'burnVariance',
      title: 'Burn vs LTM',
      value: metrics.burnVariance,
      format: 'percentage',
      description: 'Current burn vs LTM average',
      icon: TrendingUp,
      color: metrics.burnVariance < -5 ? 'text-green-600' : metrics.burnVariance > 5 ? 'text-red-600' : 'text-yellow-600'
    },
    {
      id: 'burnRateLTM',
      title: 'LTM Avg Burn',
      value: metrics.burnRateLTM,
      format: 'currency',
      suffix: '/mo',
      description: 'Last 12 months avg monthly burn',
      icon: Activity,
      color: metrics.burnRateLTM > 0 ? 'text-orange-600' : 'text-green-600'
    },
    {
      id: 'ltmRevenue',
      title: 'LTM Avg Revenue',
      value: metrics.ltmRevenue,
      format: 'currency',
      description: 'Last 12 months avg monthly revenue',
      icon: Wallet,
      color: 'text-indigo-600'
    },
    {
      id: 'grossMargin',
      title: 'Gross Margin',
      value: metrics.grossMargin,
      format: 'percentage',
      description: 'Revenue after COGS',
      icon: Percent,
      color: metrics.grossMargin > 70 ? 'text-green-600' : metrics.grossMargin > 50 ? 'text-yellow-600' : 'text-red-600'
    },
    {
      id: 'netMargin',
      title: 'Net Margin',
      value: metrics.netMargin,
      format: 'percentage',
      description: 'Income as % of sales',
      icon: Percent,
      color: metrics.netMargin > 20 ? 'text-green-600' : metrics.netMargin > 0 ? 'text-yellow-600' : 'text-red-600'
    },    
    {
      id: 'customers',
      title: 'Customers',
      value: metrics.customerCount,
      format: 'number',
      description: 'Active customer count',
      icon: Users,
      color: 'text-blue-600'
    },
    {
      id: 'cac',
      title: 'CAC',
      value: metrics.cac,
      format: 'currency',
      description: 'Customer Acquisition Cost',
      icon: Target,
      color: 'text-orange-600'
    },
    {
      id: 'ltv',
      title: 'LTV',
      value: metrics.ltv,
      format: 'currency',
      description: 'Customer Lifetime Value',
      icon: Users,
      color: 'text-cyan-600'
    },
    {
      id: 'churn',
      title: 'Churn Rate',
      value: metrics.churn,
      format: 'percentage',
      description: 'Monthly customer churn %',
      icon: TrendingUp,
      color: metrics.churn !== null && metrics.churn > 5 ? 'text-red-600' : 'text-green-600'
    },
    {
      id: 'nps',
      title: 'NPS',
      value: metrics.nps,
      format: 'number',
      description: 'Net Promoter Score',
      icon: Users,
      color: metrics.nps !== null && metrics.nps > 50 ? 'text-green-600' : metrics.nps !== null && metrics.nps > 0 ? 'text-yellow-600' : 'text-red-600'
    },
    {
      id: 'runway',
      title: 'Runway',
      value: metrics.runway,
      format: 'months',
      description: 'Months of cash runway',
      icon: Calendar,
      color: metrics.runway > 12 ? 'text-green-600' : metrics.runway > 6 ? 'text-yellow-600' : 'text-red-600'
    },
    {
      id: 'quickRatio',
      title: 'Quick Ratio',
      value: metrics.quickRatio,
      format: 'number',
      description: 'Growth efficiency metric',
      icon: Zap,
      color: metrics.quickRatio !== null && metrics.quickRatio > 1 ? 'text-green-600' : 'text-red-600'
    }
  ]

  // Filter metrics based on selection
  const metricCards = allMetricCards.filter(metric => selectedMetrics.includes(metric.id))

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metricCards.map((metric) => {
        const Icon = metric.icon
        return (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <Icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${metric.color}`}>
                {formatMetricValue(metric)}{metric.suffix || ''}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}