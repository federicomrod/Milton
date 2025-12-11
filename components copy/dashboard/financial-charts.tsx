'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts'
import { WaterfallChart } from '@/components/dashboard/waterfall-chart'
import { useUserPreferences } from '@/lib/context/UserPreferencesContext'
import { formatCurrency, formatNumber } from '@/lib/utils/formatters'

interface ChartProps {
  type: 'mrr-vs-plan' | 'burn-rate' | 'income-statement' | 'variance-analysis' | 'ytd-performance'
}

export function FinancialCharts({ type }: ChartProps) {
  const { prefs } = useUserPreferences()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Helper function to get data attribute for chart identification
  const getChartDataAttribute = (type: string) => {
    switch (type) {
      case 'mrr-vs-plan': return 'mrr-vs-plan'
      case 'burn-rate': return 'burn-rate'
      case 'income-statement': return 'income-statement'
      case 'variance-analysis': return 'variance-analysis'
      case 'ytd-performance': return 'ytd-performance'
      default: return type
    }
  }

  useEffect(() => {
    const loadData = () => {
      const transactions = localStorage.getItem('transactions')
      const budget = localStorage.getItem('budget')
      
      if (!transactions) {
        setLoading(false)
        return
      }

      const transactionData = JSON.parse(transactions)
      const budgetData = budget ? JSON.parse(budget) : null
      
      // Get current month
      const now = new Date()
      const currentMonth = now.toLocaleString('default', { month: 'short', year: 'numeric' })
      
      switch (type) {
        case 'mrr-vs-plan':
          generateMRRChart(transactionData, budgetData, currentMonth)
          break
        case 'burn-rate':
          generateBurnRateChart(transactionData, budgetData)
          break
        case 'income-statement':
          generateIncomeStatement(transactionData, budgetData)
          break
        case 'variance-analysis':
          generateVarianceAnalysis(transactionData, budgetData)
          break
        case 'ytd-performance':
          generateYTDPerformance(transactionData, budgetData)
          break
      }
      
      setLoading(false)
    }

    loadData()
  }, [type, prefs])

  const generateMRRChart = (transactions: any[], budget: any, currentMonth: string) => {
    // Helper functions (same as MetricsGrid)
    const isRevenue = (category: string): boolean => {
      const revenueCategories = ['subscription', 'consulting', 'one-time service', 'service', 'sales', 'revenue']
      return revenueCategories.some(cat => 
        category.toLowerCase().includes(cat)
      )
    }

    const isRecurringRevenue = (category: string): boolean => {
      const recurringCategories = ['subscription', 'monthly', 'recurring', 'mrr']
      return recurringCategories.some(cat => 
        category.toLowerCase().includes(cat)
      )
    }

    // Get latest month with data (same logic as MetricsGrid)
    const latestTransaction = transactions
      .map((t: any) => new Date(t.date))
      .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0]
    
    const targetMonth = latestTransaction || new Date()
    const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1)
    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0)

    // Calculate actual MRR from current month transactions (same logic as MetricsGrid)
    const currentMonthTransactions = transactions.filter((t: any) => {
      const date = new Date(t.date)
      return date >= monthStart && date <= monthEnd
    })

    const recurringRevenue = currentMonthTransactions
      .filter((t: any) => t.amount > 0 && isRecurringRevenue(t.category))
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    
    const totalMonthlyRevenue = currentMonthTransactions
      .filter((t: any) => t.amount > 0 && isRevenue(t.category))
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    
    const actualMRR = recurringRevenue > 0 ? recurringRevenue : totalMonthlyRevenue

    // Get planned MRR from budget for the current month being analyzed
    const budgetMonth = targetMonth.toLocaleString('default', { month: 'short', year: 'numeric' })
    const plannedMRR = budget['MRR']?.[budgetMonth] || 0

    // Calculate LTM average (same logic as MetricsGrid)
    const yearAgo = new Date(targetMonth)
    yearAgo.setFullYear(yearAgo.getFullYear() - 1)
    
    const ltmTransactions = transactions.filter((t: any) => 
      new Date(t.date) > yearAgo && new Date(t.date) <= targetMonth
    )
    
    const ltmTotalRevenue = ltmTransactions
      .filter((t: any) => t.amount > 0 && isRevenue(t.category))
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    
    const ltmAverage = ltmTotalRevenue / 12

    setData([
      {
        name: 'Plan vs Actual',
        plan: Math.round(plannedMRR),
        actual: Math.round(actualMRR),
        variance: plannedMRR > 0 ? 
          ((actualMRR / plannedMRR - 1) * 100).toFixed(1) + '%' : 'N/A'
      },
      {
        name: 'LTM vs Current',
        ltm: Math.round(ltmAverage),
        current: Math.round(actualMRR),
        variance: ltmAverage > 0 ? 
          ((actualMRR / ltmAverage - 1) * 100).toFixed(1) + '%' : 'N/A'
      }
    ])
  }

  const generateBurnRateChart = (transactions: any[], budget: any) => {
    // Calculate monthly burn rate for last 6 months
    const monthlyData = []
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' })
      
      const monthTransactions = transactions.filter((t: any) => {
        const tDate = new Date(t.date)
        return tDate.getMonth() === date.getMonth() && 
               tDate.getFullYear() === date.getFullYear()
      })
      
      const revenue = monthTransactions
        .filter((t: any) => t.amount > 0)
        .reduce((sum: number, t: any) => sum + t.amount, 0)
      
      const expenses = Math.abs(monthTransactions
        .filter((t: any) => t.amount < 0)
        .reduce((sum: number, t: any) => sum + t.amount, 0))
      
      monthlyData.push({
        month: monthYear,
        revenue: revenue,
        expenses: expenses,
        netBurn: expenses - revenue
      })
    }
    
    setData(monthlyData)
  }

  const generateIncomeStatement = (transactions: any[], budget: any) => {
    // Get current month transactions
    const currentMonth = new Date()
    const monthTransactions = transactions.filter((t: any) => {
      const date = new Date(t.date)
      return date.getMonth() === currentMonth.getMonth() && 
             date.getFullYear() === currentMonth.getFullYear()
    })
    
    // Group by category
    const categories: { [key: string]: number } = {}
    monthTransactions.forEach((t: any) => {
      if (!categories[t.category]) {
        categories[t.category] = 0
      }
      categories[t.category] += t.amount
    })
    
    // Calculate revenue and expenses - use actual categories from data
    const totalRevenue = Object.entries(categories)
      .filter(([cat, amount]) => amount > 0)
      .reduce((sum, [, amount]) => sum + amount, 0)
    
    const totalExpenses = Math.abs(Object.entries(categories)
      .filter(([cat, amount]) => amount < 0)
      .reduce((sum, [, amount]) => sum + amount, 0))
    
    // For waterfall chart, we'll use the actual categories found
    const waterfallData = [
      { name: 'Revenue', value: totalRevenue }
    ]
    
    // Add each expense category as a separate line
    Object.entries(categories).forEach(([category, amount]) => {
      if (amount < 0) {
        waterfallData.push({ name: category, value: amount })
      }
    })
    
    // Add final total
    const netIncome = totalRevenue + totalExpenses
    waterfallData.push({ name: 'Net Income', value: netIncome })
    
    setData(waterfallData)
  }

  const generateVarianceAnalysis = (transactions: any[], budget: any) => {
    const currentMonth = new Date().toLocaleString('default', { month: 'short', year: 'numeric' })
    const variances = []
    
    // Calculate actual values for current month
    const monthTransactions = transactions.filter((t: any) => {
      const date = new Date(t.date)
      return date.getMonth() === new Date().getMonth() && 
             date.getFullYear() === new Date().getFullYear()
    })
    
    const actualRevenue = monthTransactions
      .filter((t: any) => t.amount > 0)
      .reduce((sum: number, t: any) => sum + t.amount, 0)
    
    const actualExpenses = Math.abs(monthTransactions
      .filter((t: any) => t.amount < 0)
      .reduce((sum: number, t: any) => sum + t.amount, 0))
    
    // Compare with budget - try different budget key formats
    const budgetKeys = ['MRR', 'mrr', 'Monthly Revenue', 'Revenue']
    let budgetRevenue = 0
    let budgetKey = null
    
    for (const key of budgetKeys) {
      if (budget[key] && budget[key][currentMonth]) {
        budgetRevenue = budget[key][currentMonth]
        budgetKey = key
        break
      }
    }
    
          if (budgetRevenue > 0) {
        variances.push({
          metric: 'Revenue',
          budget: budgetRevenue,
          actual: actualRevenue,
          variance: actualRevenue - budgetRevenue,
          variancePercent: ((actualRevenue / budgetRevenue - 1) * 100).toFixed(1)
        })
      }
    
    // Try different expense budget keys
    const expenseKeys = ['OPEX Total', 'Total FC', 'Total Costs', 'Expenses', 'Total Expenses']
    let budgetExpenses = 0
    let expenseKey = null
    
    for (const key of expenseKeys) {
      if (budget[key] && budget[key][currentMonth]) {
        budgetExpenses = Math.abs(budget[key][currentMonth])
        expenseKey = key
        break
      }
    }
    
          if (budgetExpenses > 0) {
        variances.push({
          metric: 'Operating Expenses',
          budget: budgetExpenses,
          actual: actualExpenses,
          variance: actualExpenses - budgetExpenses,
          variancePercent: ((actualExpenses / budgetExpenses - 1) * 100).toFixed(1)
        })
      }
      
      setData(variances)
  }

  const generateYTDPerformance = (transactions: any[], budget: any) => {
    const currentYear = new Date().getFullYear()
    const ytdData: Array<{
      month: string
      actual: number
      budget: number
      cumActual: number
      cumBudget: number
    }> = []
    
    // Calculate YTD by month
    for (let month = 0; month <= new Date().getMonth(); month++) {
      const monthDate = new Date(currentYear, month, 1)
      const monthName = monthDate.toLocaleString('default', { month: 'short' })
      
      const monthTransactions = transactions.filter((t: any) => {
        const date = new Date(t.date)
        return date.getMonth() === month && date.getFullYear() === currentYear
      })
      
      const revenue = monthTransactions
        .filter((t: any) => t.amount > 0)
        .reduce((sum: number, t: any) => sum + t.amount, 0)
      
      // Use budget data if available, otherwise use a simple projection
      let plannedRevenue = 0
      const budgetKeys = ['MRR', 'mrr', 'Monthly Revenue', 'Revenue']
      let budgetKey = null
      
      for (const key of budgetKeys) {
        if (budget && budget[key]) {
          const monthKey = `${monthName} ${currentYear}`
          if (budget[key][monthKey]) {
            plannedRevenue = budget[key][monthKey]
            budgetKey = key
            break
          }
        }
      }
      
      if (plannedRevenue === 0) {
        // Simple projection based on average monthly revenue
        const avgMonthlyRevenue = transactions
          .filter((t: any) => t.amount > 0)
          .reduce((sum: number, t: any) => sum + t.amount, 0) / 12
        plannedRevenue = avgMonthlyRevenue
      }
      
      ytdData.push({
        month: monthName,
        actual: revenue,
        budget: plannedRevenue,
        cumActual: ytdData.reduce((sum, d) => sum + d.actual, 0) + revenue,
        cumBudget: ytdData.reduce((sum, d) => sum + d.budget, 0) + plannedRevenue
      })
    }
    
    setData(ytdData)
  }

  const renderChart = () => {
    if (loading || data.length === 0) {
      return (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">No data available. Please upload files first.</p>
        </div>
      )
    }

    switch (type) {
      case 'mrr-vs-plan':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Legend />
              <Bar dataKey="plan" fill="#94a3b8" name="Plan" />
              <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
              <Bar dataKey="ltm" fill="#94a3b8" name="LTM Average" />
              <Bar dataKey="current" fill="#3b82f6" name="Current Month" />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'burn-rate':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Legend />
              <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
              <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
              <Bar dataKey="netBurn" fill="#6366f1" name="Net Burn" />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'income-statement':
        return <WaterfallChart data={data} height={300} />

      case 'variance-analysis':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="metric" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Legend />
              <Bar dataKey="budget" fill="#94a3b8" name="Budget" />
              <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'ytd-performance':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Legend />
              <Line type="monotone" dataKey="cumActual" stroke="#3b82f6" name="YTD Actual" strokeWidth={2} />
              <Line type="monotone" dataKey="cumBudget" stroke="#94a3b8" name="YTD Budget" strokeWidth={2} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        )

      default:
        return null
    }
  }

  const getChartTitle = () => {
    switch (type) {
      case 'mrr-vs-plan':
        return 'MRR: Plan vs Actual & LTM Comparison'
      case 'burn-rate':
        return 'Monthly Burn Rate Trend'
      case 'income-statement':
        return 'Income Statement Overview'
      case 'variance-analysis':
        return 'Budget Variance Analysis'
      case 'ytd-performance':
        return 'Year-to-Date Performance'
      default:
        return 'Financial Chart'
    }
  }

  return (
    <Card data-chart={getChartDataAttribute(type)}>
      <CardHeader>
        <CardTitle>{getChartTitle()}</CardTitle>
      </CardHeader>
      <CardContent>
        {renderChart()}
      </CardContent>
    </Card>
  )
}