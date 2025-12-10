'use client'

import { useState } from 'react'
import { EnhancedDataProcessor } from '@/lib/enhanced-data-processor'
import { buildGenericIngestion } from '@/lib/enhanced-data-processor'
import { ColumnMapping, FileType } from '@/types/schema'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useDataStatus } from '@/lib/context/DataStatusContext'
import DataPreviewModal from '@/components/dashboard/DataPreviewModal'
import { insertProcessedData } from '@/lib/ingestion/ingestion-service'

interface MappingReview {
  fileName: string
  headers: string[]
  sampleRows: any[]
  fullData: any[] // Add full data storage
  mappings: ColumnMapping[]
  detectedType: string
  confidence: number
  issues: string[]
  autoMapped?: boolean
}

interface FileUploadProps {
  selectedUseCase?: string | null
  onFileSelected?: (file: File, datasetType: 'bank' | 'crm' | 'budget') => Promise<void>
}

export default function FileUpload({ selectedUseCase, onFileSelected }: FileUploadProps) {
  const { refreshDataStatus } = useDataStatus()
  const [isProcessing, setIsProcessing] = useState(false)
  const [mappingReview, setMappingReview] = useState<MappingReview | null>(null)
  const [showMappingUI, setShowMappingUI] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewData, setPreviewData] = useState<{ fileName: string, headers: string[], rows: any[], schema: any } | null>(null)

  // Dynamic mapping options by detected file type
  const getMappingOptions = (detectedType: string): Array<{ value: string, label: string }> => {
    switch (detectedType) {
      case "transactions":
        return [
          { value: "unmapped", label: "Ignore" },
          { value: "id", label: "ID" },
          { value: "date", label: "Date" },
          { value: "name", label: "Name" },
          { value: "description", label: "Description" },
          { value: "amount", label: "Amount" },
          { value: "category", label: "Category" },
          { value: "reference", label: "Reference" }
        ]
      case "deals":
        return [
          { value: "unmapped", label: "Ignore" },
          { value: "id", label: "Deal ID" },
          { value: "dealName", label: "Deal Name" },
          { value: "phase", label: "Phase" },
          { value: "amount", label: "Amount" },
          { value: "clientName", label: "Client Name" },
          { value: "firstAppointment", label: "First Appointment" },
          { value: "closingDate", label: "Closing Date" },
          { value: "product", label: "Product" }
        ]
      case "budget":
        return [
          { value: "unmapped", label: "Ignore" },
          { value: "id", label: "ID" },
          { value: "month", label: "Month" },
          { value: "category", label: "Category" },
          { value: "value", label: "Value" }
        ]
      default:
        return [{ value: "unmapped", label: "Ignore" }]
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // If onFileSelected handler is provided, delegate to it
    if (onFileSelected && files[0]) {
      const file = files[0]
      // Determine dataset type from file name or selected use case
      let datasetType: 'bank' | 'crm' | 'budget' = 'bank'
      const fileName = file.name.toLowerCase()
      if (fileName.includes('crm') || fileName.includes('deal') || fileName.includes('sales')) {
        datasetType = 'crm'
      } else if (fileName.includes('budget')) {
        datasetType = 'budget'
      } else if (fileName.includes('transaction') || fileName.includes('bank')) {
        datasetType = 'bank'
      }
      
      await onFileSelected(file, datasetType)
      return
    }

    setIsProcessing(true)
    setMappingReview(null)
    setShowMappingUI(false)

    try {
      // Process the first file for now (we can enhance to handle multiple files later)
      const file = files[0]
      console.log('Processing file:', file.name)

      // Step 1: Parse the raw file
      const { headers, data } = await parseRawFile(file)
      console.log('🔍 Parsed file with headers:', headers.length, 'and data rows:', data.length)
      console.log('🔍 Headers:', headers)
      console.log('🔍 Sample data:', data.slice(0, 3))

      // Step 2: Show preview modal before AI analysis
      setPreviewData({
        fileName: file.name,
        headers,
        rows: data,
        schema: { columns: headers.map(h => ({ name: h, type: 'string' })) }
      })
      setShowPreviewModal(true)
      setIsProcessing(false)
      return
    } catch (error) {
      console.error('File processing failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      alert(`Failed to process file: ${errorMessage}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // Helper for after preview confirmation
  const handlePreviewConfirm = async (
    cleanedRows: any[],
    finalSchema: any,
    meta: { fileName?: string; headers?: string[] }
  ) => {
    setIsProcessing(true)
    const ai = new EnhancedDataProcessor()
    console.log('Confirmed schema from preview:', finalSchema)
    console.log('Proceeding to AI analysis with cleaned data...')
    // Temporary loading indicator for AI mapping
    console.log('Running AI mapping...')
    try {
      const aiResult = await ai.callAIForMapping(finalSchema.columns.map((c: any) => c.name), cleanedRows.slice(0, 10))
      console.log('AI mapping after preview:', aiResult)
      console.log('AI mapping complete.')
      // Continue with rest of flow (reuse your existing code after aiResult)
      // -- Insert adapted logic here --
      // Check if auto-mapping was successful and can skip manual review
      console.log('[Mapping Auto] Checking auto-mapping eligibility:', {
        autoMapped: aiResult.autoMapped,
        needsManualReview: aiResult.needsManualReview,
        fileType: aiResult.fileType,
        confidence: aiResult.confidence
      })

      const canSkipManual =
        !aiResult.needsManualReview &&
        (aiResult.autoMapped || (aiResult.confidence ?? 0) >= 0.9)

      if (canSkipManual) {
        console.log(`[Mapping Auto] Detected ${aiResult.fileType} file with ${Math.round(aiResult.confidence * 100)}% confidence`)
        console.log('[Mapping Auto] Skipping manual review → inserting to Supabase')

        // Required-field validation before proceeding
        const requiredFieldsMap: { [key: string]: string[] } = {
          transactions: ["date", "name", "amount"],
          deals: ["deal_name", "client_name", "amount"],
          budget: ["month", "value"]
        }

        const required = requiredFieldsMap[aiResult.fileType] || []
        const processedSample = aiResult.fileType === 'transactions'
          ? new EnhancedDataProcessor().convertAutoMappedTransactions(cleanedRows.slice(0, 1))
          : aiResult.fileType === 'budget'
          ? new EnhancedDataProcessor().convertAutoMappedBudgets(cleanedRows.slice(0, 1))
          : null

        const hasAllRequired = processedSample && processedSample.length > 0 &&
          required.every(f => f in processedSample[0] && processedSample[0][f] != null)

        if (!hasAllRequired && aiResult.fileType !== 'budget') {
          console.warn(`[Mapping Warning] Missing required fields in auto-mapped ${aiResult.fileType} → switching to manual review.`)
          setShowMappingUI(true)
          setMappingReview({
            fileName: meta.fileName || '',
            headers: finalSchema.columns.map((c: any) => c.name),
            sampleRows: cleanedRows.slice(0, 5),
            fullData: cleanedRows,
            mappings: aiResult.suggestedMappings,
            detectedType: aiResult.fileType,
            confidence: aiResult.confidence || 0.8,
            issues: aiResult.issues || [],
            autoMapped: aiResult.autoMapped || false
          })
          return
        }

        // Get Supabase client
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          throw new Error('No authenticated user found')
        }

        let insertCount = 0
        let processed: any[] = []

        // Handle different file types
        if (aiResult.fileType === 'deals') {
          const result = await ai.convertAutoMappedCRMData(cleanedRows, aiResult.suggestedMappings)
          processed = (result.deals || []).map((d: any) => ({ ...d, user_id: user.id }))

          console.log('[Mapping Auto] Prepared deals (first 2):', processed.slice(0, 2))

          const insertResult = await insertProcessedData({
            supabase,
            userId: user.id,
            datasetType: 'crm',
            data: processed,
            mode: 'append'
          })
          if (!insertResult.success) {
            console.error('❌ Failed to insert deals:', insertResult.error)
            throw new Error(insertResult.error)
          }
          insertCount = insertResult.insertedCount
          localStorage.setItem('crmDeals', JSON.stringify(processed))
          console.log(`✅ Inserted ${insertCount} deals`)
        } else if (aiResult.fileType === 'transactions') {
          processed = ai.convertAutoMappedTransactions(cleanedRows)
            .map((t: any) => ({ ...t, user_id: user.id }))

          console.log('[Mapping Auto] Prepared transactions (first 2):', processed.slice(0, 2))

          // Filter out rows with null dates to prevent Supabase date errors
          const validTransactions = processed.filter((row: any) => row.date !== null)
          if (validTransactions.length < processed.length) {
            console.warn(`⚠️ Skipped ${processed.length - validTransactions.length} transactions with invalid dates`)
          }

          const insertResult = await insertProcessedData({
            supabase,
            userId: user.id,
            datasetType: 'bank',
            data: validTransactions,
            mode: 'append'
          })
          if (!insertResult.success) {
            console.error('❌ Failed to insert transactions:', insertResult.error)
            throw new Error(insertResult.error)
          }
          insertCount = insertResult.insertedCount
          localStorage.setItem('transactions', JSON.stringify(validTransactions))
          console.log(`✅ Inserted ${insertCount} valid transaction rows`)
        } else if (aiResult.fileType === 'budget') {
          // Use new matrix auto-detection logic
          const result = await ai.convertToStandardFormat(cleanedRows, aiResult.suggestedMappings || [], 'budget')
          const budgetData = result.budget
          let budgetEntries: any[] = []
          if (budgetData && budgetData.months && budgetData.categories) {
            for (const month of budgetData.months) {
              for (const [category, monthData] of Object.entries(budgetData.categories)) {
                if ((monthData as any)[month]) {
                  budgetEntries.push({
                    month,
                    category,
                    value: (monthData as any)[month]
                    // user_id will be added below for all entries
                  })
                }
              }
            }
          }
          // Filter out rows with null month dates to prevent Supabase date errors
          const validBudgets = budgetEntries.filter((row: any) => row.month !== null)
          if (validBudgets.length < budgetEntries.length) {
            console.warn(`⚠️ Skipped ${budgetEntries.length - validBudgets.length} budget rows with invalid dates`)
          }
          // Append user_id to each row before insert
          const budgetEntriesWithUser = validBudgets.map(entry => ({
            ...entry,
            user_id: user.id
          }))
          // Debug logs for inspection
          console.log('[Mapping Auto] Prepared budget entries (first 2):', budgetEntriesWithUser.slice(0, 2))
          console.log(`[Mapping Auto] Final validBudgets length: ${budgetEntriesWithUser.length}`)
          const insertResult = await insertProcessedData({
            supabase,
            userId: user.id,
            datasetType: 'budget',
            data: budgetEntriesWithUser,
            mode: 'append'
          })
          if (!insertResult.success) {
            console.error('❌ Failed to insert budget:', insertResult.error)
            throw new Error(insertResult.error)
          }
          insertCount = insertResult.insertedCount
          localStorage.setItem('budget', JSON.stringify(budgetEntriesWithUser))
          console.log(`✅ Inserted ${insertCount} valid budget rows`)
          window.dispatchEvent(new Event('data-status:refresh'))
        }
        // Universal ingestion fallback for unrecognized file types
        else {
          console.log(`[Universal Ingestion] Unrecognized file type "${aiResult.fileType}" – using generic ingestion path.`)
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('No authenticated user found')

           const generic = await buildGenericIngestion(finalSchema.columns.map((c: any) => c.name), cleanedRows)
          const { error } = await supabase.from('custom_datasets').insert({
            user_id: user.id,
            dataset_type: generic.schema?.columns?.length ? generic.schema.columns.map((c: any) => c.name).join(', ') : 'unknown',
            dataset_name: meta.fileName || '',
            schema_json: generic.schema,
            rows_json: generic.rows,
            source_meta: { uploaded_at: new Date().toISOString(), method: 'universal-ingestion' }
          })

          if (error) {
            console.error('❌ Failed to insert into custom_datasets:', error)
            throw new Error(error.message)
          }

          console.log(`✅ Inserted ${generic.rows.length} rows into custom_datasets.`)
          alert(`✅ Successfully processed ${meta.fileName || ''} (generic dataset) - ${generic.rows.length} records inserted.`)
          await refreshDataStatus()
          return
        }

        // Clear upload state
        setUploadedFiles([])
        alert(`✅ Successfully processed ${meta.fileName || ''} (${aiResult.fileType}) with ${Math.round(aiResult.confidence * 100)}% confidence - ${insertCount} records inserted`)

        // Refresh data status to update File Management counters
        await refreshDataStatus()
        return
      } else if (aiResult.needsManualReview) {
        console.warn('[Mapping Warning] Low-confidence mapping detected — opening manual review')
        console.warn('[Mapping Warning] Reasons:', {
          autoMapped: aiResult.autoMapped,
          confidence: aiResult.confidence,
          issues: aiResult.issues
        })
      } else {
        console.log('[Mapping Info] Opening manual review for file type:', aiResult.fileType)
      }

      // Step 3: Present mapping UI for user review (fallback)
      setMappingReview({
        fileName: meta.fileName || '',
        headers: finalSchema.columns.map((c: any) => c.name),
        sampleRows: cleanedRows.slice(0, 5),
        fullData: cleanedRows, // Store the full dataset
        mappings: aiResult.suggestedMappings,
        detectedType: aiResult.fileType,
        confidence: aiResult.confidence || 0.8,
        issues: aiResult.issues || [],
        autoMapped: aiResult.autoMapped || false
      })
      setShowMappingUI(true)
      setUploadedFiles([])
    } catch (error) {
      console.error('AI mapping after preview failed:', error)
      alert('AI mapping failed after preview.')
    } finally {
      setIsProcessing(false)
    }
  }

  const applyMapping = async () => {
    if (!mappingReview) return

    setIsProcessing(true)
    try {
      const ai = new EnhancedDataProcessor()
      const { mappings, fullData, detectedType } = mappingReview
      // Normalize mappings to always include the original column label
      const normalizedMappings = mappings.map(m => ({
        ...m,
        originalColumn: m.originalColumn || m.standardField
      }))
      
      console.log('🔍 Converting to standard format...')
      console.log('🔍 Using full data count:', fullData.length)
      console.log('🔍 Detected type:', detectedType)
      
      // Convert to standard format using AI mappings with FULL DATA
      let result: any
      if (mappingReview.autoMapped) {
        console.log('[Mapping Auto] Using auto-mapped conversion for CRM data')
        result = await ai.convertAutoMappedCRMData(fullData, normalizedMappings)
      } else {
        result = await ai.convertToStandardFormat(fullData, normalizedMappings, detectedType as FileType)
      }
      
      // Get Supabase client
      const supabase = createClient()
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('No authenticated user found')
      }

      // Extract processed data based on detected type
      let processedData: any[] = []
      let dataKey = ''
      let storedCount = 0

      if (detectedType === 'transactions') {
        processedData = result.transactions || []
        dataKey = 'transactions'
        console.log("🔍 Prepared transactions (first 2):", processedData.slice(0, 2))
        
        // Filter out rows with null dates to prevent Supabase date errors
        const validTransactions = processedData.filter(t => t.date !== null)
        if (validTransactions.length < processedData.length) {
          console.warn(`⚠️ Skipped ${processedData.length - validTransactions.length} transactions with invalid dates`)
        }
        
        // Insert into Supabase using unified ingestion
        const transactionsWithUser = validTransactions.map(t => ({
          ...t,
          user_id: user.id
        }))
        const insertResult = await insertProcessedData({
          supabase,
          userId: user.id,
          datasetType: 'bank',
          data: transactionsWithUser,
          mode: 'append'
        })
        if (!insertResult.success) {
          console.error("❌ Insert error:", insertResult.error)
          throw new Error(insertResult.error)
        }
        storedCount = validTransactions.length
        processedData = validTransactions
      } else if (detectedType === 'deals') {
        dataKey = 'crmDeals'
        
        if (mappingReview.autoMapped) {
          // Auto-mapped data is already normalized with snake_case fields
          const autoMappedDeals = (result.deals || []).map((d: any) => ({
            ...d,
            user_id: user.id
          }))
          
          console.log("✅ Auto-mapped CRM deals (first 2):", autoMappedDeals.slice(0, 2))
          
          // Insert using unified ingestion
          const insertResult = await insertProcessedData({
            supabase,
            userId: user.id,
            datasetType: 'crm',
            data: autoMappedDeals,
            mode: 'append'
          })
          if (!insertResult.success) {
            console.error("❌ Insert error:", insertResult.error)
            throw new Error(insertResult.error)
          }
          console.log(`✅ Inserted ${insertResult.insertedCount} CRM deals into Supabase (user_id: ${user.id.substring(0, 8)}...)`)
          storedCount = autoMappedDeals.length
          
          // Cache in localStorage after successful Supabase insertion
          localStorage.setItem(dataKey, JSON.stringify(autoMappedDeals))
          console.log(`📦 Cached deals in localStorage with key: ${dataKey}`)
        } else {
          // Fallback to manual field mapping for non-auto-mapped files
          const normalizedDeals = (result.deals || []).map((d: any) => ({
            user_id: user?.id,
            deal_name: d.deal_name || d.dealName || d["Deal Name"] || '',
            phase: d.phase || d.Phase || '',
            amount: Number(d.amount || d.Amount || 0),
            client_name: d.client_name || d.clientName || d["Client Name"] || '',
            first_appointment: d.first_appointment || d.firstAppointment || d["First Appointment"] || null,
            closing_date: d.closing_date || d.closingDate || d["Closing Date"] || null,
            product: d.product || d.Product || ''
          }))
          
          console.log("✅ Normalized CRM deals (first 2):", normalizedDeals.slice(0, 2))
          
          // Insert using unified ingestion
          const insertResult = await insertProcessedData({
            supabase,
            userId: user.id,
            datasetType: 'crm',
            data: normalizedDeals,
            mode: 'append'
          })
          if (!insertResult.success) {
            console.error("❌ Insert error:", insertResult.error)
            throw new Error(insertResult.error)
          }
          console.log("✅ Inserted CRM deals:", insertResult.insertedCount)
          storedCount = insertResult.insertedCount
          
          // Cache in localStorage after successful Supabase insertion
          localStorage.setItem(dataKey, JSON.stringify(normalizedDeals))
          console.log(`📦 Cached deals in localStorage with key: ${dataKey}`)
        }
      } else if (detectedType === 'budget') {
        // Handle budget data - convert to budget entries format
        const budgetData = result.budget
        if (budgetData && budgetData.months && budgetData.categories) {
          const budgetEntries: any[] = []
          for (const month of budgetData.months) {
            for (const [category, monthData] of Object.entries(budgetData.categories)) {
              if ((monthData as any)[month]) {
                budgetEntries.push({
                  month,
                  category,
                  value: (monthData as any)[month],
                  user_id: user.id
                })
              }
            }
          }
          
          // Only proceed if we have valid budget entries
          if (budgetEntries.length > 0) {
            console.log("🔍 Prepared budget entries (first 2):", budgetEntries.slice(0, 2))
            
            // Insert using unified ingestion
            const insertResult = await insertProcessedData({
              supabase,
              userId: user.id,
              datasetType: 'budget',
              data: budgetEntries,
              mode: 'append'
            })
            if (!insertResult.success) {
              console.error("❌ Insert error:", insertResult.error)
              throw new Error(insertResult.error)
            }
            storedCount = insertResult.insertedCount
            dataKey = 'budget'
          } else {
            throw new Error('No valid budget entries found in the data')
          }
        } else {
          throw new Error('Invalid budget data structure')
        }
      } else {
        // Guard against unsupported detected types
        throw new Error(`Unsupported detectedType: ${detectedType}`)
      }

      // Store in localStorage as cache (only after successful Supabase insertion and valid data)
      if (storedCount > 0 && detectedType !== 'deals') {
        if (detectedType === 'budget') {
          localStorage.setItem(dataKey, JSON.stringify(result.budget))
        } else {
          localStorage.setItem(dataKey, JSON.stringify(processedData))
        }
        console.log(`📦 Cached data in localStorage with key: ${dataKey}`)
      }
      
      console.log(`✅ Successfully stored ${storedCount} ${detectedType} records in Supabase`)
      
      setMappingReview(null)
      setShowMappingUI(false)
      setUploadedFiles([])
      alert(`Successfully processed ${mappingReview.fileName} as ${detectedType} (${storedCount} records stored)`)
      
      // Refresh data status to update File Management counters
      await refreshDataStatus()
    } catch (error) {
      console.error('Failed to apply mapping:', error)
      alert(`Failed to apply mapping: ${error instanceof Error ? error.message : JSON.stringify(error)}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      {previewData && (
        <DataPreviewModal
          open={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          fileName={previewData.fileName}
          sheetName={previewData.fileName}
          columns={previewData.headers}
          sampleRows={previewData.rows}
          onSave={(payload: any) => {
            setShowPreviewModal(false)
            setPreviewData(null)
            handlePreviewConfirm(previewData.rows, previewData.schema, {
              fileName: previewData.fileName,
              headers: previewData.headers
            })
          }}
        />
      )}
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <input 
            type="file" 
            onChange={handleFileUpload} 
            accept=".csv,.xlsx,.xls"
            multiple
            disabled={isProcessing}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {isProcessing && (
            <div className="text-sm text-gray-600">Processing file with AI...</div>
          )}
          {uploadedFiles.length > 0 && (
            <div className="text-sm text-green-600">
              {uploadedFiles.length} file(s) uploaded successfully
            </div>
          )}
        </div>

        {/* File Upload Results Display */}
        {mappingReview && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                File Analysis Results
                <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                  Enhanced detection with multi-language support and AI fallback
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <FileText className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{mappingReview.fileName}</div>
                      <div className="text-xs text-gray-500">
                        Detected as: <span className="font-medium">{mappingReview.detectedType}</span>
                      </div>
                    </div>
                  </div>
                                    <div className="text-right">
                      <div className="text-sm font-medium text-green-600">
                        {Math.round(mappingReview.confidence * 100)}% confidence
                      </div>
                      <div className="text-xs text-gray-500">
                        Processed {mappingReview.fullData.length} records
                      </div>
                    </div>
                </div>
                
                {mappingReview.issues.length > 0 && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h4 className="font-medium text-yellow-800 mb-2">Issues Found:</h4>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {mappingReview.issues.map((issue, idx) => (
                        <li key={idx}>• {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {mappingReview && showMappingUI && (
          <Card>
            <CardHeader>
              <CardTitle>
                Review AI-Suggested Mapping ({mappingReview.detectedType})
                {mappingReview.confidence && (
                  <span className="ml-2 text-sm text-gray-500">
                    Confidence: {Math.round(mappingReview.confidence * 100)}%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mappingReview.issues.length > 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <h4 className="font-medium text-yellow-800 mb-2">Issues Found:</h4>
                  <ul className="text-sm text-yellow-700">
                    {mappingReview.issues.map((issue, idx) => (
                      <li key={idx}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="space-y-3">
                {mappingReview.mappings.map((mapping, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-3 border rounded">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{mapping.originalColumn}</div>
                      <div className="text-xs text-gray-500">
                        Confidence: {Math.round(mapping.confidence * 100)}% | 
                        Type: {mapping.dataType}
                      </div>
                    </div>
                    <select
                      value={mapping.standardField}
                      onChange={e => {
                        const updated = [...mappingReview.mappings]
                        updated[idx].standardField = e.target.value
                        setMappingReview({ ...mappingReview, mappings: updated })
                      }}
                      className="flex-1 border px-3 py-2 rounded text-sm"
                    >
                      {getMappingOptions(mappingReview.detectedType).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-end mt-6 gap-2">
                <Button 
                  onClick={applyMapping} 
                  disabled={isProcessing}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isProcessing ? 'Processing...' : 'Apply Mapping'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setMappingReview(null)
                    setShowMappingUI(false)
                    setUploadedFiles([])
                  }}
                  disabled={isProcessing}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

// Helper function to parse raw files
async function parseRawFile(file: File): Promise<{ headers: string[], data: any[] }> {
  if (file.name.endsWith('.csv')) {
    return parseCSVFile(file)
  } else if (file.name.match(/\.(xlsx|xls)$/)) {
    return parseExcelFile(file)
  } else {
    throw new Error('Unsupported file format. Please upload a CSV or Excel file.')
  }
}

async function parseCSVFile(file: File): Promise<{ headers: string[], data: any[] }> {
  try {
    const text = await file.text()
    
    // Try to import Papa with better error handling
    let Papa
    try {
      const papaModule = await import('papaparse')
      Papa = papaModule.default || papaModule
      if (!Papa || !Papa.parse) {
        throw new Error('Papa module not properly loaded')
      }
    } catch (importError) {
      console.error('Failed to import Papa:', importError)
      throw new Error('CSV processing library not available.')
    }
    
    const result = Papa.parse(text, { 
      header: true, 
      skipEmptyLines: true,
      dynamicTyping: false // Keep as strings for better AI analysis
    })
    
    return {
      headers: result.meta.fields || [],
      data: result.data
    }
  } catch (error) {
    console.error('CSV parsing failed:', error)
    throw new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function parseExcelFile(file: File): Promise<{ headers: string[], data: any[] }> {
  try {
    const buffer = await file.arrayBuffer()
    
    // Try to import XLSX with better error handling
    let XLSX
    try {
      const xlsxModule = await import('xlsx')
      XLSX = xlsxModule.default || xlsxModule
      if (!XLSX || !XLSX.read) {
        throw new Error('XLSX module not properly loaded')
      }
    } catch (importError) {
      console.error('Failed to import XLSX:', importError)
      throw new Error('Excel processing library not available. Please try uploading a CSV file instead.')
    }
    
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    
    if (rows.length < 2) {
      throw new Error('Excel file must have at least header and data rows')
    }
    
    const headers = (rows[0] as any[]).map((h, i) => {
      if (!h || h.toString().trim() === '') {
        return i === 0 ? 'Category' : `Column_${i + 1}`
      }
      return h.toString().trim()
    })
    const dataRows = (rows.slice(1) as any[][]).map(row => {
      const obj: any = {}
      headers.forEach((header, index) => {
        obj[header] = row[index] || ''
      })
      return obj
    }).filter(row => Object.values(row).some(val => val && val.toString().trim() !== ''))
    
    return { headers, data: dataRows }
  } catch (error) {
    console.error('Excel parsing failed:', error)
    throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}