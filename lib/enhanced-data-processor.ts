// lib/enhanced-data-processor.ts
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  StandardizedData,
  StandardTransaction,
  StandardDeal,
  StandardBudget,
  ColumnMapping,
  DataProcessingResult,
  FileType,
  DealPhase,
  DEAL_PHASES
} from '@/types/schema'
import { categorizeTransaction } from './accounting-definitions'

export class EnhancedDataProcessor {
  private aiEndpoint = '/api/openai-analyze'

  // Canonical Supabase schemas with possible column name variations
  private readonly CRM_SCHEMA = {
    deal_name: ['deal name', 'name', 'opportunity name', 'deal', 'title'],
    phase: ['deal phase', 'stage', 'pipeline stage', 'status', 'phase'],
    amount: ['amount', 'value', 'deal value', 'revenue', 'price', 'total'],
    client_name: ['client name', 'customer', 'account name', 'company', 'client', 'account'],
    first_appointment: ['first appointment', 'meeting date', 'initial contact', 'appointment', 'first meeting'],
    closing_date: ['closing date', 'close date', 'expected close', 'deal close', 'close', 'target date'],
    product: ['product', 'service', 'offering', 'category', 'type', 'solution']
  }

  private readonly TRANSACTIONS_SCHEMA = {
    date: ['date', 'transaction date', 'datum', 'booking date', 'value date'],
    name: ['name', 'vendor', 'payee', 'merchant', 'counterparty'],
    description: ['description', 'text', 'memo', 'details', 'narrative', 'purpose'],
    amount: ['amount', 'value', 'sum', 'total', 'debit', 'credit'],
    category: ['category', 'type', 'classification', 'account'],
    reference: ['reference', 'ref', 'transaction id', 'id', 'number']
  }

  private readonly BUDGET_SCHEMA = {
    cost_center: ['cost center', 'department', 'division', 'unit'],
    month: ['month', 'period', 'date'],
    budgeted_amount: ['budgeted', 'planned', 'budget', 'forecast'],
    actual_amount: ['actual', 'spent', 'expenses'],
    variance: ['variance', 'difference', 'delta']
  }

  /**
   * Auto-map CSV headers to CRM schema fields with confidence scoring
   */
  private autoMapCRMColumns(headers: string[]): { mappings: ColumnMapping[], confidence: number, canSkipReview: boolean } {
    const mappings: ColumnMapping[] = []
    let totalConfidence = 0
    let mappedFields = 0

    console.log('[Mapping Auto] Starting auto-mapping for headers:', headers)

    headers.forEach(header => {
      const normalizedHeader = header.toLowerCase().trim()
      let bestMatch = { field: '', confidence: 0, keywords: [] as string[] }

      // Check each CRM schema field for matches
      Object.entries(this.CRM_SCHEMA).forEach(([field, keywords]) => {
        keywords.forEach(keyword => {
          const confidence = this.calculateMatchConfidence(normalizedHeader, keyword)
          if (confidence > bestMatch.confidence) {
            bestMatch = { field, confidence, keywords }
          }
        })
      })

      if (bestMatch.confidence >= 0.7) { // 70% minimum confidence threshold
        mappings.push({
          originalColumn: header,
          standardField: bestMatch.field,
          dataType: this.getDataTypeForField(bestMatch.field) as "string" | "number" | "date" | "currency",
          confidence: bestMatch.confidence
        })
        totalConfidence += bestMatch.confidence
        mappedFields++
        console.log(`[Mapping Auto] Matched "${header}" → ${bestMatch.field} (${Math.round(bestMatch.confidence * 100)}%)`)
      }
    })

    const avgConfidence = mappedFields > 0 ? totalConfidence / mappedFields : 0
    const canSkipReview = this.canSkipManualReview(mappings, avgConfidence)

    console.log(`[Mapping Auto] Matched ${mappedFields}/${headers.length} fields automatically.`)
    console.log(`[Mapping Auto] Average confidence: ${Math.round(avgConfidence * 100)}%`)
    
    if (canSkipReview) {
      console.log('[Mapping Auto] All mappings > 90% confidence, skipping review.')
    }

    return { mappings, confidence: avgConfidence, canSkipReview }
  }

  /**
   * Calculate confidence score for header-to-keyword matching
   */
  private calculateMatchConfidence(header: string, keyword: string): number {
    // Exact match
    if (header === keyword) return 1.0
    
    // Contains match
    if (header.includes(keyword) || keyword.includes(header)) return 0.9
    
    // Word boundary match
    const headerWords = header.split(/\s+/)
    const keywordWords = keyword.split(/\s+/)
    
    let wordMatches = 0
    keywordWords.forEach(kw => {
      if (headerWords.some(hw => hw === kw || hw.includes(kw) || kw.includes(hw))) {
        wordMatches++
      }
    })
    
    if (wordMatches > 0) {
      return (wordMatches / keywordWords.length) * 0.8
    }
    
    // Fuzzy match for common variations
    if (this.isFuzzyMatch(header, keyword)) return 0.7
    
    return 0
  }

  /**
   * Check for fuzzy matches (common abbreviations, synonyms)
   */
  private isFuzzyMatch(header: string, keyword: string): boolean {
    const fuzzyMatches: { [key: string]: string[] } = {
      'deal': ['d', 'deals'],
      'name': ['nm', 'n'],
      'client': ['cust', 'customer'],
      'amount': ['amt', 'value', 'val'],
      'date': ['dt', 'dte'],
      'appointment': ['appt', 'meeting'],
      'closing': ['close', 'closed']
    }

    return Object.entries(fuzzyMatches).some(([key, variations]) => {
      if (keyword.includes(key)) {
        return variations.some(variation => header.includes(variation))
      }
      return false
    })
  }

  /**
   * Get appropriate data type for CRM field
   */
  private getDataTypeForField(field: string): string {
    const key = field.toLowerCase()
    
    // Extended date recognition
    if (["date", "transaction_date", "datum", "month", "closing_date", "first_appointment"].includes(key)) {
      return "date"
    }
    
    // Extended number recognition
    if (["amount", "value", "budgeted", "planned", "actual", "variance"].includes(key)) {
      return "number"
    }
    
    // Fallback to type map for CRM fields
    const typeMap: { [key: string]: string } = {
      deal_name: 'text',
      client_name: 'text',
      phase: 'text',
      product: 'text'
    }
    return typeMap[field] || 'text'
  }

  /**
   * Determine if manual review can be skipped
   */
  private canSkipManualReview(mappings: ColumnMapping[], avgConfidence: number): boolean {
    // Required fields for CRM data
    const requiredFields = ['deal_name', 'amount', 'client_name']
    const mappedFields = mappings.map(m => m.standardField)
    
    const hasRequiredFields = requiredFields.every(field => mappedFields.includes(field))
    const highConfidence = avgConfidence >= 0.9
    
    return hasRequiredFields && highConfidence
  }

  /**
   * Normalize CRM data to snake_case for Supabase insertion
   */
  private normalizeCRMData(data: any[], mappings: ColumnMapping[]): any[] {
    const fieldMap = Object.fromEntries(
      mappings.map(m => [m.originalColumn, m.standardField])
    )

    return data.map((row, index) => {
      // Generate valid UUID for each deal
      const idValue = row.id && /^[0-9a-fA-F-]{36}$/.test(row.id)
        ? row.id
        : crypto.randomUUID()

      const normalized: any = {
        id: idValue,
        user_id: null // Will be set during insertion
      }

      // Map each column to its normalized field
      Object.entries(row).forEach(([column, value]) => {
        const targetField = fieldMap[column]
        if (targetField) {
          normalized[targetField] = this.processValue(value, this.getDataTypeForField(targetField))
        }
      })

      // Ensure required fields have fallback values
      if (!normalized.deal_name) normalized.deal_name = 'Unnamed Deal'
      if (!normalized.client_name) normalized.client_name = 'Unknown Client'
      if (!normalized.amount || isNaN(Number(normalized.amount))) normalized.amount = 0
      if (!normalized.phase) normalized.phase = 'Unknown'

      // Convert empty strings to null for date fields
      if (normalized.first_appointment === '') normalized.first_appointment = null
      if (normalized.closing_date === '') normalized.closing_date = null
      if (normalized.product === '') normalized.product = null

      return normalized
    })
  }

  /**
   * Universal auto-mapping that detects file type and maps accordingly
   */
  private autoMapColumns(headers: string[]): { fileType: FileType, mappings: ColumnMapping[], confidence: number, canSkipReview: boolean } {
    console.log('[Mapping Auto] Attempting universal auto-mapping for headers:', headers)
    
    // Try CRM mapping
    const crmResult = this.autoMapCRMColumns(headers)
    if (crmResult.canSkipReview) {
      console.log('[Mapping Auto] Detected as CRM/deals file')
      return { fileType: 'deals', ...crmResult }
    }
    
    // Try transactions mapping
    const txResult = this.autoMapColumns_Generic(headers, this.TRANSACTIONS_SCHEMA, ['date', 'amount'])
    if (txResult.canSkipReview) {
      console.log('[Mapping Auto] Detected as transactions file')
      return { fileType: 'transactions', ...txResult }
    }
    
    // Try budget mapping
    const budgetResult = this.autoMapColumns_Generic(headers, this.BUDGET_SCHEMA, ['month', 'budgeted_amount'])
    if (budgetResult.canSkipReview) {
      console.log('[Mapping Auto] Detected as budget file')
      return { fileType: 'budget', ...budgetResult }
    }
    
    // Default to low confidence
    return { fileType: 'transactions', mappings: [], confidence: 0, canSkipReview: false }
  }

  /**
   * Generic auto-mapping for any schema
   */
  private autoMapColumns_Generic(
    headers: string[], 
    schema: { [key: string]: string[] }, 
    requiredFields: string[]
  ): { mappings: ColumnMapping[], confidence: number, canSkipReview: boolean } {
    const mappings: ColumnMapping[] = []
    let totalConfidence = 0
    let mappedFields = 0

    headers.forEach(header => {
      const normalizedHeader = header.toLowerCase().trim()
      let bestMatch = { field: '', confidence: 0 }

      Object.entries(schema).forEach(([field, keywords]) => {
        keywords.forEach(keyword => {
          const confidence = this.calculateMatchConfidence(normalizedHeader, keyword)
          if (confidence > bestMatch.confidence) {
            bestMatch = { field, confidence }
          }
        })
      })

      if (bestMatch.confidence >= 0.7) {
        mappings.push({
          originalColumn: header,
          standardField: bestMatch.field,
          dataType: this.getDataTypeForField(bestMatch.field) as "string" | "number" | "date" | "currency",
          confidence: bestMatch.confidence
        })
        totalConfidence += bestMatch.confidence
        mappedFields++
      }
    })

    const avgConfidence = mappedFields > 0 ? totalConfidence / mappedFields : 0
    const mappedFieldNames = mappings.map(m => m.standardField)
    const hasRequiredFields = requiredFields.every(field => mappedFieldNames.includes(field))
    const canSkipReview = hasRequiredFields && avgConfidence >= 0.9

    return { mappings, confidence: avgConfidence, canSkipReview }
  }

  /**
   * Convert auto-mapped transactions
   */
  convertAutoMappedTransactions(data: any[], mappings?: ColumnMapping[]): any[] {
    const normalized = data.map(r => {
      const rawDate = r["Date"] || r["Transaction Date"] || r["Datum"] || null
      const isoDate = this.parseDate(rawDate)
      
      const rawAmount = r["Amount"] || r["Value"]
      const parsedAmount = this.parseAmount(rawAmount)
      
      const nameValue = r["Name"] || r["Vendor"] || r["Payee"] || "Unnamed Transaction"

      return {
        id: crypto.randomUUID(),
        user_id: null,
        date: isoDate,
        name: nameValue,
        description: r["Description"] || r["Text"] || null,
        amount: parsedAmount || 0,
        category: r["Category"] || r["Type"] || null,
        reference: r["Reference"] || ""
      }
    })

    const sampleDates = normalized.slice(0, 3).map(t => t.date).filter(Boolean)
    if (sampleDates.length > 0) {
      console.log("📆 Normalized dates to ISO:", sampleDates)
    }

    return normalized
  }

  /**
   * Convert auto-mapped budgets
   */
  convertAutoMappedBudgets(data: any[], mappings?: ColumnMapping[]): any[] {
    const normalized = data.map(r => ({
      id: crypto.randomUUID(),
      user_id: null,
      month: this.parseDate(r["Month"] || null),
      category: r["Category"] || r["Cost Center"] || r["Department"] || "General",
      value: this.parseAmount(r["Budgeted"] || r["Planned"] || r["Value"] || 0)
    }))

    const sampleMonths = normalized.slice(0, 3).map(b => b.month).filter(Boolean)
    if (sampleMonths.length > 0) {
      console.log("📆 Normalized budget months to ISO:", sampleMonths)
    }

    return normalized
  }

  async processFile(fileName: string, headers: string[], data: any[]): Promise<DataProcessingResult> {
    try {
      if (!headers || !Array.isArray(headers)) {
        throw new Error('Missing or invalid headers in processFile()')
      }
      if (!data || !Array.isArray(data)) {
        throw new Error('Missing or invalid data in processFile()')
      }

      // 1. Try universal auto-mapping first
      const autoMappingResult = this.autoMapColumns(headers)
      
      if (autoMappingResult.canSkipReview) {
        console.log('[Mapping Auto] Auto-mapping successful, skipping AI analysis')
        return {
          fileType: autoMappingResult.fileType,
          confidence: autoMappingResult.confidence,
          suggestedMappings: autoMappingResult.mappings,
          previewData: data.slice(0, 10),
          issues: [],
          needsManualReview: false,
          autoMapped: true
        }
      }

      // 2. Fall back to AI analysis if auto-mapping confidence is too low
      let aiAnalysis = await this.analyzeWithAI(fileName, headers, data.slice(0, 5))
      if ((!aiAnalysis.mappings && !aiAnalysis.columnMappings) || 
          (aiAnalysis.mappings && aiAnalysis.mappings.length === 0) ||
          (aiAnalysis.columnMappings && aiAnalysis.columnMappings.length === 0)) {
        console.warn('AI returned no mappings — falling back to rules.')
        aiAnalysis = this.fallbackAnalysis(fileName, headers, data.slice(0, 5))
      }
      
      // 3. Apply rule-based validation
      const validated = this.validateAIAnalysis(aiAnalysis, headers, data)
      
      // 4. Return processing result
      return {
        fileType: validated.fileType,
        confidence: validated.confidence,
        suggestedMappings: validated.mappings,
        previewData: data.slice(0, 10),
        issues: validated.issues,
        needsManualReview: validated.confidence < 0.8
      }
    } catch (error) {
      console.error('File processing failed:', error)
      if (error instanceof Error) {
        throw new Error(`Failed to process file: ${error.message}`)
      } else {
        throw new Error('Failed to process file: Unknown error')
      }
    }
  }

  async callAIForMapping(headers: string[], sampleData: any[]): Promise<DataProcessingResult> {
    try {
      const result = await this.processFile('uploaded_file', headers, sampleData)
      // Log the result before returning
      console.log("[Mapping Auto] Returning full mapping result:", {
        autoMapped: result.autoMapped,
        needsManualReview: result.needsManualReview,
        fileType: result.fileType,
        confidence: result.confidence,
        mappingsCount: result.suggestedMappings.length
      })
      // Return complete DataProcessingResult including autoMapped flag
      return result
    } catch (error) {
      console.error('AI mapping failed, using fallback:', error)
      // Return a basic fallback mapping
      const fallbackResult = {
        fileType: 'transactions' as const,
        confidence: 0.5,
        suggestedMappings: headers.map(header => ({
          originalColumn: header,
          standardField: this.mapColumnFallback(header, 'transactions'),
          confidence: 0.5,
          dataType: this.detectDataType(header, sampleData),
          transformation: 'none' as const
        })),
        previewData: sampleData.slice(0, 10),
        issues: ['Using fallback mapping due to processing error'],
        needsManualReview: true,
        autoMapped: false
      }
      console.log("[Mapping Auto] Returning fallback result:", {
        autoMapped: false,
        needsManualReview: true,
        fileType: 'transactions'
      })
      return fallbackResult
    }
  }

  private async parseFile(file: File): Promise<{ headers: string[], data: any[] }> {
    if (file.name.endsWith('.csv')) {
      return this.parseCSV(file)
    } else if (file.name.match(/\.(xlsx|xls)$/)) {
      return this.parseExcel(file)
    } else {
      throw new Error('Unsupported file format')
    }
  }

  private async parseCSV(file: File): Promise<{ headers: string[], data: any[] }> {
    const text = await file.text()
    
    // Try different delimiters
    const delimiters = [',', ';', '\t', '|']
    let bestResult = null
    let maxColumns = 0

    for (const delimiter of delimiters) {
      const result = Papa.parse(text, {
        header: true,
        delimiter,
        skipEmptyLines: true,
        dynamicTyping: false // Keep as strings for better AI analysis
      })

      if (result.meta.fields && result.meta.fields.length > maxColumns) {
        maxColumns = result.meta.fields.length
        bestResult = result
      }
    }

    if (!bestResult) {
      throw new Error('Could not parse CSV file')
    }

    return {
      headers: bestResult.meta.fields || [],
      data: bestResult.data
    }
  }

  private async parseExcel(file: File): Promise<{ headers: string[], data: any[] }> {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, {
      type: 'buffer', // handles both .xlsx and .xls
      cellDates: true
    })
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    
    // Convert to JSON with proper options
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false, // Keep formatted values for dates
      dateNF: 'yyyy-mm-dd'
    }) as any[][]

    if (jsonData.length < 2) {
      throw new Error('Excel file must have at least header and data rows')
    }

    const headers = jsonData[0].filter(h => h && h.toString().trim() !== '')
    const dataRows = jsonData.slice(1).map(row => {
      const obj: any = {}
      headers.forEach((header, index) => {
        obj[header] = row[index] || ''
      })
      return obj
    }).filter(row => Object.values(row).some(val => val && val.toString().trim() !== ''))

    return { headers, data: dataRows }
  }

  private async analyzeWithAI(fileName: string, headers: string[], sampleData: any[]): Promise<any> {
    const prompt = this.createAnalysisPrompt(fileName, headers, sampleData)

    console.log('[AI DEBUG] Prompt sent to OpenAI:', prompt)
    
    try {
      const response = await fetch(this.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      if (!response.ok) {
        throw new Error(`AI analysis failed: ${response.status}`)
      }

          const json = await response.json()
    console.log('[AI DEBUG] Response received from OpenAI:', json)
    
    // Handle API response format mismatch
    if (json.columnMappings && !json.mappings) {
      json.mappings = json.columnMappings.map((mapping: any) => ({
        originalColumn: mapping.originalColumn || mapping.column,
        standardField: mapping.standardField || mapping.field,
        confidence: mapping.confidence || 0.8,
        dataType: mapping.dataType || 'string',
        transformation: mapping.transformation || 'none'
      }))
    }
    
    return json
    } catch (error) {
      console.warn('AI analysis failed, using fallback:', error)
      return this.fallbackAnalysis(fileName, headers, sampleData)
    }
  }

  private createAnalysisPrompt(fileName: string, headers: string[], sampleData: any[]): string {
    return `Analyze this business data file and provide column mappings.

File: ${fileName}
Headers: ${JSON.stringify(headers)}
Sample Data: ${JSON.stringify(sampleData)}

The file could be:
1. TRANSACTIONS: Bank/financial transactions with date, amount, description, category
2. DEALS/CRM: Sales pipeline data with deal names, amounts, client names, phases
3. BUDGET: Financial planning data with months and budget categories

Respond with ONLY valid JSON:
{
  "fileType": "transactions|deals|budget",
  "confidence": 0.85,
  "reasoning": "Brief explanation of analysis",
  "columnMappings": [
    {
      "originalColumn": "exact header name",
      "standardField": "mapped field name",
      "confidence": 0.9,
      "dataType": "string|number|date|currency",
      "transformation": "date_conversion|currency_conversion|text_cleanup|none"
    }
  ],
  "issues": ["any data quality issues found"],
  "businessInsights": {
    "detectedLanguage": "en|de|mixed",
    "dateFormat": "detected format",
    "currencyFormat": "detected format",
    "primaryAmount": "main amount column"
  }
}`
  }

  private fallbackAnalysis(fileName: string, headers: string[], sampleData: any[]): any {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim())
    
    // Detect file type
    let fileType = 'transactions'
    let confidence = 0.3

    if (lowerHeaders.some(h => h.includes('deal') || h.includes('client') || h.includes('phase'))) {
      fileType = 'deals'
      confidence = 0.7
    } else if (lowerHeaders.some(h => h.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i))) {
      fileType = 'budget'
      confidence = 0.6
    }

    // Create basic mappings
    const columnMappings = headers.map(header => ({
      originalColumn: header,
      standardField: this.mapColumnFallback(header, fileType),
      confidence: 0.5,
      dataType: this.detectDataType(header, sampleData),
      transformation: 'none'
    }))

    return {
      fileType,
      confidence,
      reasoning: 'Fallback rule-based analysis',
      columnMappings,
      issues: [],
      businessInsights: {
        detectedLanguage: 'unknown',
        dateFormat: 'unknown',
        currencyFormat: 'unknown',
        primaryAmount: ''
      }
    }
  }

  private mapColumnFallback(header: string, fileType: string): string {
    const lower = header.toLowerCase().trim()
    
    if (fileType === 'deals') {
      if (lower.includes('deal') && lower.includes('name')) return 'dealName'
      if (lower.includes('client')) return 'clientName'
      if (lower.includes('phase') || lower.includes('stage')) return 'phase'
      if (lower.includes('amount') || lower.includes('value')) return 'amount'
      if (lower.includes('product')) return 'product'
      if (lower.includes('date')) return 'closingDate'
    }
    
    if (fileType === 'transactions') {
      if (lower.includes('buchung') || lower.includes('wertstellung')) return 'date'
      if (lower.includes('umsatz') || lower.includes('betrag')) return 'amount'
      if (lower.includes('verwendungszweck')) return 'reference'
      if (lower.includes('empfänger') || lower.includes('absender') || lower.includes('zahlungspflichtiger')) return 'description'
      if (lower.includes('kategorie') || lower.includes('category')) return 'category'
    }

    return 'unmapped'
  }

  private detectDataType(header: string, sampleData: any[]): 'string' | 'number' | 'date' | 'currency' {
    const lower = header.toLowerCase()
    
    if (lower.includes('date') || lower.includes('datum')) return 'date'
    if (lower.includes('amount') || lower.includes('betrag') || lower.includes('value')) return 'currency'
    
    // Check sample data
    const samples = sampleData.map(row => row[header]).filter(val => val != null && val !== '')
    if (samples.length === 0) return 'string'
    
    const firstSample = samples[0].toString()
    if (firstSample.match(/^\d+([.,]\d+)?$/)) return 'number'
    if (firstSample.match(/\d{4}-\d{2}-\d{2}/) || firstSample.match(/\d{2}[./]\d{2}[./]\d{4}/)) return 'date'
    
    return 'string'
  }

  private validateAIAnalysis(aiResult: any, headers: string[], data: any[]): any {
    const issues = []
    
    // Handle both mappings and columnMappings formats
    const mappings = aiResult.mappings || aiResult.columnMappings || []
    const mappedFields = mappings.map((m: any) => m.standardField)
    
    if (aiResult.fileType === 'deals') {
      if (!mappedFields.includes('dealName')) issues.push('No deal name column mapped')
      if (!mappedFields.includes('amount')) issues.push('No amount column mapped')
      if (!mappedFields.includes('clientName')) issues.push('No client name column mapped')
    }
    
    if (aiResult.fileType === 'transactions') {
      if (!mappedFields.includes('date')) issues.push('No date column mapped')
      if (!mappedFields.includes('amount')) issues.push('No amount column mapped')
    }
    
    // Adjust confidence based on issues
    let adjustedConfidence = aiResult.confidence || 0.3
    if (issues.length > 0) adjustedConfidence *= 0.7
    
    return {
      ...aiResult,
      confidence: adjustedConfidence,
      issues: [...(aiResult.issues || []), ...issues],
      mappings
    }
  }

  async convertToStandardFormat(
    data: any[], 
    mappings: ColumnMapping[], 
    fileType: FileType
  ): Promise<StandardizedData> {
    switch (fileType) {
      case 'deals':
        return { deals: this.convertToDeals(data, mappings) }
      case 'transactions':
        return { transactions: this.convertToTransactions(data, mappings) }
      case 'budget':
        return { budget: this.convertToBudget(data, mappings) }
      default:
        throw new Error(`Unsupported file type: ${fileType}`)
    }
  }

  /**
   * Convert data using auto-mapped CRM columns (bypasses manual mapping)
   */
  async convertAutoMappedCRMData(data: any[], mappings: ColumnMapping[]): Promise<StandardizedData> {
    console.log('[Mapping Auto] Converting CRM data with auto-mapped columns')
    const normalizedDeals = this.normalizeCRMData(data, mappings)
    console.log(`[Mapping Auto] Normalized ${normalizedDeals.length} deals for Supabase insert`)
    console.log('🧩 Prepared deals for Supabase insert:', normalizedDeals.slice(0, 2))
    return { deals: normalizedDeals }
  }

  private convertToDeals(data: any[], mappings: ColumnMapping[]): any[] {
    const fieldMap = Object.fromEntries(
      mappings.map(m => [m.originalColumn, { field: m.standardField, type: m.dataType }])
    )

    return data.map((row, index) => {
      const deal: StandardDeal = {
        id: `deal_${Date.now()}_${index}`,
        dealName: '',
        phase: 'Unknown',
        amount: 0,
        clientName: '',
        firstAppointment: '',
        closingDate: '',
        product: ''
      }

      Object.entries(row).forEach(([column, value]) => {
        const mapping = fieldMap[column]
        console.log('[Mapping Debug]', { column, mappedField: mapping?.field, value })
        // Hard fallback for phase recognition based on value content
        if (!mapping && column.toLowerCase().includes('phase') && typeof value === 'string') {
          const raw = value.toLowerCase()
          if (raw.includes('lead')) {
            deal.phase = 'Lead Generation'
            // After processing, log if Lead Generation
            if (deal.phase === 'Lead Generation') {
              console.log('[Lead Gen Deal]', {
                dealName: deal.dealName,
                amount: deal.amount,
                clientName: deal.clientName,
                closingDate: deal.closingDate
              })
            }
            return
          }
          if (raw.includes('first contact')) {
            deal.phase = 'First Contact'
            return
          }
          if (raw.includes('qual')) {
            deal.phase = 'Need Qualification'
            return
          }
          if (raw.includes('negotiation') || raw.includes('verhandlung')) {
            deal.phase = 'Negotiation'
            return
          }
          if (raw.includes('deal') || raw.includes('gewonnen')) {
            deal.phase = 'Deal'
            return
          }
          if (raw.includes('no deal') || raw.includes('kein')) {
            deal.phase = 'No Deal'
            return
          }
        }
        // Fallback: infer phase if not explicitly mapped
        if (!mapping && column.toLowerCase().includes('phase') && typeof value === 'string') {
          const norm = value.toString().trim().toLowerCase()
          const phaseAliases: { [key: string]: string } = {
            'lead gen': 'Lead Generation',
            'leadgen': 'Lead Generation',
            'lead-generation': 'Lead Generation',
            'leadgeneration': 'Lead Generation',
            'lead generation': 'Lead Generation',
            'lead gen.': 'Lead Generation',
            'lead-gen': 'Lead Generation',
            'lead': 'Lead Generation',
            'first contact': 'First Contact',
            'need qualification': 'Need Qualification',
            'qualifizierung': 'Need Qualification',
            'verhandlung': 'Negotiation',
            'negotiation': 'Negotiation',
            'deal': 'Deal',
            'gewonnen': 'Deal',
            'kein deal': 'No Deal',
            'no deal': 'No Deal'
          }
          deal.phase = phaseAliases[norm] || value
          if (deal.phase === 'Lead Generation') {
            console.log('[Lead Gen Deal]', {
              dealName: deal.dealName,
              amount: deal.amount,
              clientName: deal.clientName,
              closingDate: deal.closingDate
            })
          }
          return
        }
        if (!mapping || !value) return

        const processedValue = this.processValue(value, mapping.type)
        
        switch (mapping.field) {
          case 'dealName':
            deal.dealName = processedValue.toString()
            break
          case 'clientName':
            deal.clientName = processedValue.toString()
            break
          case 'phase':
            // Normalize phase values
            const rawPhase = processedValue.toString().toLowerCase()
            if (['lead generation', 'LEAD GEN', 'lead-gen', 'kontaktaufnahme'].includes(rawPhase)) {
              deal.phase = 'Lead Generation'
            } else if (['first contact', 'FIRST CONTACT'].includes(rawPhase)) {
              deal.phase = 'First Contact'
            } else if (['need qualification', 'NEED QUALIFICATION', 'bedarf'].includes(rawPhase)) {
              deal.phase = 'Need Qualification'
            } else if (['negotiation', 'verhandlungsphase', 'NEGOTIATION'].includes(rawPhase)) {
              deal.phase = 'Negotiation'
            } else if (['deal', 'DEAL', 'abgeschlossen'].includes(rawPhase)) {
              deal.phase = 'Deal'
            } else if (['no deal', 'kein deal', 'NO DEAL'].includes(rawPhase)) {
              deal.phase = 'No Deal'
            } else {
              deal.phase = 'Unknown'
            }
            if (deal.phase === 'Lead Generation') {
              console.log('[Lead Gen Deal]', {
                dealName: deal.dealName,
                amount: deal.amount,
                clientName: deal.clientName,
                closingDate: deal.closingDate
              })
            }
            break
          case 'amount':
            deal.amount = this.parseAmount(processedValue)
            break
          case 'product':
            deal.product = processedValue.toString()
            break
          case 'firstAppointment':
          case 'closingDate':
            const parsedDate = this.parseDate(processedValue)
            deal[mapping.field] = parsedDate ?? undefined
            break
        }
        // After processing each column, log if Lead Generation
        if (deal.phase === 'Lead Generation') {
          console.log('[Lead Gen Deal]', {
            dealName: deal.dealName,
            amount: deal.amount,
            clientName: deal.clientName,
            closingDate: deal.closingDate
          })
        }
      })

      // Validation and cleanup
      if (!deal.dealName && deal.clientName) {
        deal.dealName = `Deal with ${deal.clientName}`
      }
      if (!deal.clientName) {
        deal.clientName = 'Unknown Client'
      }

      return deal
    }).filter(deal => deal.dealName && (deal.amount > 0 || deal.clientName !== 'Unknown Client'))
    .map(d => ({
      // Convert to snake_case for Supabase compatibility
      deal_name: d.dealName ?? '',
      phase: d.phase ?? '',
      amount: Number(d.amount ?? 0),
      client_name: d.clientName ?? '',
      first_appointment: d.firstAppointment ?? null,
      closing_date: d.closingDate ?? null,
      product: d.product ?? '',
      // Keep original id for reference
      id: d.id
    }))
  }

  private convertToTransactions(data: any[], mappings: ColumnMapping[]): StandardTransaction[] {
    const fieldMap = Object.fromEntries(
      mappings.map(m => [m.originalColumn, { field: m.standardField, type: m.dataType }])
    )

    return data.map((row, index) => {
      const transaction: any = {
        id: `tx_${Date.now()}_${index}`,
        date: '',
        name: '',
        description: '',
        amount: 0,
        category: 'Other',
        reference: ''
      }

      Object.entries(row).forEach(([column, value]) => {
        const mapping = fieldMap[column]
        if (!mapping || !value) return

        const processedValue = this.processValue(value, mapping.type)
        
        switch (mapping.field) {
          case 'date':
            transaction.date = this.parseDate(processedValue)
            break
          case 'name':
            transaction.name = processedValue.toString()
            break
          case 'amount':
            transaction.amount = this.parseAmount(processedValue)
            break
          case 'description':
            transaction.description = processedValue.toString()
            break
          case 'category':
            // Use the accounting definitions for better categorization
            const originalCategory = processedValue.toString()
            transaction.category = categorizeTransaction(
              transaction.description, 
              transaction.amount, 
              originalCategory
            )
            break
          case 'reference':
            transaction.reference = processedValue.toString()
            break
        }
      })

      // Ensure name has a fallback value if not mapped
      if (!transaction.name) {
        transaction.name = transaction.description || "Unnamed Transaction"
      }

      return transaction
    }).filter(tx => tx.date && !isNaN(tx.amount))
  }

  private convertToBudget(data: any[], mappings: ColumnMapping[]): StandardBudget {
    // Debug log for incoming mappings
    console.log("[Budget Debug] Incoming mappings:", mappings.map(m => m.standardField));

    // --- Auto-detect and flatten wide-format budget matrices ---
    // Detect if data is a wide-format budget matrix (one non-numeric column, multiple month-like columns)
    if (data && data.length > 0) {
      // Find columns that are numeric for most rows (potential months), and one that is not (e.g., category)
      const sampleRow = data[0];
      const columns = Object.keys(sampleRow);
      // Count numeric-ness for each column
      const colStats = columns.map(col => {
        let numericCount = 0;
        let nonEmptyCount = 0;
        for (let i = 0; i < Math.min(10, data.length); ++i) {
          const v = data[i][col];
          if (v !== undefined && v !== null && v !== '') {
            nonEmptyCount++;
            if (!isNaN(Number(String(v).replace(/[,.\s€$£¥]/g, '').replace(/[^0-9\-]/g, '')))) {
              numericCount++;
            }
          }
        }
        return { col, numericCount, nonEmptyCount };
      });
      // Find non-numeric columns (likely "Category")
      const likelyNonNumeric = colStats.filter(stat => stat.numericCount <= 2 && stat.nonEmptyCount > 0);
      // Find columns that are numeric for most rows (likely months)
      const likelyMonthCols = colStats.filter(stat => stat.numericCount >= Math.max(3, Math.ceil(stat.nonEmptyCount * 0.7)));
      // Heuristic: if exactly one non-numeric column and >=2 likely month columns, treat as wide-format
      if (likelyNonNumeric.length === 1 && likelyMonthCols.length >= 2) {
        const categoryCol = likelyNonNumeric[0].col;
        const monthCols = likelyMonthCols.map(stat => stat.col);
        console.log("[Budget AutoDetect] Detected wide-format budget matrix");
        // Flatten to entries: { month, category, value }
        const flatEntries: { month: string, category: string, value: number }[] = [];
        data.forEach(row => {
          const category = row[categoryCol] ? row[categoryCol].toString() : '';
          monthCols.forEach(monthCol => {
            const value = this.parseAmount(row[monthCol]);
            if (
              (row[monthCol] !== undefined && row[monthCol] !== null && row[monthCol] !== '' && !isNaN(value)) ||
              value !== 0
            ) {
              // Normalize month string to ISO or readable
              let normMonth = this.parseDate(monthCol) || monthCol;
              flatEntries.push({
                month: normMonth,
                category,
                value
              });
            }
          });
        });
        // Build months/categories structure
        const monthSet = new Set<string>();
        const categorySet = new Set<string>();
        flatEntries.forEach(entry => {
          monthSet.add(entry.month);
          categorySet.add(entry.category);
        });
        const months = Array.from(monthSet).sort();
        const categories: { [category: string]: { [month: string]: number } } = {};
        categorySet.forEach(category => {
          categories[category] = {};
        });
        flatEntries.forEach(entry => {
          categories[entry.category][entry.month] = entry.value;
        });
        return { months, categories };
      }
    }

    // --- Existing mapping-based logic for wide and long-format ---
    // Auto-detect month-like headers and update mappings if needed
    if (!mappings.some(m => m.standardField.startsWith('month_'))) {
      // Month-like patterns: Jan, Feb, March, 2025-02, 2025.02, 02/2025, Jan-2025, Feb-2025, etc.
      const monthPatterns = [
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*([-. ]*\d{2,4})?\b/i,
        /\b\d{4}[-.\/](0[1-9]|1[0-2])\b/,
        /\b(0[1-9]|1[0-2])[-.\/]\d{4}\b/,
      ];
      for (const mapping of mappings) {
        const col = mapping.originalColumn;
        // Check for month-like string in column name
        if (monthPatterns.some(pat => pat.test(col))) {
          // Normalize: lowercase, replace spaces/dots with dashes, remove extra dashes
          let normalized = col.toLowerCase().replace(/[\s.]+/g, '-').replace(/-+/g, '-').replace(/[^a-z0-9\-]/g, '');
          // Avoid double month_ if already present
          if (!mapping.standardField.startsWith('month_')) {
            mapping.standardField = `month_${normalized}`;
          }
        }
      }
    }
    // Budget conversion logic - supports both wide-format (month columns) and long-format (month/category/value rows)
    let months = mappings
      .filter(m => m.standardField.startsWith('month_'))
      .map(m => m.standardField.replace('month_', ''))
      .sort();

    let categories: { [category: string]: { [month: string]: number } } = {};

    // --- Fallback: Auto-detect the category column if not explicitly mapped ---
    let categoryColumn = mappings.find(m => m.standardField === 'category')?.originalColumn;
    if (!categoryColumn && data.length) {
      const monthPatterns = [
        /jan/i, /feb/i, /mar/i, /apr/i, /may/i, /jun/i,
        /jul/i, /aug/i, /sep/i, /oct/i, /nov/i, /dec/i, /202\d/
      ];
      const fallbackCategory = Object.keys(data[0]).find(
        col => !monthPatterns.some(p => p.test(col))
      );
      if (fallbackCategory) {
        categoryColumn = fallbackCategory;
        mappings.push({
          originalColumn: fallbackCategory,
          standardField: 'category',
          confidence: 0.5,
          dataType: 'string',
        });
        console.log('[Budget AutoDetect] Fallback category column:', fallbackCategory);
      }
    }

    // Wide-format: each row is a category, each column is a month
    data.forEach(row => {
      if (!categoryColumn || !row[categoryColumn]) return;

      const category = row[categoryColumn].toString();
      categories[category] = {};

      mappings
        .filter(m => m.standardField.startsWith('month_'))
        .forEach(mapping => {
          const month = mapping.standardField.replace('month_', '');
          categories[category][month] = this.parseAmount(row[mapping.originalColumn] || 0);
        });
    });

    // Fallback: If no months or categories found, try to parse as long-format (month/category/value per row)
    if (months.length === 0 || Object.keys(categories).length === 0) {
      // Try to detect long-format budget: look for fields named "month", "category", "value"
      const monthField = mappings.find(m => m.standardField === 'month')?.originalColumn || 'month';
      const categoryField = mappings.find(m => m.standardField === 'category')?.originalColumn || 'category';
      const valueField =
        mappings.find(m => ['value', 'budgeted_amount', 'amount'].includes(m.standardField))?.originalColumn
        || 'value';

      // Try to extract unique months and categories
      const budgetEntries: { month: string, category: string, value: number }[] = [];
      data.forEach(row => {
        // Accept both with mappings or fallback to best-guess field names
        const rawMonth = row[monthField];
        const rawCategory = row[categoryField];
        const rawValue = row[valueField];
        if (!rawMonth || !rawCategory) return;
        const normMonth = this.parseDate(rawMonth);
        const normCategory = rawCategory.toString();
        const normValue = this.parseAmount(rawValue);
        if (!normMonth || !normCategory) return;
        budgetEntries.push({
          month: normMonth,
          category: normCategory,
          value: normValue
        });
      });
      // Build months/categories structure
      const monthSet = new Set<string>();
      const categorySet = new Set<string>();
      budgetEntries.forEach(entry => {
        monthSet.add(entry.month);
        categorySet.add(entry.category);
      });
      months = Array.from(monthSet).sort();
      categories = {};
      categorySet.forEach(category => {
        categories[category] = {};
      });
      budgetEntries.forEach(entry => {
        categories[entry.category][entry.month] = entry.value;
      });
    }

    return { months, categories };
  }

  private processValue(value: any, dataType: string): any {
    if (value == null || value === '') return ''
    
    switch (dataType) {
      case 'date':
        return this.parseDate(value)
      case 'currency':
      case 'number':
        return this.parseAmount(value)
      default:
        return value.toString().trim()
    }
  }

  private parseDate(value: any): string | null {
    if (!value) return null;

    const str = String(value).trim();
    // Sanitize header labels and remove suffixes/non-essential words
    const cleaned = str
      .toLowerCase()
      .replace(/[\s_-]*(budget|plan|forecast|actuals?)\b/g, '') // remove trailing words
      .replace(/[^a-z0-9\s-]/g, ' ') // strip non-alphanumeric
      .replace(/\s+/g, ' ') // normalize spaces
      .trim();

    // Ignore placeholders or invalid values
    if (
      str === "" ||
      str.toLowerCase() === "n/a" ||
      str === "-" ||
      str === "null" ||
      str === "undefined"
    ) {
      return null;
    }

    // Month name mapping (English, lowercased, standard and short forms)
    const monthMap: { [key: string]: string } = {
      january: "01",
      jan: "01",
      february: "02",
      feb: "02",
      march: "03",
      mar: "03",
      april: "04",
      apr: "04",
      may: "05",
      june: "06",
      jun: "06",
      july: "07",
      jul: "07",
      august: "08",
      aug: "08",
      september: "09",
      sep: "09",
      sept: "09",
      october: "10",
      oct: "10",
      november: "11",
      nov: "11",
      december: "12",
      dec: "12"
    };

    // Check if the string is a month name (case-insensitive, allow for whitespace)
    const lowerStr = cleaned.replace(/\s+/g, "");
    for (const [monthName, monthNum] of Object.entries(monthMap)) {
      if (lowerStr === monthName) {
        // Format as YYYY-MM-DD using current year and day 01
        const now = new Date();
        const year = now.getFullYear();
        return `${year}-${monthNum}-01`;
      }
    }
    // Also allow for "Month YYYY" or "YYYY Month"
    // e.g., "January 2023", "2023 January"
    const monthNameRegex = new RegExp(
      `^(?:(${Object.keys(monthMap).join("|")})\\s*(\\d{4})|(\\d{4})\\s*(${Object.keys(monthMap).join("|")}))$`,
      "i"
    );
    const match = cleaned.match(monthNameRegex);
    if (match) {
      let year = "";
      let month = "";
      if (match[1] && match[2]) {
        // e.g., January 2023
        month = monthMap[match[1].toLowerCase()];
        year = match[2];
      } else if (match[3] && match[4]) {
        // e.g., 2023 January
        year = match[3];
        month = monthMap[match[4].toLowerCase()];
      }
      if (year && month) {
        return `${year}-${month}-01`;
      }
    }

    try {
      // Handle Excel serial dates
      if (typeof value === "number" && value > 25000) {
        const date = new Date((value - 25569) * 86400 * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split("T")[0];
      }

      // Handle various string formats
      if (typeof value === "string") {
        // German format: DD.MM.YYYY
        if (str.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
          const [day, month, year] = str.split(".");
          const d = parseInt(day, 10);
          const m = parseInt(month, 10);
          const y = parseInt(year, 10);
          if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            const date = new Date(y, m - 1, d);
            if (isNaN(date.getTime())) return null;
            return date.toISOString().split("T")[0];
          }
          return null;
        }

        // US format: MM/DD/YYYY
        if (str.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          const [month, day, year] = str.split("/");
          const d = parseInt(day, 10);
          const m = parseInt(month, 10);
          const y = parseInt(year, 10);
          if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            const date = new Date(y, m - 1, d);
            if (isNaN(date.getTime())) return null;
            return date.toISOString().split("T")[0];
          }
          return null;
        }

        // Try generic date parsing for DD-MM-YYYY, DD/MM/YYYY, etc.
        const parts = str.split(/[./-]/);
        if (parts.length === 3) {
          const nums = parts.map((p) => parseInt(p, 10));
          if (nums.every((n) => !isNaN(n))) {
            const [a, b, c] = nums;
            // Try DD.MM.YYYY format first
            if (a <= 31 && b <= 12) {
              const date = new Date(c, b - 1, a);
              if (!isNaN(date.getTime())) {
                return date.toISOString().split("T")[0];
              }
            }
          }
        }

        // ISO format or parseable string
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split("T")[0];
        }
      }

      // If we can't parse it, fall through to fallback below
    } catch {
      // On error, fall through to fallback below
    }

    // Fallback: Try to extract month name from the cleaned string and construct a valid ISO date
    // Use first 3 letters (lowercased, trimmed) to try to match a month
    const maybeMonth = cleaned.slice(0, 3).toLowerCase();
    const monthShortMap: { [key: string]: string } = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };
    // If the string is a month or month-year-like, try to construct a date, otherwise return null
    // Try to extract year as 4-digit number
    const yearMatch = cleaned.match(/(\d{4})/);
    const monthNum = monthShortMap[maybeMonth];
    if (monthNum) {
      let year = null;
      if (yearMatch) {
        year = yearMatch[1];
      } else {
        // No year, use current year
        year = new Date().getFullYear();
      }
      return `${year}-${monthNum}-01`;
    }

    // If not recognized as a valid date or month, return null instead of raw string
    return null;
  }

  private parseAmount(value: any): number {
    if (typeof value === 'number') return value
    if (!value) return 0
    
    let cleanValue = value.toString()
      .replace(/[€$£¥\s]/g, '') // Remove currency symbols and spaces
      .replace(/[^\d.,-]/g, '') // Keep only digits, dots, commas, minus
    
    // Handle German format: 1.234,56
    if (cleanValue.includes(',') && cleanValue.includes('.')) {
      const lastComma = cleanValue.lastIndexOf(',')
      const lastDot = cleanValue.lastIndexOf('.')
      if (lastComma > lastDot) {
        cleanValue = cleanValue.replace(/\./g, '').replace(',', '.')
      }
    } else if (cleanValue.includes(',')) {
      // German decimal or US thousands
      const parts = cleanValue.split(',')
      if (parts.length === 2 && parts[1].length <= 2) {
        cleanValue = cleanValue.replace(',', '.')
      } else {
        cleanValue = cleanValue.replace(/,/g, '')
      }
    }
    
    const parsed = parseFloat(cleanValue)
    return isNaN(parsed) ? 0 : parsed
  }

  private mapCategory(category: string): string {
    const lowerCategory = category.toLowerCase().trim()
    
    // Map German revenue categories
    if (lowerCategory.includes('trainings') || lowerCategory.includes('training')) {
      return 'Revenue'
    }
    if (lowerCategory.includes('subscription') || lowerCategory.includes('abonnement')) {
      return 'Revenue'
    }
    if (lowerCategory.includes('programme') || lowerCategory.includes('programm')) {
      return 'Revenue'
    }
    if (lowerCategory.includes('coaching')) {
      return 'Revenue'
    }
    
    // Map German expense categories
    if (lowerCategory.includes('gehälter') || lowerCategory.includes('gehalt') || lowerCategory.includes('lohn')) {
      return 'Salaries'
    }
    if (lowerCategory.includes('marketing')) {
      return 'Marketing'
    }
    if (lowerCategory.includes('miete') || lowerCategory.includes('rent')) {
      return 'Rent'
    }
    if (lowerCategory.includes('software') || lowerCategory.includes('licence') || lowerCategory.includes('lizenz')) {
      return 'Software'
    }
    if (lowerCategory.includes('sonstiges') || lowerCategory.includes('other') || lowerCategory.includes('misc')) {
      return 'Other OpEx'
    }
    
    // Map English revenue categories (fallback)
    if (lowerCategory.includes('revenue') || lowerCategory.includes('income') || lowerCategory.includes('sales')) {
      return 'Revenue'
    }
    if (lowerCategory.includes('consulting') || lowerCategory.includes('service') || lowerCategory.includes('fee')) {
      return 'Revenue'
    }
    if (lowerCategory.includes('subscription') || lowerCategory.includes('recurring')) {
      return 'Revenue'
    }
    
    // Map English expense categories (fallback)
    if (lowerCategory.includes('cost') || lowerCategory.includes('cogs') || lowerCategory.includes('goods')) {
      return 'COGS'
    }
    if (lowerCategory.includes('salary') || lowerCategory.includes('wage') || lowerCategory.includes('payroll')) {
      return 'Salaries'
    }
    if (lowerCategory.includes('marketing') || lowerCategory.includes('advertising') || lowerCategory.includes('promotion')) {
      return 'Marketing'
    }
    if (lowerCategory.includes('rent') || lowerCategory.includes('lease') || lowerCategory.includes('office')) {
      return 'Rent'
    }
    if (lowerCategory.includes('expense') || lowerCategory.includes('expenses')) {
      return 'Other OpEx'
    }
    
    // Default mapping - if positive amount, treat as revenue; if negative, treat as expense
    return category
  }
}
// --- Universal Ingestion Types and Helpers ---

// 1. Types for universal ingestion
export type InferredColumn = {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean' | 'currency'
  description?: string
}

export type InferredSchema = {
  columns: InferredColumn[]
  confidence: number
  issues?: string[]
}

export type GenericIngestionResult = {
  schema: InferredSchema
  rows: Record<string, any>[]
  readyForInsert: boolean
}

// 2. AI schema detection with fallback logic
export async function aiDetectSchema(
  headers: string[],
  sampleRows: any[]
): Promise<InferredSchema> {
  // Try OpenAI endpoint, fallback to simple inference
  try {
    const resp = await fetch('/api/openai-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `Infer the schema (column names, types) for this data:\nHeaders: ${JSON.stringify(
          headers
        )}\nSample Rows: ${JSON.stringify(sampleRows)}\nRespond with JSON: { columns: [{name,type,description}], confidence, issues }`
      })
    })
    if (!resp.ok) throw new Error('OpenAI analyze failed')
    const json = await resp.json()
    // Defensive: fix up old format if needed
    if (Array.isArray(json.columns)) {
      return {
        columns: json.columns.map((col: any) => ({
          name: col.name || col.column || '',
          type: (col.type || 'string').toLowerCase(),
          description: col.description
        })),
        confidence: typeof json.confidence === 'number' ? json.confidence : 0.7,
        issues: json.issues || []
      }
    }
    throw new Error('No columns in OpenAI response')
  } catch (err) {
    // Fallback: simple type inference
    const typesMap: Record<string, Set<string>> = {}
    headers.forEach(h => {
      typesMap[h] = new Set()
    })
    sampleRows.forEach(row => {
      headers.forEach(h => {
        const v = row[h]
        if (v === null || v === undefined || v === '') return
        if (typeof v === 'number') typesMap[h].add('number')
        else if (typeof v === 'boolean') typesMap[h].add('boolean')
        else if (typeof v === 'string') {
          // Try date
          if (
            /^\d{4}-\d{2}-\d{2}/.test(v) ||
            /^\d{2}[./-]\d{2}[./-]\d{4}/.test(v)
          ) {
            typesMap[h].add('date')
          } else if (/^\d+([.,]\d+)?$/.test(v.replace(/[,.\s€$£¥]/g, ''))) {
            typesMap[h].add('number')
          } else {
            typesMap[h].add('string')
          }
        }
      })
    })
    const columns: InferredColumn[] = headers.map(h => {
      const types = Array.from(typesMap[h])
      let type: InferredColumn['type'] = 'string'
      if (types.includes('date')) type = 'date'
      else if (types.includes('number')) type = 'number'
      else if (types.includes('boolean')) type = 'boolean'
      return { name: h, type }
    })
    return { columns, confidence: 0.5 }
  }
}

// 3. Normalize rows by inferred schema
export function normalizeRowsBySchema(
  rows: any[],
  schema: InferredSchema
): Record<string, any>[] {
  function normValue(val: any, type: InferredColumn['type']) {
    if (val == null || val === '') return null
    switch (type) {
      case 'number':
      case 'currency':
        if (typeof val === 'number') return val
        if (typeof val === 'string') {
          let s = val.replace(/[€$£¥\s]/g, '').replace(/[^\d.,-]/g, '')
          if (s.includes(',') && s.includes('.')) {
            const lastComma = s.lastIndexOf(',')
            const lastDot = s.lastIndexOf('.')
            if (lastComma > lastDot) {
              s = s.replace(/\./g, '').replace(',', '.')
            }
          } else if (s.includes(',')) {
            const parts = s.split(',')
            if (parts.length === 2 && parts[1].length <= 2) {
              s = s.replace(',', '.')
            } else {
              s = s.replace(/,/g, '')
            }
          }
          const n = parseFloat(s)
          return isNaN(n) ? null : n
        }
        return null
      case 'date':
        if (typeof val === 'string' || typeof val === 'number') {
          try {
            const d = new Date(val)
            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
          } catch {}
        }
        return null
      case 'boolean':
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
          const lower = val.toLowerCase()
          if (['true', 'yes', '1'].includes(lower)) return true
          if (['false', 'no', '0'].includes(lower)) return false
        }
        if (typeof val === 'number') return val !== 0
        return null
      default:
        return val != null ? val.toString() : null
    }
  }
  return rows.map(row => {
    const result: Record<string, any> = {}
    schema.columns.forEach(col => {
      result[col.name] = normValue(row[col.name], col.type)
    })
    return result
  })
}

// 4. Universal ingestion builder
export async function buildGenericIngestion(
  headers: string[],
  allRows: any[],
  opts?: { sampleSize?: number }
): Promise<GenericIngestionResult> {
  const sampleRows = allRows.slice(0, opts?.sampleSize || 10)
  const schema = await aiDetectSchema(headers, sampleRows)
  const normalizedRows = normalizeRowsBySchema(allRows, schema)
  // Ready for insert if all columns have a name and type and at least one row
  const readyForInsert =
    schema.columns.length > 0 &&
    normalizedRows.length > 0 &&
    schema.columns.every(c => !!c.name && !!c.type)
  return {
    schema,
    rows: normalizedRows,
    readyForInsert
  }
}