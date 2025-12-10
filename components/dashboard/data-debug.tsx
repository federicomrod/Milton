// components/dashboard/data-debug.tsx
'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Database, FileText, TrendingUp, AlertTriangle } from 'lucide-react'

export function DataDebugComponent() {
  const [storageData, setStorageData] = useState<any>({})
  const [analysis, setAnalysis] = useState<any>({})

  const refreshData = () => {
    // Check if localStorage is available
    if (typeof window === 'undefined') {
      console.warn('localStorage not available during server-side rendering')
      return
    }
    
    const data = {
      transactions: localStorage.getItem('transactions'),
      crmDeals: localStorage.getItem('crmDeals'),
      budget: localStorage.getItem('budget'),
      aiBusinessInsights: localStorage.getItem('aiBusinessInsights'),
      useCaseConfirmed: localStorage.getItem('useCaseConfirmed'),
      selectedUseCase: localStorage.getItem('selectedUseCase')
    }

    const parsed = {
      transactions: data.transactions ? JSON.parse(data.transactions) : null,
      crmDeals: data.crmDeals ? JSON.parse(data.crmDeals) : null,
      budget: data.budget ? JSON.parse(data.budget) : null,
      aiBusinessInsights: data.aiBusinessInsights ? JSON.parse(data.aiBusinessInsights) : null,
      useCaseConfirmed: data.useCaseConfirmed === 'true',
      selectedUseCase: data.selectedUseCase
    }

    setStorageData(parsed)
    analyzeData(parsed)
  }

  const analyzeData = (data: any) => {
    const analysis: any = {
      transactions: {},
      crm: {},
      budget: {},
      issues: []
    }

    // Analyze transactions
    if (data.transactions && Array.isArray(data.transactions)) {
      const txs = data.transactions
      analysis.transactions = {
        count: txs.length,
        totalAmount: txs.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0),
        positiveAmount: txs.filter((tx: any) => tx.amount > 0).length,
        negativeAmount: txs.filter((tx: any) => tx.amount < 0).length,
        categories: [...new Set(txs.map((tx: any) => tx.category))],
        dateRange: {
          earliest: txs.map((tx: any) => tx.date).sort()[0],
          latest: txs.map((tx: any) => tx.date).sort().reverse()[0]
        },
        sampleTransaction: txs[0],
        recurringRevenue: txs.filter((tx: any) => 
          tx.amount > 0 && 
          (tx.category?.toLowerCase().includes('subscription') || 
           tx.category?.toLowerCase().includes('recurring') ||
           tx.category?.toLowerCase().includes('wiederk'))
        ).length,
        amountDistribution: {
          min: Math.min(...txs.map((tx: any) => tx.amount)),
          max: Math.max(...txs.map((tx: any) => tx.amount)),
          avg: txs.reduce((sum: number, tx: any) => sum + tx.amount, 0) / txs.length
        }
      }

      // Check for issues
      if (analysis.transactions.recurringRevenue === 0) {
        analysis.issues.push('No recurring revenue transactions detected - MRR will be €0')
      }
      if (analysis.transactions.positiveAmount === 0) {
        analysis.issues.push('No positive transactions found - no revenue detected')
      }
    } else {
      analysis.issues.push('No transaction data found')
    }

    // Analyze CRM
    if (data.crmDeals && Array.isArray(data.crmDeals)) {
      const deals = data.crmDeals
      analysis.crm = {
        count: deals.length,
        totalValue: deals.reduce((sum: number, deal: any) => sum + (deal.amount || 0), 0),
        phases: [...new Set(deals.map((deal: any) => deal.phase))],
        clients: [...new Set(deals.map((deal: any) => deal.clientName))],
        sampleDeal: deals[0]
      }
    } else {
      analysis.issues.push('No CRM data found')
    }

    // Analyze budget
    if (data.budget && typeof data.budget === 'object') {
      analysis.budget = {
        categories: Object.keys(data.budget).filter(k => k !== 'months'),
        months: data.budget.months || [],
        sampleBudget: data.budget
      }
    } else {
      analysis.issues.push('No budget data found')
    }

    setAnalysis(analysis)
  }

  useEffect(() => {
    refreshData()
  }, [])

  const clearAllData = () => {
    localStorage.clear()
    refreshData()
  }

  return (
    <div className="space-y-6">
      <Card className="border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Storage Debug
          </CardTitle>
          <CardDescription>
            Debug what's actually stored in localStorage and identify processing issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button onClick={refreshData} size="sm">
              Refresh Data
            </Button>
            <Button onClick={clearAllData} variant="destructive" size="sm">
              Clear All Data
            </Button>
          </div>

          {analysis.issues && analysis.issues.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <h4 className="font-medium text-red-800">Issues Detected:</h4>
              </div>
              <ul className="text-sm text-red-700 space-y-1">
                {analysis.issues.map((issue: string, idx: number) => (
                  <li key={idx}>• {issue}</li>
                ))}
              </ul>
            </div>
          )}

          <Tabs defaultValue="summary">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="crm">CRM Data</TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
              <TabsTrigger value="raw">Raw Data</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Transactions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analysis.transactions?.count || 0}
                    </div>
                    <div className="text-xs text-gray-600">
                      Total: €{(analysis.transactions?.totalAmount || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600">
                      Recurring: {analysis.transactions?.recurringRevenue || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      CRM Deals
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analysis.crm?.count || 0}
                    </div>
                    <div className="text-xs text-gray-600">
                      Value: €{(analysis.crm?.totalValue || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600">
                      Clients: {analysis.crm?.clients?.length || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Budget
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analysis.budget?.categories?.length || 0}
                    </div>
                    <div className="text-xs text-gray-600">
                      Categories
                    </div>
                    <div className="text-xs text-gray-600">
                      Months: {analysis.budget?.months?.length || 0}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="transactions">
              <div className="space-y-4">
                {analysis.transactions ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <strong>Count:</strong> {analysis.transactions.count}
                      </div>
                      <div>
                        <strong>Total Amount:</strong> €{analysis.transactions.totalAmount?.toLocaleString()}
                      </div>
                      <div>
                        <strong>Positive/Negative:</strong> {analysis.transactions.positiveAmount}/{analysis.transactions.negativeAmount}
                      </div>
                      <div>
                        <strong>Recurring Revenue Txs:</strong> {analysis.transactions.recurringRevenue}
                      </div>
                      <div>
                        <strong>Date Range:</strong> {analysis.transactions.dateRange?.earliest} to {analysis.transactions.dateRange?.latest}
                      </div>
                      <div>
                        <strong>Avg Amount:</strong> €{analysis.transactions.amountDistribution?.avg?.toFixed(2)}
                      </div>
                    </div>
                    
                    <div>
                      <strong>Categories:</strong>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {analysis.transactions.categories?.map((cat: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">{cat}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <strong>Sample Transaction:</strong>
                      <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-auto">
                        {JSON.stringify(analysis.transactions.sampleTransaction, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500">No transaction analysis available</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="crm">
              <div className="space-y-4">
                {analysis.crm ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <strong>Deal Count:</strong> {analysis.crm.count}
                      </div>
                      <div>
                        <strong>Total Value:</strong> €{analysis.crm.totalValue?.toLocaleString()}
                      </div>
                      <div>
                        <strong>Unique Clients:</strong> {analysis.crm.clients?.length}
                      </div>
                    </div>
                    
                    <div>
                      <strong>Deal Phases:</strong>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {analysis.crm.phases?.map((phase: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">{phase}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <strong>Sample Deal:</strong>
                      <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-auto">
                        {JSON.stringify(analysis.crm.sampleDeal, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500">No CRM analysis available</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="budget">
              <div className="space-y-4">
                {analysis.budget ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <strong>Categories:</strong> {analysis.budget.categories?.length}
                      </div>
                      <div>
                        <strong>Months:</strong> {analysis.budget.months?.length}
                      </div>
                    </div>
                    
                    <div>
                      <strong>Budget Categories:</strong>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {analysis.budget.categories?.map((cat: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">{cat}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <strong>Sample Budget Data:</strong>
                      <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-auto max-h-40">
                        {JSON.stringify(analysis.budget.sampleBudget, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500">No budget analysis available</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="raw">
              <div className="space-y-4">
                <div>
                  <strong>Raw Storage Contents:</strong>
                  <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-auto max-h-60">
                    {JSON.stringify(storageData, null, 2)}
                  </pre>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}