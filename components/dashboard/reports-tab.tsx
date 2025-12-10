// components/dashboard/reports-tab.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileDown, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { createClient } from '@/lib/supabase/client'
import { generateReportSlides } from '@/lib/pdf-generator-slides'
import { getReportData } from '@/lib/report-data-service'
import { generateInsights } from '@/lib/ai/insights'
import { generateChartImages } from '@/lib/chart-generator'
import { useUserPreferences } from '@/lib/context/UserPreferencesContext'

interface ReportConfig {
  title: string
  companyName: string
  reportPeriod: string
  includeOverview: boolean
  includeFinancial: boolean
  includeSales: boolean
  includeCashFlow: boolean
  // Enhanced card selections
  overviewCards: {
    metricsGrid: boolean
    performanceCharts: boolean
  }
  financialCards: {
    revenueBreakdown: boolean
    expenseAnalysis: boolean
    varianceReport: boolean
  }
  salesCards: {
    pipelineMetrics: boolean
    pipelineByStage: boolean
    pipelineByClosingDate: boolean
    dealSources: boolean
  }
  cashFlowCards: {
    currentBalance: boolean
    monthlyBurnRate: boolean
    cashRunway: boolean
    monthlyTrend: boolean
    inflowOutflowBreakdown: boolean
  }
}

export function ReportsTab() {
  const { prefs } = useUserPreferences()
  const [config, setConfig] = useState<ReportConfig>({
    title: 'Monthly Business Report',
    companyName: 'Your Company',
    reportPeriod: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    includeOverview: true,
    includeFinancial: true,
    includeSales: true,
    includeCashFlow: true,
    // Default all cards enabled
    overviewCards: {
      metricsGrid: true,
      performanceCharts: true
    },
    financialCards: {
      revenueBreakdown: true,
      expenseAnalysis: true,
      varianceReport: false
    },
    salesCards: {
      pipelineMetrics: true,
      pipelineByStage: true,
      pipelineByClosingDate: false,
      dealSources: false
    },
    cashFlowCards: {
      currentBalance: true,
      monthlyBurnRate: true,
      cashRunway: true,
      monthlyTrend: true,
      inflowOutflowBreakdown: false
    }
  })

  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    financial: false,
    sales: false,
    cashflow: false
  })

  // Initialize client-side
  useEffect(() => {
    setIsClient(true)
  }, [])

  const handleConfigChange = (field: keyof ReportConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  const handleCardSelectionChange = (section: 'overviewCards' | 'financialCards' | 'salesCards' | 'cashFlowCards', card: string, value: boolean) => {
    setConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [card]: value
      }
    }))
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const checkDataAvailability = () => {
    // Early return if not on client side
    if (typeof window === 'undefined' || !isClient) {
      return {
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasAnyData: false
      }
    }
    
    try {
      const hasTransactions = !!localStorage.getItem('transactions')
      const hasCRMData = !!localStorage.getItem('crmDeals')
      const hasBudgetData = !!localStorage.getItem('budget')

      return {
        hasTransactions,
        hasCRMData,
        hasBudgetData,
        hasAnyData: hasTransactions || hasCRMData || hasBudgetData
      }
    } catch (error) {
      console.error('Error checking data availability:', error)
      return {
        hasTransactions: false,
        hasCRMData: false,
        hasBudgetData: false,
        hasAnyData: false
      }
    }
  }

  const generatePDF = async () => {
    if (!isClient) {
      setError('PDF generator not available. Please refresh the page.')
      setGenerationStatus('error')
      return
    }

    setIsGenerating(true)
    setGenerationStatus('generating')
    setError(null)

    try {
      // Get Supabase client
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError || !user) {
        throw new Error('No authenticated user found. Please log in.')
      }

      // Convert period label (e.g., "October 2025") into start/end ISO strings
      function parsePeriodLabel(label: string | null | undefined): { start: string; end: string } | null {
        if (!label) return null
        try {
          const [monthName, year] = label.split(' ')
          const start = new Date(`${monthName} 1, ${year}`)
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 0) // last day of month
          return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
          }
        } catch {
          return null
        }
      }

      const periodRange = parsePeriodLabel(config.reportPeriod)
      
      // Fetch report data from Supabase with period filter
      const reportData = await getReportData(
        supabase,
        user.id,
        periodRange || undefined
      )

      // Generate AI insights for each section
      let insights: { overview?: string[]; financial?: string[]; pipeline?: string[]; cashflow?: string[] } = {}
      try {
        const [ov, fin, pipe, cf] = await Promise.all([
          generateInsights(reportData, 'overview'),
          generateInsights(reportData, 'financial'),
          generateInsights(reportData, 'pipeline'),
          generateInsights(reportData, 'cashflow'),
        ])
        insights = { overview: ov, financial: fin, pipeline: pipe, cashflow: cf }
      } catch (insightError) {
        console.warn('AI insights generation failed, proceeding without insights:', insightError)
        // Continue with empty insights if OpenAI fails
      }

      // Generate chart images using QuickChart API
      const chartImages = await generateChartImages(reportData)

      // Generate PDF with live data, AI insights, chart images, and user preferences
      await generateReportSlides(reportData, {
        company: config.companyName || 'Milton Demo',
        periodLabel: config.reportPeriod || 'Current Month',
        currency: prefs.currency,
        dateFormat: prefs.date_format,
        numberFormat: prefs.number_format,
        timezone: prefs.timezone
      }, insights, chartImages)

      setGenerationStatus('success')
      setTimeout(() => setGenerationStatus('idle'), 3000)

    } catch (err) {
      console.error('PDF Generation Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate PDF. Please try again.')
      setGenerationStatus('error')
    } finally {
      setIsGenerating(false)
    }
  }

  const dataStatus = checkDataAvailability()

  // Don't render until client-side
  if (!isClient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Generate PDF Report
          </CardTitle>
          <CardDescription>Loading PDF generator...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Generate PDF Report
          </CardTitle>
          <CardDescription>
            Create a professional PDF report with your current KPIs and analytics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Data Availability Check */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Data Sources:</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${dataStatus.hasTransactions ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    Bank Transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${dataStatus.hasCRMData ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    CRM Data
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${dataStatus.hasBudgetData ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    Budget Data
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Report Configuration */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Report Title</Label>
              <Input
                id="title"
                value={config.title}
                onChange={(e) => handleConfigChange('title', e.target.value)}
                placeholder="Monthly Business Report"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="company">Company Name</Label>
              <Input
                id="company"
                value={config.companyName}
                onChange={(e) => handleConfigChange('companyName', e.target.value)}
                placeholder="Your Company Name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="period">Report Period</Label>
            <Select 
              value={config.reportPeriod} 
              onValueChange={(value) => handleConfigChange('reportPeriod', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => {
                  const date = new Date()
                  date.setMonth(date.getMonth() - i)
                  const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  return (
                    <SelectItem key={monthYear} value={monthYear}>
                      {monthYear}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Section Selection with Card Details */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Include Sections & Select Cards</Label>
            
            {/* Overview Section */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <Checkbox
                  id="overview"
                  checked={config.includeOverview}
                  onCheckedChange={(checked) => handleConfigChange('includeOverview', checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="overview" className="text-sm font-medium cursor-pointer">
                    Overview & Performance
                  </Label>
                  <p className="text-xs text-gray-600">Key metrics and performance summary</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSection('overview')}
                  disabled={!config.includeOverview}
                >
                  {expandedSections.overview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              
              {config.includeOverview && expandedSections.overview && (
                <div className="ml-6 space-y-2 border-l-2 border-green-200 pl-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="metricsGrid"
                      checked={config.overviewCards.metricsGrid}
                      onCheckedChange={(checked) => handleCardSelectionChange('overviewCards', 'metricsGrid', checked as boolean)}
                    />
                    <Label htmlFor="metricsGrid" className="text-xs cursor-pointer">Key Metrics Grid (MRR, ARR, Cash Balance, etc.)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="performanceCharts"
                      checked={config.overviewCards.performanceCharts}
                      onCheckedChange={(checked) => handleCardSelectionChange('overviewCards', 'performanceCharts', checked as boolean)}
                    />
                    <Label htmlFor="performanceCharts" className="text-xs cursor-pointer">Performance Charts & Trends</Label>
                  </div>
                </div>
              )}
            </div>

            {/* Financial Section */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <Checkbox
                  id="financial"
                  checked={config.includeFinancial}
                  onCheckedChange={(checked) => handleConfigChange('includeFinancial', checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="financial" className="text-sm font-medium cursor-pointer">
                    Financial Analysis
                  </Label>
                  <p className="text-xs text-gray-600">Revenue, expenses, and margins</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSection('financial')}
                  disabled={!config.includeFinancial}
                >
                  {expandedSections.financial ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              
              {config.includeFinancial && expandedSections.financial && (
                <div className="ml-6 space-y-2 border-l-2 border-purple-200 pl-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="revenueBreakdown"
                      checked={config.financialCards.revenueBreakdown}
                      onCheckedChange={(checked) => handleCardSelectionChange('financialCards', 'revenueBreakdown', checked as boolean)}
                    />
                    <Label htmlFor="revenueBreakdown" className="text-xs cursor-pointer">Revenue Breakdown by Source</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="expenseAnalysis"
                      checked={config.financialCards.expenseAnalysis}
                      onCheckedChange={(checked) => handleCardSelectionChange('financialCards', 'expenseAnalysis', checked as boolean)}
                    />
                    <Label htmlFor="expenseAnalysis" className="text-xs cursor-pointer">Expense Analysis vs Budget</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="varianceReport"
                      checked={config.financialCards.varianceReport}
                      onCheckedChange={(checked) => handleCardSelectionChange('financialCards', 'varianceReport', checked as boolean)}
                    />
                    <Label htmlFor="varianceReport" className="text-xs cursor-pointer">Budget Variance Report</Label>
                  </div>
                </div>
              )}
            </div>

            {/* Sales Section */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <Checkbox
                  id="sales"
                  checked={config.includeSales}
                  onCheckedChange={(checked) => handleConfigChange('includeSales', checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="sales" className="text-sm font-medium cursor-pointer">
                    Sales Pipeline
                  </Label>
                  <p className="text-xs text-gray-600">Deals and pipeline analysis</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSection('sales')}
                  disabled={!config.includeSales}
                >
                  {expandedSections.sales ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              
              {config.includeSales && expandedSections.sales && (
                <div className="ml-6 space-y-2 border-l-2 border-orange-200 pl-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="pipelineMetrics"
                      checked={config.salesCards.pipelineMetrics}
                      onCheckedChange={(checked) => handleCardSelectionChange('salesCards', 'pipelineMetrics', checked as boolean)}
                    />
                    <Label htmlFor="pipelineMetrics" className="text-xs cursor-pointer">Pipeline Summary Metrics</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="pipelineByStage"
                      checked={config.salesCards.pipelineByStage}
                      onCheckedChange={(checked) => handleCardSelectionChange('salesCards', 'pipelineByStage', checked as boolean)}
                    />
                    <Label htmlFor="pipelineByStage" className="text-xs cursor-pointer">Pipeline by Stage Table</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="pipelineByClosingDate"
                      checked={config.salesCards.pipelineByClosingDate}
                      onCheckedChange={(checked) => handleCardSelectionChange('salesCards', 'pipelineByClosingDate', checked as boolean)}
                    />
                    <Label htmlFor="pipelineByClosingDate" className="text-xs cursor-pointer">Pipeline by Closing Date</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="dealSources"
                      checked={config.salesCards.dealSources}
                      onCheckedChange={(checked) => handleCardSelectionChange('salesCards', 'dealSources', checked as boolean)}
                    />
                    <Label htmlFor="dealSources" className="text-xs cursor-pointer">Deal Sources & Channels</Label>
                  </div>
                </div>
              )}
            </div>

            {/* Cash Flow Section */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <Checkbox
                  id="cashflow"
                  checked={config.includeCashFlow}
                  onCheckedChange={(checked) => handleConfigChange('includeCashFlow', checked)}
                />
                <div className="flex-1">
                  <Label htmlFor="cashflow" className="text-sm font-medium cursor-pointer">
                    Cash Flow Analysis
                  </Label>
                  <p className="text-xs text-gray-600">Cash trends and runway</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSection('cashflow')}
                  disabled={!config.includeCashFlow}
                >
                  {expandedSections.cashflow ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              
              {config.includeCashFlow && expandedSections.cashflow && (
                <div className="ml-6 space-y-2 border-l-2 border-cyan-200 pl-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="currentBalance"
                      checked={config.cashFlowCards.currentBalance}
                      onCheckedChange={(checked) => handleCardSelectionChange('cashFlowCards', 'currentBalance', checked as boolean)}
                    />
                    <Label htmlFor="currentBalance" className="text-xs cursor-pointer">Current Balance Card</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="monthlyBurnRate"
                      checked={config.cashFlowCards.monthlyBurnRate}
                      onCheckedChange={(checked) => handleCardSelectionChange('cashFlowCards', 'monthlyBurnRate', checked as boolean)}
                    />
                    <Label htmlFor="monthlyBurnRate" className="text-xs cursor-pointer">Monthly Burn Rate Card</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="cashRunway"
                      checked={config.cashFlowCards.cashRunway}
                      onCheckedChange={(checked) => handleCardSelectionChange('cashFlowCards', 'cashRunway', checked as boolean)}
                    />
                    <Label htmlFor="cashRunway" className="text-xs cursor-pointer">Cash Runway Analysis</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="monthlyTrend"
                      checked={config.cashFlowCards.monthlyTrend}
                      onCheckedChange={(checked) => handleCardSelectionChange('cashFlowCards', 'monthlyTrend', checked as boolean)}
                    />
                    <Label htmlFor="monthlyTrend" className="text-xs cursor-pointer">Monthly Trend Table</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="inflowOutflowBreakdown"
                      checked={config.cashFlowCards.inflowOutflowBreakdown}
                      onCheckedChange={(checked) => handleCardSelectionChange('cashFlowCards', 'inflowOutflowBreakdown', checked as boolean)}
                    />
                    <Label htmlFor="inflowOutflowBreakdown" className="text-xs cursor-pointer">Inflow/Outflow Breakdown</Label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Status Messages */}
          {generationStatus === 'generating' && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Fetching live data from Supabase and generating your PDF report...
              </AlertDescription>
            </Alert>
          )}

          {generationStatus === 'success' && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                PDF report generated successfully! Check your downloads folder.
              </AlertDescription>
            </Alert>
          )}

          {generationStatus === 'error' && error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Generate Button */}
          <Button 
            onClick={generatePDF} 
            disabled={
              isGenerating || 
              !dataStatus.hasAnyData || 
              (!config.includeOverview && !config.includeFinancial && !config.includeSales && !config.includeCashFlow)
            }
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <FileDown className="mr-2 h-4 w-4" />
                Generate PDF Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Enhanced Report Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Report Preview</CardTitle>
          <CardDescription>
            Preview of your report structure and selected content
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            
            {/* Cover Slide */}
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border-l-4 border-blue-500">
              <div>
                <h3 className="font-semibold">Cover Slide</h3>
                <p className="text-sm text-gray-600">{config.title} • {config.companyName}</p>
              </div>
              <Badge variant="secondary">Always Included</Badge>
            </div>

            {/* Dynamic Section Previews */}
            {config.includeOverview && (
              <div className="p-4 bg-green-50 rounded-lg border-l-4 border-green-500">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Overview & Performance</h3>
                  <Badge className="bg-green-100 text-green-800">Slide 2</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  {config.overviewCards.metricsGrid && <div>• Key Metrics Grid (6 cards)</div>}
                  {config.overviewCards.performanceCharts && <div>• Performance Charts</div>}
                </div>
              </div>
            )}

            {config.includeFinancial && (
              <div className="p-4 bg-purple-50 rounded-lg border-l-4 border-purple-500">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Financial Analysis</h3>
                  <Badge className="bg-purple-100 text-purple-800">Financial</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  {config.financialCards.revenueBreakdown && <div>• Revenue Breakdown Table</div>}
                  {config.financialCards.expenseAnalysis && <div>• Expense Analysis Table</div>}
                  {config.financialCards.varianceReport && <div>• Budget Variance Report</div>}
                </div>
              </div>
            )}

            {config.includeSales && (
              <div className="p-4 bg-orange-50 rounded-lg border-l-4 border-orange-500">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Sales Pipeline</h3>
                  <Badge className="bg-orange-100 text-orange-800">Sales</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  {config.salesCards.pipelineMetrics && <div>• Pipeline Summary (4 cards)</div>}
                  {config.salesCards.pipelineByStage && <div>• Pipeline by Stage Table</div>}
                  {config.salesCards.pipelineByClosingDate && <div>• Pipeline by Closing Date</div>}
                  {config.salesCards.dealSources && <div>• Deal Sources Analysis</div>}
                </div>
              </div>
            )}

            {config.includeCashFlow && (
              <div className="p-4 bg-cyan-50 rounded-lg border-l-4 border-cyan-500">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Cash Flow Analysis</h3>
                  <Badge className="bg-cyan-100 text-cyan-800">Cash Flow</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  {config.cashFlowCards.currentBalance && <div>• Current Balance Card</div>}
                  {config.cashFlowCards.monthlyBurnRate && <div>• Monthly Burn Rate Card</div>}
                  {config.cashFlowCards.cashRunway && <div>• Cash Runway Analysis</div>}
                  {config.cashFlowCards.monthlyTrend && <div>• Monthly Trend Table</div>}
                  {config.cashFlowCards.inflowOutflowBreakdown && <div>• Inflow/Outflow Breakdown</div>}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Features Note */}
      <div className="text-xs text-gray-600 space-y-1">
        <p><strong>This PDF includes:</strong></p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Professional slide-based layout with standardized formatting</li>
          <li>Only your selected cards and insights</li>
          <li>Real financial data from your uploaded files</li>
          <li>Consistent margins and alignment across all slides</li>
          <li>Dynamic charts generated from live data</li>
        </ul>
      </div>
    </div>
  )
}