'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, TrendingDown, DollarSign, Calendar } from 'lucide-react'
import { useUserPreferences } from '@/lib/context/UserPreferencesContext'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'

interface Transaction {
  id: string
  date: string
  name: string
  amount: number
  reference: string
  category: string
}

export function CashFlowAnalysis() {
  const { prefs } = useUserPreferences()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [metrics, setMetrics] = useState<any>({
    currentBalance: 0,
    monthlyFlow: [],
    categoryBreakdown: [],
    runwayMonths: 0,
    burnRate: 0
  })

  useEffect(() => {
    const loadTransactionData = () => {
      const transactionData = localStorage.getItem('transactions')
      if (!transactionData) return

      const txData: Transaction[] = JSON.parse(transactionData)
      setTransactions(txData)
      calculateCashFlowMetrics(txData)
    }

    loadTransactionData()
  }, [prefs])

  const calculateCashFlowMetrics = (txData: Transaction[]) => {
    // Sort transactions by date
    const sortedTx = [...txData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    
    // Calculate running balance
    let runningBalance = 0
    const monthlyData: any = {}
    
    sortedTx.forEach(tx => {
      runningBalance += tx.amount
      const date = new Date(tx.date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
          inflow: 0,
          outflow: 0,
          netFlow: 0,
          balance: 0,
          transactions: []
        }
      }
      
      if (tx.amount > 0) {
        monthlyData[monthKey].inflow += tx.amount
      } else {
        monthlyData[monthKey].outflow += Math.abs(tx.amount)
      }
      monthlyData[monthKey].netFlow = monthlyData[monthKey].inflow - monthlyData[monthKey].outflow
      monthlyData[monthKey].balance = runningBalance
      monthlyData[monthKey].transactions.push(tx)
    })

    // Convert to array and sort
    const monthlyFlow = Object.values(monthlyData).sort((a: any, b: any) => {
      const dateA = new Date(a.month)
      const dateB = new Date(b.month)
      return dateA.getTime() - dateB.getTime()
    })

    // Category breakdown
    const categoryTotals: { [key: string]: { inflow: number, outflow: number } } = {}
    txData.forEach(tx => {
      if (!categoryTotals[tx.category]) {
        categoryTotals[tx.category] = { inflow: 0, outflow: 0 }
      }
      if (tx.amount > 0) {
        categoryTotals[tx.category].inflow += tx.amount
      } else {
        categoryTotals[tx.category].outflow += Math.abs(tx.amount)
      }
    })

    const categoryBreakdown = Object.entries(categoryTotals)
      .map(([category, values]) => ({
        category,
        inflow: values.inflow,
        outflow: values.outflow,
        net: values.inflow - values.outflow
      }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    // Calculate burn rate (last 3 months average)
    const last3Months = monthlyFlow.slice(-3)
    const avgBurnRate = last3Months.length > 0
      ? last3Months.reduce((sum: number, m: any) => sum + (m.outflow - m.inflow), 0) / last3Months.length
      : 0

    // Calculate runway
    const currentBalance = runningBalance
    const runwayMonths = avgBurnRate > 0 ? Math.round(currentBalance / avgBurnRate) : 999

    setMetrics({
      currentBalance,
      monthlyFlow,
      categoryBreakdown,
      runwayMonths,
      burnRate: avgBurnRate
    })
  }

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash Flow Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">No transaction data available. Please upload your bank transactions.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-chart="cash-flow">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center">
              <DollarSign className="h-4 w-4 mr-1" />
              Current Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metrics.currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(metrics.currentBalance, prefs.currency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center">
              <TrendingDown className="h-4 w-4 mr-1" />
              3-Month Avg Burn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(Math.round(metrics.burnRate), prefs.currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Last 3 months average</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center">
              <Calendar className="h-4 w-4 mr-1" />
              Runway
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metrics.runwayMonths > 12 ? 'text-green-600' : metrics.runwayMonths > 6 ? 'text-yellow-600' : 'text-red-600'}`}>
              {metrics.runwayMonths > 100 ? '∞' : `${metrics.runwayMonths} months`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center">
              <TrendingUp className="h-4 w-4 mr-1" />
              Last Month Net
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metrics.monthlyFlow.length > 0 && metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {metrics.monthlyFlow.length > 0 ? formatCurrency(Math.round(metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow), prefs.currency) : formatCurrency(0, prefs.currency)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cash Balance Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Cash Balance Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={metrics.monthlyFlow}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly Cash Flow */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Cash Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metrics.monthlyFlow}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Legend />
              <Bar dataKey="inflow" fill="#10b981" name="Inflow" />
              <Bar dataKey="outflow" fill="#ef4444" name="Outflow" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={metrics.categoryBreakdown.filter((c: any) => c.outflow > 0)}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ category, outflow }: any) => {
                    const currencySymbol = prefs.currency === 'EUR' ? '€' : prefs.currency === 'USD' ? '$' : prefs.currency === 'GBP' ? '£' : 'CHF'
                    return `${category}: ${currencySymbol}${(outflow/1000).toFixed(0)}k`
                  }}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="outflow"
                >
                  {metrics.categoryBreakdown.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category Net Impact */}
        <Card>
          <CardHeader>
            <CardTitle>Net Impact by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.categoryBreakdown.slice(0, 10).map((cat: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{cat.category}</p>
                    <div className="flex space-x-4 text-xs text-gray-500">
                      <span>In: {formatCurrency(cat.inflow, prefs.currency)}</span>
                      <span>Out: {formatCurrency(cat.outflow, prefs.currency)}</span>
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${cat.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(cat.net, prefs.currency)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cash Flow Waterfall */}
      <Card>
        <CardHeader>
          <CardTitle>Net Cash Flow Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={metrics.monthlyFlow}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: any) => formatCurrency(value, prefs.currency)} />
              <Line 
                type="monotone" 
                dataKey="netFlow" 
                stroke="#6366f1" 
                strokeWidth={2}
                dot={{ fill: '#6366f1' }}
              />
              <Line 
                y={0} 
                stroke="#000" 
                strokeWidth={1} 
                strokeDasharray="3 3"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}