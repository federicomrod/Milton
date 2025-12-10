'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { miltonEventsAPI } from '@/lib/milton-events'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { MetricsGrid } from '@/components/dashboard/metrics-grid'
import { LogoutButton } from '@/components/dashboard/logout-button'
import FileUpload from '@/components/dashboard/file-upload'
import { UploadedFilesDisplay } from '@/components/dashboard/uploaded-files-display'
import { FileManagement } from '@/components/dashboard/file-management'
import { FinancialCharts } from '@/components/dashboard/financial-charts'
import { SalesPipeline } from '@/components/dashboard/sales-pipeline'
import { CashFlowAnalysis } from '@/components/dashboard/cash-flow-analysis'
import { MetricSelector } from '@/components/dashboard/metric-selector'
import { UseCaseSelector } from '@/components/dashboard/use-case-selector'
import { getUseCase } from '@/types/use-cases'
import WelcomeBanner from '@/components/dashboard/WelcomeBanner'


import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { ChevronDown, ChevronUp, Upload, FileText, Target } from 'lucide-react'

// Helper component for locked/missing data placeholders
const LockedPlaceholder = ({ message }: { message: string }) => (
  <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
    💡 {message}
  </div>
)

type DataStatus = {
  ok?: boolean
  bank?: boolean
  crm?: boolean
  budget?: boolean
} | null

export default function DashboardPage() {
  const router = useRouter()
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    'mrr', 'arr', 'cashBalance', 'burnRate', 'contracted',
    'ltmRevenue', 'netMargin', 'customers'
  ])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false) // Start with loading false for development
  const [isUploadOpen, setIsUploadOpen] = useState(true) // Default to open
  const [hasUploadedData, setHasUploadedData] = useState(false)
  const [dataStatus, setDataStatus] = useState<DataStatus>(null)
  const [pendingUpload, setPendingUpload] = useState<{
    file: File | null
    datasetType: 'bank' | 'crm' | 'budget' | null
  } | null>(null)
  const [showUploadModeDialog, setShowUploadModeDialog] = useState(false)
  
  // Use case selection state
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null)
  const [useCaseConfirmed, setUseCaseConfirmed] = useState(false)

  // Check if user has uploaded data via Supabase/API
  const checkUploadedData = async () => {
      try {
        console.log('[Dashboard] Checking uploaded data from API...')
        const res = await fetch('/api/data/status')
        
        if (!res.ok) {
          console.warn('[Dashboard] Data status API returned non-OK status')
          setIsUploadOpen(true)
          setDataStatus(null)
          return
        }

        const json = await res.json()
        console.log('[Dashboard] Data status:', json)

        // Update dataStatus state for conditional rendering
        setDataStatus(json)

        const hasData = !!(json?.bank || json?.crm || json?.budget)
        setHasUploadedData(hasData)

        // If no data, keep upload section open by default
        if (!hasData) {
          setIsUploadOpen(true)
        }
      } catch (err) {
        console.error('[Dashboard] Error checking data status:', err)
        setIsUploadOpen(true)
        setDataStatus(null)
      }
  }

  // Upload file with specified mode
  const uploadFileWithMode = async (
      file: File,
      datasetType: 'bank' | 'crm' | 'budget',
      mode: 'overwrite' | 'append'
    ) => {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('datasetType', datasetType)
        formData.append('mode', mode)

        const res = await fetch('/api/data/upload', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const errorText = await res.text()
          console.error('[Dashboard] Upload failed', errorText)
          alert('Upload failed: ' + errorText)
          return
        }

        const result = await res.json()
        console.log('[Dashboard] Upload successful:', result)

        // Refresh data status and trigger dashboard generation
        await checkUploadedData()
        document.dispatchEvent(new CustomEvent('data-status:refresh'))
        miltonEventsAPI.publish('dashboard.generate', {
          businessModel: localStorage.getItem('businessModel') || ''
        })
      } catch (err) {
        console.error('[Dashboard] Upload error:', err)
        alert('Upload error: ' + (err as Error).message)
      }
  }

  // Handle file selected from dashboard uploader
  const handleDashboardFileSelected = async (
      file: File,
      datasetType: 'bank' | 'crm' | 'budget'
    ) => {
      const alreadyHasData =
        (datasetType === 'bank' && dataStatus?.bank) ||
        (datasetType === 'crm' && dataStatus?.crm) ||
        (datasetType === 'budget' && dataStatus?.budget)

      if (alreadyHasData) {
        setPendingUpload({ file, datasetType })
        setShowUploadModeDialog(true)
      } else {
        await uploadFileWithMode(file, datasetType, 'append')
      }
  }

  useEffect(() => {
    // Temporarily skip auth check for development
    const checkAuth = async () => {
      console.log('⚠️ Skipping auth check for development')
      setLoading(false)
    }

    // Check if use case was previously selected
    const checkStoredUseCase = () => {
      try {
        const storedUseCase = localStorage.getItem('selectedUseCase')
        const storedConfirmed = localStorage.getItem('useCaseConfirmed')
        
        console.log('🔍 Stored use case:', storedUseCase)
        console.log('🔍 Stored confirmed:', storedConfirmed)
        
        if (storedUseCase && storedConfirmed === 'true') {
          setSelectedUseCase(storedUseCase)
          setUseCaseConfirmed(true)
        } else {
          // Don't auto-confirm - let user select
          console.log('📝 No use case confirmed, showing selector')
          setSelectedUseCase(null)
          setUseCaseConfirmed(false)
        }
      } catch (error) {
        console.error('Error checking use case:', error)
        // Fallback to showing selector
        setSelectedUseCase(null)
        setUseCaseConfirmed(false)
      }
    }

    checkAuth()
    checkUploadedData()
    checkStoredUseCase()
  }, [])

  // Handle use case selection
  const handleUseCaseSelect = (useCaseId: string) => {
    setSelectedUseCase(useCaseId)
    localStorage.setItem('selectedUseCase', useCaseId)
  }

  // Handle use case confirmation
  const handleUseCaseConfirm = () => {
    setUseCaseConfirmed(true)
    localStorage.setItem('useCaseConfirmed', 'true')
  }

  // Reset use case (for testing)
  const resetUseCase = () => {
    setUseCaseConfirmed(false)
    setSelectedUseCase(null)
    localStorage.removeItem('useCaseConfirmed')
    localStorage.removeItem('selectedUseCase')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  // Temporarily allow rendering without user for development
  if (!user) {
    console.log('⚠️ No user, but rendering anyway for development')
    // return null // Commented out for development
  }

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        

          {/* Use Case Selection Section - Show when not confirmed */}
          {!useCaseConfirmed && (
            <div className="mb-8 border-2 border-blue-200 bg-blue-50 p-6 rounded-lg">
              <h3 className="text-xl font-semibold mb-4 text-blue-800">Select Your Business Type</h3>
              <UseCaseSelector
                selectedUseCase={selectedUseCase}
                onUseCaseSelect={handleUseCaseSelect}
                onConfirm={handleUseCaseConfirm}
              />
            </div>
          )}

          {/* Show business type badge when confirmed */}
          {useCaseConfirmed && selectedUseCase && (
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-gray-600">Business Type:</span>
                <span className="text-sm font-medium text-blue-600">
                  {getUseCase(selectedUseCase)?.name || selectedUseCase}
                </span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={resetUseCase}
                  className="text-xs"
                >
                  Change Use Case
                </Button>
              </div>
            </div>
          )}

          {/* File Upload Section - ALWAYS SHOW (Fixed) */}
          <Collapsible open={isUploadOpen} onOpenChange={setIsUploadOpen} className="mb-8">
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Upload className="h-5 w-5" />
                        Upload Financial Data
                        {hasUploadedData && (
                          <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded-full">
                            Data Loaded
                          </span>
                        )}
                        {!useCaseConfirmed && (
                          <span className="text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                            Use Case Required
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>
                        Upload your bank transactions, CRM data, and budget files to generate comprehensive insights
                        {!useCaseConfirmed && ' (Select business type first)'}
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="sm">
                      {isUploadOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent>
                  {/* Always render the content, just disable if use case not confirmed */}
                  {useCaseConfirmed ? (
                    <>
                      <FileUpload 
                        selectedUseCase={selectedUseCase}
                        onFileSelected={handleDashboardFileSelected}
                      />
                      <div className="mt-6">
                        <FileManagement />
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Upload className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <h3 className="text-lg font-medium mb-2">Business Type Required</h3>
                      <p className="text-sm">Please select your business type above before uploading files.</p>
                      <Button 
                        className="mt-4" 
                        onClick={() => {
                          setSelectedUseCase('b2b-startup')
                          setUseCaseConfirmed(true)
                          localStorage.setItem('selectedUseCase', 'b2b-startup')
                          localStorage.setItem('useCaseConfirmed', 'true')
                        }}
                      >
                        Quick Start with B2B Startup
                      </Button>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* KPI Tabs - Show regardless of use case for better UX */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4 mb-6 bg-white shadow-sm">
              <TabsTrigger value="overview" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                Overview
              </TabsTrigger>
              <TabsTrigger value="financial" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                Financial Analysis
              </TabsTrigger>
              <TabsTrigger value="sales" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                Sales Pipeline
              </TabsTrigger>
              <TabsTrigger value="cashflow" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                Cash Flow
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Key Metrics</h2>
                <MetricSelector
                  selectedMetrics={selectedMetrics}
                  onMetricsChange={(metrics) => setSelectedMetrics(metrics)}
                />
              </div>
              {dataStatus?.bank || dataStatus?.crm || dataStatus?.budget ? (
                <>
                  <MetricsGrid selectedMetrics={selectedMetrics} />
                  <h2 className="text-xl font-semibold mb-4 mt-8">Performance Charts</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FinancialCharts type="mrr-vs-plan" />
                    <FinancialCharts type="burn-rate" />
                  </div>
                </>
              ) : (
                <LockedPlaceholder message="Upload your financial data (bank transactions, CRM, or budget) in the 'Upload Financial Data' section above to see your key metrics and performance charts." />
              )}
            </TabsContent>

            <TabsContent value="financial" className="space-y-4">
              {dataStatus?.budget ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FinancialCharts type="income-statement" />
                    <FinancialCharts type="variance-analysis" />
                  </div>
                  <FinancialCharts type="ytd-performance" />
                </>
              ) : (
                <LockedPlaceholder message="To unlock Financial Analysis, upload your budget data in the 'Upload Financial Data' section above." />
              )}
            </TabsContent>

            <TabsContent value="sales" className="space-y-4">
              {dataStatus?.crm ? (
                <SalesPipeline />
              ) : (
                <LockedPlaceholder message="To unlock your Sales Pipeline, upload your CRM data in the 'Upload Financial Data' section above." />
              )}
            </TabsContent>

            <TabsContent value="cashflow" className="space-y-4">
              {dataStatus?.bank ? (
                <CashFlowAnalysis />
              ) : (
                <LockedPlaceholder message="To unlock Cash Flow Analysis, upload your bank transaction data in the 'Upload Financial Data' section above." />
              )}
            </TabsContent>
          </Tabs>
      </div>

      {/* Upload Mode Dialog */}
      {showUploadModeDialog && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-md bg-white p-6 shadow-lg max-w-md w-full space-y-4">
            <h2 className="text-lg font-semibold">How should I use this file?</h2>
            <p className="text-sm text-gray-600">
              We detected existing data for this dataset type. Do you want to{' '}
              <strong>overwrite the existing data</strong> or treat this as a{' '}
              <strong>new dataset</strong> and review it in the Data Model Builder?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowUploadModeDialog(false)
                  setPendingUpload(null)
                }}
                className="rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return
                  await uploadFileWithMode(pendingUpload.file!, pendingUpload.datasetType!, 'overwrite')
                  setShowUploadModeDialog(false)
                  setPendingUpload(null)
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Overwrite existing data
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return
                  await uploadFileWithMode(pendingUpload.file!, pendingUpload.datasetType!, 'append')
                  setShowUploadModeDialog(false)
                  setPendingUpload(null)
                  // redirect to Model Builder so user can inspect the new data
                  router.push('/dashboard/model')
                }}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Treat as new dataset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}